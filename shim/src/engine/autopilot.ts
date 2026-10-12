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
import { chooseCappedBuild, chooseCommodities, choosePlacement, planPayment } from "./policy/production.js";
import { TECH_PREFERENCE } from "../botplay/techs.js";
import type { TurnActionValue } from "./kinds/tactical.js";
import { chooseFallback, fallbackDue, mayPress, staleForBot } from "./policy/fallback.js";
import { choosePerpetual } from "./policy/ui.js";
import { actionInFlight, chooseTurnAction, followWaits } from "./policy/turn.js";
import { chooseManualBuild, chooseUnitsModify } from "./policy/units.js";

/** Same order as autopilot.ts SC_PREFERENCE. */
const SC_PREFERENCE = [1, 7, 8, 6, 5, 4, 3, 2];

/**
 * Press one option, or send a structured payload the kind executes atomically (payment, production, agenda vote,
 * command tokens). option may accompany a payload (it names the option the payload belongs to, for logs).
 */
export type TypedChoice =
  | { option: Option<any>; payload?: Record<string, unknown>; act?: TypedAct; why: string }
  | { option?: undefined; payload: Record<string, unknown>; act?: undefined; why: string };

/** A kind's direct action instead of an answer (POST …/decisions/{id}/{action}, e.g. "combat-plan"). */
export type TypedAct = { action: string; body: Record<string, unknown> };

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
  // Our turn menu mid-action (pbd181): no last-resort answer either.
  if (d.kind === "turn.action" && actionInFlight(me, ctx.open)) return null;
  // An option this seat already pressed on this decision is not pressed again by the fallback (multi-part answers
  // are the specific policies' business), except the watchdog's forced re-evaluation.
  const fb = chooseFallback(d, state, me);
  if (!fb || (!ctx.force && ctx.history.includes(fb.option.id))) return null;
  return note ? { ...fb, why: fb.why + note } : fb;
}

function chooseSpecific(d: Decision, state: GameState | null, me: string, ctx: PolicyCtx): TypedChoice | null {
  const all = ctx.all;
  // Combat (G4): ctx.open = this seat's other open decisions (no next roll while hits are owed).
  if (d.kind.startsWith("combat.")) return chooseCombat(d, state, me, ctx.open, ctx.history);
  // Game over (End Game / Rematch): for the people at the table; a bot never ends a game or starts a rematch.
  if (d.kind === "game.end") return null;
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
      // Starting technologies: value.starting, or (live pbd228: the flag missed, the legacy rule pressed instead) a free
      // technology while setup says we still owe starting technologies. Our usual picks first (TECH_PREFERENCE, the
      // planner's research path toward unit upgrades), else the first offered.
      const owing = state?.setup?.players.find((p) => p.userId === me)?.startingTechsNeeded ?? 0;
      const opts = d.options.filter((o) => !o.disabled && o.value && (o.value.starting || (o.value.free && owing > 0)) && !self?.techs.includes(o.value.tech));
      if (opts.length) {
        const rank = (t: string) => (TECH_PREFERENCE.indexOf(t) < 0 ? 99 : TECH_PREFERENCE.indexOf(t));
        const pick = opts.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o.value!.tech) - rank(b.o.value!.tech) || a.i - b.i)[0].o;
        return { option: pick, why: `setup: starting technology ${pick.value!.tech}${rank(pick.value!.tech) < 99 ? " (preferred)" : " (first offered)"}` };
      }
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
      return chooseTurnAction(d, state, me, { waitedMs: ctx.waitedMs, force: ctx.force, open: ctx.open, history: ctx.history });
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
      return chooseManualBuild(d, me) ?? chooseCappedBuild(d, state, me);
    default:
      return null;
  }
}

/** How long a typed decision the engine can answer belongs to the engine path before the legacy rules may help. */
export const ENGINE_GRACE_MS = 90_000;
/**
 * Kinds that ask the table through a window: once the window is gone (everyone answered, the step moved on) a
 * decision still listed is a leftover the game does not wait on (live pbd184 03:20: the status homework's window
 * closed and six bots pressed "Ready For Strategy Phase" / "Redistribute…" again through the rule table / planner).
 */
const WINDOW_KINDS = new Set(["status.score", "status.homework", "strategy_card.resolve", "action_card.sabotage"]);

export type EngineOwnership = { owned: boolean; why: string };

/**
 * Whether the typed engine path owns a message for `me`, so the legacy rules / planner jobs / last resort must not
 * press it (pure; Autopilot.engineOwns feeds it the live mirror). Only meaningful while the engine stream is live and
 * the game's decisions are readable — the caller answers false otherwise, so with the engine off (or down, or
 * restarting) the legacy paths play exactly as before.
 *
 * - no open decision for the message: owned. The bot captures every message with buttons (untyped ones as
 *   "legacy"), so a message without one is either still on its way to the mirror or closed — answered, superseded,
 *   its window over — and its buttons are leftovers the game does not wait on (live 06:06–07:06: "Not Following" on
 *   an old card in the status phase, "Get a Technology" on a card whose primary the engine had resolved, "Pass" on a
 *   left-over pass menu);
 * - "legacy" (untyped): free;
 * - ui.* (undo / optional / info affordances): owned — bots never press them (live: "Edit Summaries" as the rule
 *   table's "only option");
 * - a window `me` already answered, or a window kind whose window is closed: owned (a legacy press answers twice);
 * - for ENGINE_GRACE_MS from its creation: another player's prompt (the engine says whose it is: e.g. the speaker's
 *   "Reveal Stage 1") and a window `me` is not asked in are owned; otherwise owned while the engine has an answer for
 *   it — the specific policy, or the last-resort fallback the watchdog forces (a policy that holds its answer on
 *   purpose still owns it); free when no engine answer exists at all (optional offers). After the grace: free (the
 *   engine path failed to move it; the legacy rules may help).
 */
/**
 * Why our own turn menu (turn.action) must not be pressed by anyone right now, at any age, or null. The turn policy
 * holds it on purpose and a legacy "End Turn" / "Pass" press is wrong there:
 * - our strategy card's follow window holds the turn (end_turn / pass waitingFor, engine ScFollowGate): the bot
 *   refuses the end, so a legacy press past the grace is refused every minute (live 20:08 pbd266: "End Turn" pressed
 *   3x after Construction, "the first press was lost");
 * - an action of ours is under way (tactical / production / payment / combat / Warfare redistribute …): the turn
 *   policy waits for it, which read as "no engine answer" and freed the menu, so the rule table ended the turn
 *   mid-action (live 20:17 pbd41: "End Turn" 3 s after Warfare's "Redistribute Command Tokens"; the Warfare tactical
 *   action was dropped, "it is no longer our turn");
 * - not our turn (another player active, other phase, we passed).
 * Needs the state (without it the usual grace applies, so an unreadable engine still falls back to the legacy rules).
 */
function turnHeld(d: Decision, state: GameState | null, me: string, open: Decision[], now: number): string | null {
  if (d.kind !== "turn.action" || !state || d.target?.userId !== me) return null;
  const waits = followWaits(d.options as Option<TurnActionValue>[]);
  if (waits.length) return `our turn waits on strategy card follows (${waits.map((w) => w.strategyCard).join(", ")})`;
  if (state.phase !== "action" || state.activePlayer !== me) return "not our turn";
  if (state.players.find((p) => p.userId === me)?.passed) return "we passed";
  const busy = actionInFlight(me, open, now);
  return busy ? `our action is under way (${busy})` : null;
}

export function engineOwnership(
  d: Decision | undefined,
  messageId: string,
  me: string,
  state: GameState | null,
  open: Decision[],
  now: number,
): EngineOwnership {
  void messageId;
  if (!d) return { owned: true, why: "no open decision (not captured yet, or closed)" };
  if (d.kind === "legacy") return { owned: false, why: "untyped" };
  if (d.kind.startsWith("ui.")) return { owned: true, why: "an affordance bots never press" };
  if (d.window?.responded.includes(me)) return { owned: true, why: "answered already" };
  if (d.scope === "table" && !d.window && WINDOW_KINDS.has(d.kind)) return { owned: true, why: "its window is closed" };
  const held = turnHeld(d, state, me, open, now);
  if (held) return { owned: true, why: held };
  const age = now - d.createdAt;
  if (age >= ENGINE_GRACE_MS) return { owned: false, why: `typed, but still open after ${Math.round(age / 1000)}s` };
  if (d.scope === "player" && !d.window && d.target?.userId !== me) return { owned: true, why: "another player's prompt" };
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

