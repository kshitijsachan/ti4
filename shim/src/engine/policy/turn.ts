/**
 * The bot's action-phase turn policy (turn.action). Pure: (decision, state, me, timing) → option | null.
 *
 * Whenever it is a bot's turn it promptly takes a sensible action or passes:
 *   1. "End turn or do another action" (an end_turn option): end the turn (a bot takes one action per turn).
 *      While the strategy card we played this turn still waits on followers (end_turn value waitingFor, engine
 *      ScFollowGate: the engine refuses the end), wait: the menu is stale for us until the window closes, then end
 *      the turn. Never "End Turn When All Have Reacted" (end_turn_when_followed): pressed before our own primary /
 *      tactical action was over, the last follower's answer ended our turn mid-action (live pbd273).
 *   2. The strategy card is unplayed and playable (a strategic option): play it. Passing is illegal before it is
 *      played, and the planner's tactical action can wait a turn.
 *   3. The pass menu (only pass options left, e.g. after "Pass (+N abilities)"): finish passing.
 *   4. The start-of-turn menu with a tactical action on offer: the planner's call (botplay/brain.ts starts a tactical
 *      action when it has a job, or passes when it has none). If the menu still waits on us after
 *      TURN_PLANNER_GRACE_MS (planner had no job, its start was refused, the seat has no planner), pass.
 *
 * Never answers while an action of ours is in flight (actionInFlight: open tactical / production / combat … prompts),
 * nor while the planner runs a job (the shim skips the menu then: brain.busy).
 * Never passes (or does anything else) when the menu is stale: no state, outside the action phase, or while another
 * player is active, or after we passed (pbd42: "Pass (+3 abilities)" pressed every minute in the status phase, "The action phase is
 * over"; pbd160: "It is not your turn"). Never passes while we hold a strategy card that is not played yet.
 */
import type { FollowWait, TurnAction, TurnActionValue } from "../kinds/tactical.js";
import type { Decision, GameState, Option } from "../types.js";

/** How long the start-of-turn menu belongs to the planner before the policy passes for it. */
export const TURN_PLANNER_GRACE_MS = 6_000;

type Choice = { option: Option<TurnActionValue>; why: string };

const live = (d: TurnAction) =>
  (d.options as Option<TurnActionValue>[]).filter(
    (o) => !o.disabled && !o.needsInput && o.value,
  );

/**
 * A turn menu that does not belong to the current turn of `me`: the game is not waiting on it, so nothing (specific
 * policy, fallback, watchdog, legacy rule) may press it. Without a state we cannot tell whose turn it is: stale.
 */
export function turnStale(
  d: Decision,
  state: GameState | null,
  me: string,
): boolean {
  if (d.kind !== "turn.action") return false;
  if (!state) return true;
  if (state.phase !== "action" || state.activePlayer !== me) return true;
  // Passed: no more turns this round (a menu still listed for us is left over).
  if (state.players.find((p) => p.userId === me)?.passed) return true;
  // Our card's follow window holds the turn: the game waits on the other players, not on us; nothing on this menu is
  // pressed (the engine refuses the end) until it closes.
  return followWaits(d.options as Option<TurnActionValue>[]).length > 0;
}

/** The follow windows holding the turn, as the menu's end_turn / pass options report them (empty: the turn may end). */
export function followWaits(opts: Option<TurnActionValue>[]): FollowWait[] {
  for (const o of opts) {
    const v = o.value;
    if (v && (v.action === "end_turn" || v.action === "pass") && v.waitingFor?.length) return v.waitingFor;
  }
  return [];
}

/** Strategy cards `me` holds that are not played yet (rules: each must be played before passing). */
export function unplayedCards(state: GameState | null, me: string): number[] {
  return (state?.strategyCards ?? [])
    .filter((c) => c.holder === me && !c.played)
    .map((c) => c.number);
}

/** The pass option to press: pass now (abilities=false), else the "pass with abilities" menu that leads to it. */
export function passOption<V extends { action?: unknown; abilities?: unknown }>(
  opts: Option<V>[],
): Option<V> | undefined {
  const passes = opts.filter(
    (o) => !o.disabled && !o.needsInput && o.value?.action === "pass",
  );
  return passes.find((o) => o.value!.abilities === false) ?? passes[0];
}

/** Decisions of an action under way: while one of ours is open, the turn is not over and nothing new starts. */
const IN_FLIGHT =
  /^(tactical\.|production\.|payment\.spend$|combat\.|explore\.|relic\.|units\.)/;
/**
 * Follow-ups of a Warfare primary (remove a token, the redistribute offer / panel, Thunder's Edge Warfare's "perform
 * the tactical action"): the strategic action is not over until they are answered.
 */
function warfareStep(x: Decision): boolean {
  if (x.kind === "command_tokens.adjust") return true;
  return x.options.some((o) => {
    const v = o.value as { source?: string } | null;
    return (x.kind === "choose.confirm" && v?.source === "warfare") || (x.kind === "choose.system" && v?.source === "remove_cc");
  });
}

/** An in-flight decision older than this is a leftover (the watchdog's fallback closes it), not this turn's action. */
const IN_FLIGHT_MAX_AGE_MS = 10 * 60_000;

/**
 * Why `me` is mid-action, or null: one of our tactical / production / payment / combat / explore decisions is open,
 * (combat rolls / hits included). (pbd181 02:14: Bot Kappa 5 had moved and landed; the turn menu passed "after 13 s", leaving the
 * move and conclude prompts open.)
 */
export function actionInFlight(
  me: string,
  open: Decision[],
  now = Date.now(),
): string | null {
  const mine = open.find(
    (x) =>
      (IN_FLIGHT.test(x.kind) || warfareStep(x)) &&
      (x.target?.userId === me ||
        (!!x.window &&
          x.window.eligible.includes(me) &&
          !x.window.responded.includes(me))) &&
      now - x.createdAt < IN_FLIGHT_MAX_AGE_MS,
  );
  // (state.combat alone is not used: a finished combat can linger there, pbd60.)
  return mine ? `${mine.kind} open` : null;
}

export function chooseTurnAction(
  d: TurnAction,
  state: GameState | null,
  me: string,
  timing: {
    waitedMs?: number;
    force?: boolean;
    open?: Decision[];
    now?: number;
    /** Options of this decision we already answered (autopilot ctx.history). */
    history?: string[];
    /** Our played card's primary is not resolved yet (kinds/strategyPolicy holderPrimaryPending): no end turn. */
    primaryPending?: string | null;
  } = {},
): Choice | null {
  if (turnStale(d, state, me)) return null;
  if (d.target?.userId !== me) return null;
  // Mid-action: no end turn, no strategy card, no pass (forced or not) until the action's own prompts are done.
  if (actionInFlight(me, timing.open ?? [], timing.now)) return null;
  const opts = live(d);
  const end = opts.filter((o) => o.value!.action === "end_turn");
  const waits = followWaits(opts);
  // Follows outstanding on our card: wait for them (turnStale already says so; guard anyway).
  if (waits.length) return null;
  if (end.length) {
    // The primary is part of the strategic action: resolve it before the turn ends (playtest 9 pbd539: End Turn went
    // in between a stale "Score A Public" and its retry, and Imperial scored after the turn).
    if (timing.primaryPending) return null;
    // The engine says a mandatory primary part is left (it refuses the end): resolve it first.
    if (end.some((o) => o.value!.action === "end_turn" && o.value!.primaryMissing)) return null;
    const pick =
      end.find((o) => o.value!.action === "end_turn" && !o.value!.abilities) ??
      end[0];
    return { option: pick, why: "action done: end turn" };
  }
  const strategic = opts.filter((o) => o.value!.action === "strategic");
  if (strategic.length) {
    // Several cards (3-4 player games): the lowest number first, like the initiative order.
    const card = (o: Option<TurnActionValue>) =>
      o.value!.action === "strategic" ? o.value!.strategyCard : 99;
    const pick = [...strategic].sort((a, b) => card(a) - card(b))[0];
    return { option: pick, why: `play strategy card ${card(pick)}` };
  }
  const pass = passOption(opts);
  if (!pass) return null;
  // Rules: a strategy card must be played before passing (the bot offers no pass then; guard anyway).
  if (unplayedCards(state, me).length) return null;
  const actions = opts.some(
    (o) => o.value!.action === "tactical" || o.value!.action === "component",
  );
  if (!actions) return { option: pass, why: "pass menu: pass for the round" };
  if (timing.force || (timing.waitedMs ?? 0) >= TURN_PLANNER_GRACE_MS) {
    return {
      option: pass,
      why: `turn: planner took no action in ${Math.round((timing.waitedMs ?? 0) / 1000)}s; pass`,
    };
  }
  return null;
}
