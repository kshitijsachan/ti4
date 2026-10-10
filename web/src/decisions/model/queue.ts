import type { Decision } from "./classify";

/**
 * The order the game needs answers in, as one queue with exactly one current item.
 *
 * 1. Everything the table is waiting on from me, oldest first: strategy-card follows, sabotage, whens / afters,
 *    votes, combat steps, trade offers, and the steps of whatever I am in the middle of (pay, gain tokens, …).
 *    The bot asks for these before the turn order moves on ("Please resolve these before doing anything else").
 * 2. Then my own turn's action choice (newest first: only the latest turn prompt counts).
 * Optional prompts (plan-ahead pre-declines, preferences) are not in the queue at all.
 */
export function orderQueue(oldestFirst: Decision[]): Decision[] {
  const live = oldestFirst.filter((d) => !d.optional);
  const owed = live.filter((d) => d.kind !== "turn");
  const turn = live.filter((d) => d.kind === "turn").reverse();
  return [...owed, ...turn];
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
