/**
 * Autopilot policy over typed decisions. Pure: (decision, state) → option. Add a case per kind as kinds are typed;
 * return null to leave the decision to the legacy rule table in autopilot.ts.
 */
import { awaits, type Decision, type GameState, type Option } from "./types.js";
import { chooseAgenda } from "./agendaPolicy.js";
import { chooseCards } from "./policy/cards.js";
import { chooseExplore } from "./policy/explore.js";
import { chooseStatus } from "./policy/status.js";
import { chooseThundersEdge, isThundersEdgeKind } from "./policy-te.js";
import { chooseResearch, chooseStrategy, STRATEGY_POLICY_KINDS, type PolicyCtx } from "./kinds/strategyPolicy.js";
import { chooseSetup } from "./policy/setup.js";
import { chooseTrade } from "./tradePolicy.js";

/** Same order as autopilot.ts SC_PREFERENCE. */
const SC_PREFERENCE = [1, 7, 8, 6, 5, 4, 3, 2];

/** payload: answer with a structured payload instead of pressing `option` (e.g. a whole agenda vote). */
export type TypedChoice = { option: Option<any>; why: string; payload?: Record<string, unknown> };

export function chooseTyped(d: Decision, state: GameState | null, me: string, ctx: PolicyCtx = { history: [], open: [], all: [] }): TypedChoice | null {
  const all = ctx.all;
  const setup = chooseSetup(d, state, me);
  if (setup !== undefined) return setup;
  if (isThundersEdgeKind(d)) return chooseThundersEdge(d, state, me);
  const status = chooseStatus(d, state, me, all.filter((x) => x.target?.userId === me));
  if (status !== undefined) return status;
  if (d.kind.startsWith("agenda.")) return awaits(d, me) ? chooseAgenda(d, state, me, all) : null;
  const cards = chooseCards(d, state, me, all);
  if (cards !== undefined) return cards;
  // Strategy cards (G2): the played card is a table window; its policy checks who may press what.
  // (command_tokens.adjust belongs to the status area; only its Leadership panel is answered here.)
  const kind: string = d.kind;
  const leadershipPanel = kind === "command_tokens.adjust" && (d.options as Option<any>[]).some((o) => o.handler === "deleteButtons_leadership");
  if (STRATEGY_POLICY_KINDS.has(kind) && (kind !== "command_tokens.adjust" || leadershipPanel)) {
    if (d.scope === "player" && d.target?.userId !== me) return null;
    return chooseStrategy(d, state, me, ctx);
  }
  if (d.target?.userId !== me || d.scope !== "player") return null;
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
    case "turn.action": {
      // After an action: end the turn (an unplayed strategy card first: the strategy policy plays it). The start of
      // a turn (no end_turn option) belongs to the planner (brain.ts) and, for passing, the rule table.
      const opts = d.options.filter((o) => !o.disabled && o.value);
      if (opts.some((o) => o.value!.action === "strategic")) return null;
      const end = opts.filter((o) => o.value!.action === "end_turn");
      const pick = end.find((o) => o.value!.action === "end_turn" && !o.value!.abilities) ?? end[0];
      return pick ? { option: pick, why: "action done: end turn" } : null;
    }
    case "tactical.rift": {
      // The planner never paths through gravity rifts; a rift prompt outside its plan has nothing to roll.
      const done = d.options.find((o) => !o.disabled && o.value?.op === "done");
      return done ? { option: done, why: "no units moved through a rift" } : null;
    }
    case "trade.offer":
    case "trade.offer_sent":
    case "trade.force_replenish":
      return chooseTrade(d, state, self);
    default:
      return null;
  }
}
