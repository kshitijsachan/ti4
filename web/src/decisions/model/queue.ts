import type { Decision } from "./classify";
import { baseId } from "./controls";

/** Rolling dice or assigning hits: a combat waits on me only while one of these is up. */
const COMBAT_MOVE = /^(combatRoll_\w+_(space|ground)$|autoAssign\w*Hits|getDamageButtons|assignHits|rollForAmbush)/;

export function combatWaitsOnMe(d: Decision) {
  return [d, ...(d.steps ?? [])].some((x) => x.choices.some((c) => !c.disabled && COMBAT_MOVE.test(baseId(c.customId))));
}

/**
 * The order the game needs answers in, as one queue with exactly one current item.
 *
 * 1. Everything the table is waiting on from me, oldest first: strategy-card follows, sabotage, whens / afters,
 *    votes, combat steps, trade offers, and the steps of whatever I am in the middle of (pay, gain tokens, …).
 *    The bot asks for these before the turn order moves on ("Please resolve these before doing anything else").
 * 2. Then my own turn's action choice (newest first: only the latest turn prompt counts).
 * Optional prompts (plan-ahead pre-declines, preferences) are not in the queue at all, and ability offers the game
 * does not wait on are listed apart (`offersOf`).
 */
export function orderQueue(oldestFirst: Decision[]): Decision[] {
  const live = oldestFirst.filter((d) => !d.optional && !d.offer);
  const owed = live.filter((d) => d.kind !== "turn");
  const turn = live.filter((d) => d.kind === "turn").reverse();
  /* The next step of something I just pressed (only-you prompts, replies to my press, my hand thread) comes first:
     Leadership's pay-then-gain must finish before the next card's follow, which may need the token it buys. */
  const continuation = (d: Decision) =>
    !d.setup && (d.prompt.reason === "ephemeral" || d.prompt.reason === "reply" || d.prompt.where === "hand");
  /* A combat comes before anything else in the action (space combat happens before ground forces land). */
  const combat = owed.filter((d) => d.kind === "combat" && combatWaitsOnMe(d));
  const waiting = owed.filter((d) => d.kind === "combat" && !combatWaitsOnMe(d));
  const rest = owed.filter((d) => d.kind !== "combat");
  /* A combat still being fought (opponent to roll) stays ahead too: ground forces land only once space is won. */
  return [...combat, ...waiting, ...rest.filter(continuation), ...rest.filter((d) => !continuation(d)), ...turn];
}

/**
 * Room for premoves later: an answer chosen ahead of time for a prompt that has not arrived yet (e.g. "don't follow
 * Diplomacy"). When a decision that `matches` reaches the head of the queue, the host can press `choiceId` for the
 * player. Nothing creates these yet.
 */
export type Premove = {
  id: string;
  /** Plain words for the player ("Don't follow Diplomacy"). */
  label: string;
  matches: (d: Decision) => boolean;
  /** Custom id (without the faction prefix) of the choice to press. */
  choiceId: string;
};

/** The premove that answers `d`, if any. */
export function premoveFor(d: Decision, premoves: Premove[]): Premove | undefined {
  return premoves.find((p) => p.matches(d));
}

/** Abilities on offer right now that nothing waits on, newest first. */
export function offersOf(oldestFirst: Decision[]): Decision[] {
  return oldestFirst.filter((d) => d.offer && !d.optional).reverse();
}
