/**
 * Autopilot policy over typed decisions. Pure: (decision, state) → option. Add a case per kind as kinds are typed;
 * return null to leave the decision to the legacy rule table in autopilot.ts.
 */
import { answersOutsideWindow, awaits, type Decision, type GameState, type Option } from "./types.js";
import { chooseAgenda } from "./agendaPolicy.js";
import { chooseCards } from "./policy/cards.js";
import { chooseExplore } from "./policy/explore.js";
import { chooseFaction } from "./policy/faction.js";
import { chooseFactionGroupC } from "./policy/factionGroupC.js";
import { chooseFactionB } from "./policy/factionB.js";
import { choosePokFaction } from "./policy/factionPok.js";
import { chooseStatus } from "./policy/status.js";
import { chooseThundersEdge, isThundersEdgeKind } from "./policy-te.js";
import { chooseResearch, chooseStrategy, STRATEGY_POLICY_KINDS, type PolicyCtx } from "./kinds/strategyPolicy.js";
import { chooseSetup } from "./policy/setup.js";
import { chooseTrade } from "./tradePolicy.js";
import { chooseCombat, chooseUnitsRemove } from "./combatPolicy.js";
import { chooseComponents, isComponentsKind } from "./policy/components.js";
import { chooseCommodities, choosePlacement, planPayment } from "./policy/production.js";
import { chooseFallback, fallbackDue, mayPress, staleForBot } from "./policy/fallback.js";
import { choosePerpetual } from "./policy/ui.js";
import { chooseTurnAction } from "./policy/turn.js";
import { chooseManualBuild, chooseUnitsModify } from "./policy/units.js";

/** Same order as autopilot.ts SC_PREFERENCE. */
const SC_PREFERENCE = [1, 7, 8, 6, 5, 4, 3, 2];

/**
 * Press one option, or send a structured payload the kind executes atomically (payment, production, agenda vote,
 * command tokens). option may accompany a payload (it names the option the payload belongs to, for logs).
 */
export type TypedChoice =
  | { option: Option<any>; payload?: Record<string, unknown>; why: string }
  | { option?: undefined; payload: Record<string, unknown>; why: string };

/**
 * The bot's answer to a typed decision: the area's specific policy, else (for a decision that waits on this seat and
 * that the game may wait on) the last-resort fallback (policy/fallback.ts) once it is due — after FALLBACK_GRACE_MS of
 * waiting, or for kinds whose policy may hold an answer on purpose, when the shim watchdog forces it (ctx.force).
 * A fallback answer's `why` starts with "fallback:" (logged, so a specific policy can be added for that kind).
 */
export function chooseTyped(d: Decision, state: GameState | null, me: string, ctx: PolicyCtx = { history: [], open: [], all: [] }): TypedChoice | null {
  let specific: TypedChoice | null = null;
  let note = "";
  try {
    specific = chooseSpecific(d, state, me, ctx);
  } catch (e) {
    // A policy bug must never leave the seat silent: fall back (logged with the error).
    note = ` (specific policy threw: ${(e as Error).message})`;
  }
  // Safety net over every policy: never another player's / faction's option.
  if (specific?.option && !mayPress(specific.option, d, state, me)) {
    note = ` (specific policy picked ${specific.option.id}, not ours)`;
    specific = null;
  }
  if (specific) return specific;
  if (!fallbackDue(d, me, { waitedMs: ctx.waitedMs, force: ctx.force })) return null;
  // An option this seat already pressed on this decision is not pressed again by the fallback (multi-part answers
  // are the specific policies' business), except the watchdog's forced re-evaluation.
  const fb = chooseFallback(d, state, me);
  if (!fb || (!ctx.force && ctx.history.includes(fb.option.id))) return null;
  return note ? { ...fb, why: fb.why + note } : fb;
}

function chooseSpecific(d: Decision, state: GameState | null, me: string, ctx: PolicyCtx): TypedChoice | null {
  const all = ctx.all;
  // Combat (G4): ctx.open = this seat's other open decisions (no next roll while hits are owed).
  if (d.kind.startsWith("combat.")) return chooseCombat(d, state, me, ctx.open);
  // Affordances (ui.*: never answered), preferences (defaults) and select-only prompts (c12).
  const perpetual = choosePerpetual(d, state, me);
  if (perpetual !== undefined) return perpetual;
  const setup = chooseSetup(d, state, me, ctx.history);
  if (setup !== undefined) return setup;
  if (isThundersEdgeKind(d)) return chooseThundersEdge(d, state, me);
  const status = chooseStatus(d, state, me, all.filter((x) => x.target?.userId === me));
  if (status !== undefined) return status;
  if (d.kind.startsWith("agenda.")) return awaits(d, me) ? chooseAgenda(d, state, me, all) : null;
  const cards = chooseCards(d, state, me, all, ctx.history);
  if (cards !== undefined) return cards;
  // Faction leaders / abilities (shared kinds leader.use, faction.ability; phase C faction areas).
  const groupC = chooseFactionGroupC(d, state, me); // Jol-Nar, Winnu, Xxcha, Yin, Yssaril, Keleres overrides
  if (groupC !== undefined) return groupC;
  const factionB = chooseFactionB(d, state, me);
  if (factionB !== undefined) return factionB;
  const pok = choosePokFaction(d, state, me, ctx.history);
  if (pok !== undefined) return pok;
  const faction = chooseFaction(d, state, me);
  if (faction !== undefined) return faction;
  // Components (C6): component menu, relic uses, agent exhaust step, generic choose.* steps. Only our own prompts.
  if (isComponentsKind(d)) return d.target?.userId === me ? chooseComponents(d, state, me) : null;
  // Strategy cards (G2): the played card is a table window; its policy checks who may press what.
  // (command_tokens.adjust belongs to the status area; only its Leadership panel is answered here.)
  const kind: string = d.kind;
  const leadershipPanel = kind === "command_tokens.adjust" && (d.options as Option<any>[]).some((o) => o.handler.replace(/~\w+$/, "") === "deleteButtons_leadership");
  if (STRATEGY_POLICY_KINDS.has(kind) && (kind !== "command_tokens.adjust" || leadershipPanel)) {
    if (d.scope === "player" && d.target?.userId !== me) return null;
    return chooseStrategy(d, state, me, ctx);
  }
  if (d.target?.userId !== me || d.scope !== "player") return null;
  if (d.kind === "input.form") {
    // Forms open only when a seat pressed a form button through the engine; bots have no policy for free-form
    // input, so close it instead of leaving a private decision open.
    const cancel = d.options.find((o) => o.id === "cancel");
    return cancel ? { option: cancel, why: "form: bots do not fill free-form input" } : null;
  }
  const live = (d.options as Option<any>[]).filter((o) => !o.disabled && !o.needsInput && o.value);
  if (!live.length) return null;
  const self = state?.players.find((p) => p.userId === me);
  switch (d.kind) {
    case "strategy_card.pick": {
      const opts = d.options.filter((o) => !o.disabled && o.value);
      const rank = (n: number) => (SC_PREFERENCE.indexOf(n) < 0 ? 99 : SC_PREFERENCE.indexOf(n));
      opts.sort((a, b) => rank(a.value!.strategyCard) - rank(b.value!.strategyCard) || b.value!.tradeGoods - a.value!.tradeGoods);
      return opts[0] ? { option: opts[0], why: "strategy phase: preferred card" } : null;
    }
    case "tech.gain": {
      // Only the free starting technology; paid research stays with the planner / rule table for now.
      const opts = d.options.filter((o) => !o.disabled && o.value?.starting && !self?.techs.includes(o.value.tech));
      if (opts[0]) return { option: opts[0], why: "setup: first starting technology not owned" };
      // Technology primary (our card, played): the free first technology. Paid research is not planned.
      const tech = state?.strategyCards.find((c) => c.card === "pok7technology" && c.played && c.holder === me);
      if (tech && self && ctx.history.length === 0) {
        const pick = chooseResearch(d.options, self.techs);
        if (pick) return { option: pick, why: `Technology primary: research ${pick.value.tech}` };
      }
      return null;
    }
    case "secret_objective.discard": {
      // Mecatol Rex (Thunder's Edge legendary, already exhausted): swap one secret for a fresh draw; the newest goes.
      const swaps = d.options.filter((o) => !o.disabled && o.value?.redraw);
      if (swaps.length) return { option: swaps.at(-1)!, why: "Mecatol Rex: swap a secret objective" };
      // Setup (round 1, holding more than one): keep the first, discard the last. Later discards: not ours to guess.
      if ((state?.round ?? 99) > 1 || (self?.secretObjectiveCount ?? 0) < 2) return null;
      const opts = d.options.filter((o) => !o.disabled && o.value && !o.value.redraw);
      const last = opts.at(-1);
      return last ? { option: last, why: "setup: keep the first secret objective" } : null;
    }
    case "explore.planet":
    case "explore.card_pick":
    case "explore.frontier":
    case "explore.outcome":
    case "relic.fragments":
    case "relic.draw":
      return chooseExplore(d, state, me);
    case "turn.action":
      // The action-phase turn policy (policy/turn.ts): end turn / play the strategy card / finish passing at once;
      // the start-of-turn menu is the planner's (brain.ts) for TURN_PLANNER_GRACE_MS, then pass.
      return chooseTurnAction(d, state, me, { waitedMs: ctx.waitedMs, force: ctx.force });
    case "tactical.rift": {
      // The planner never paths through gravity rifts; a rift prompt outside its plan has nothing to roll.
      const done = d.options.find((o) => !o.disabled && o.value?.op === "done");
      return done ? { option: done, why: "no units moved through a rift" } : null;
    }
    case "trade.offer":
    case "trade.offer_sent":
    case "trade.force_replenish":
      return chooseTrade(d, state, self);
    case "payment.spend": {
      // Pay the whole bill in one answer when the engine knows the cost; otherwise the planner / rule table pays.
      const plan = planPayment(d, state, me);
      return plan ? { payload: plan.payload as unknown as Record<string, unknown>, why: plan.why } : null;
    }
    case "production.place":
      return choosePlacement(d, state, me);
    case "commodities.gain":
      return chooseCommodities(d, state, me, ctx.history);
    case "units.remove":
      return chooseUnitsRemove(d, me, ctx.history, ctx.open, state);
    case "units.modify":
      return chooseUnitsModify(d, me);
    case "production.produce":
      // What to build is the planner's call (botplay BuildJob sends it as one production payload); a build opened
      // from the Modify Units menu builds nothing.
      return chooseManualBuild(d, me);
    default:
      return null;
  }
}

/** How long a typed decision the engine can answer belongs to the engine path before the legacy rules may help. */
export const ENGINE_GRACE_MS = 90_000;
/**
 * A message the engine has not (yet) captured as a decision: the bot posts it to the shim before the engine stream
 * carries its decision, and the autopilot looks at the table every ~1 s. Legacy paths leave such a message alone for
 * this long, so they never win the race against the typed decision (live: "Not Following", "Pass", the status
 * homework and scoring prompts were pressed by the rule table / planner moments before the engine answered them).
 */
export const ENGINE_SETTLE_MS = 15_000;

export type EngineOwnership = { owned: boolean; why: string };

/**
 * Whether the typed engine path owns a message for `me`, so the legacy rules / planner jobs / last resort must not
 * press it (pure; Autopilot.engineOwns feeds it the live mirror). Only meaningful while the engine stream is live —
 * the caller answers false when it is not, so with the engine off the legacy paths play exactly as before.
 *
 * - no decision for the message: owned while the message is younger than ENGINE_SETTLE_MS (its decision may not have
 *   reached the mirror yet), then free (untyped prompt, or a decision already closed);
 * - "legacy" (untyped): free;
 * - a window `me` already answered: owned — there is nothing left for this seat to press, and a legacy press would
 *   answer twice (live: "Not Following", "Ready For Strategy Phase", "No Public Objective Scored" pressed again);
 * - another player's prompt: free (the legacy paths have their own owner checks);
 * - for ENGINE_GRACE_MS from its creation: a window `me` is not asked in (and does not answer outside it) is owned
 *   (nobody waits on us); otherwise owned while the engine has an answer for it — the specific policy, or the last-resort fallback the
 *   watchdog forces (a policy that holds its answer on purpose, e.g. the turn planner's grace, still owns it); free
 *   when no engine answer exists at all (optional offers). After the grace: free (the engine path failed to move it).
 */
export function engineOwnership(
  d: Decision | undefined,
  messageId: string,
  me: string,
  state: GameState | null,
  open: Decision[],
  now: number,
): EngineOwnership {
  if (!d) {
    const age = now - snowflakeMs(messageId);
    return age < ENGINE_SETTLE_MS ? { owned: true, why: `not captured yet (${Math.round(age / 1000)}s old)` } : { owned: false, why: "no typed decision" };
  }
  if (d.kind === "legacy") return { owned: false, why: "untyped" };
  if (d.window?.responded.includes(me)) return { owned: true, why: "answered already" };
  if (d.scope === "player" && !d.window && d.target?.userId !== me) return { owned: false, why: "another player's prompt" };
  const age = now - d.createdAt;
  if (age >= ENGINE_GRACE_MS) return { owned: false, why: `typed, but still open after ${Math.round(age / 1000)}s` };
  const outside = !!d.window && !awaits(d, me);
  if (outside && !answersOutsideWindow(d, me, state)) return { owned: true, why: "not asked in this window" };
  if (staleForBot(d, state, me)) return { owned: true, why: "stale for this seat" };
  const mine = open.filter((x) => x.id !== d.id && x.target?.userId === me);
  const pick = chooseTyped(d, state, me, { history: [], open: mine, all: open, waitedMs: age, force: true });
  if (pick) return { owned: true, why: pick.why };
  // The holder of a played strategy card with nothing left to resolve (live pbd158: the engine researched the
  // Technology primary, then the planner pressed "Get a Technology" on the same card again).
  if (outside) return { owned: true, why: "answered outside the window; nothing left" };
  return { owned: false, why: "no engine answer" };
}

const DISCORD_EPOCH = 1420070400000;
function snowflakeMs(id: string): number {
  try {
    return Number(BigInt(id) >> 22n) + DISCORD_EPOCH;
  } catch {
    return 0;
  }
}
