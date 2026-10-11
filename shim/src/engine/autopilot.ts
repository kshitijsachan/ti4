/**
 * Autopilot policy over typed decisions. Pure: (decision, state) → option. Add a case per kind as kinds are typed;
 * return null to leave the decision to the legacy rule table in autopilot.ts.
 */
import type { Decision, GameState, Option } from "./types.js";
import { planPayment } from "./policy/production.js";

/** Same order as autopilot.ts SC_PREFERENCE. */
const SC_PREFERENCE = [1, 7, 8, 6, 5, 4, 3, 2];

/** Either press one option, or send a typed payload the kind executes atomically (payment, production). */
export type TypedChoice = { option: Option<any>; payload?: undefined; why: string } | { option?: undefined; payload: Record<string, unknown>; why: string };

export function chooseTyped(d: Decision, state: GameState | null, me: string): TypedChoice | null {
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
      return opts[0] ? { option: opts[0], why: "setup: first starting technology not owned" } : null;
    }
    case "secret_objective.discard": {
      // Setup (round 1, holding more than one): keep the first, discard the last. Later discards: not ours to guess.
      if ((state?.round ?? 99) > 1 || (self?.secretObjectiveCount ?? 0) < 2) return null;
      const opts = d.options.filter((o) => !o.disabled && o.value && !o.value.redraw);
      const last = opts.at(-1);
      return last ? { option: last, why: "setup: keep the first secret objective" } : null;
    }
    case "draft.milty.pick": {
      if (state?.draft?.currentPlayer && state.draft.currentPlayer !== me) return null;
      // Categories already drafted are no longer offered to us by the board? Not guaranteed: legacy milty() reads
      // the draft API for our picks, so leave drafting to it unless every live option is the same category.
      const cats = new Set(d.options.filter((o) => !o.disabled && o.value).map((o) => o.value!.category));
      return cats.size === 1 ? { option: d.options.find((o) => !o.disabled && o.value)!, why: "draft: only category left" } : null;
    }
    case "payment.spend": {
      // Pay the whole bill in one answer when the engine knows the cost; otherwise the planner / rule table pays.
      const plan = planPayment(d, state, me);
      return plan ? { payload: plan.payload as unknown as Record<string, unknown>, why: plan.why } : null;
    }
    case "production.produce":
      // What to build is the planner's call (botplay BuildJob sends it as one production payload).
      return null;
    default:
      return null;
  }
}
