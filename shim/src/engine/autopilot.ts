/**
 * Autopilot policy over typed decisions. Pure: (decision, state) → option. Add a case per kind as kinds are typed;
 * return null to leave the decision to the legacy rule table in autopilot.ts.
 */
import { chooseCombat } from "./combatPolicy.js";
import type { Decision, GameState, Option } from "./types.js";

/** Same order as autopilot.ts SC_PREFERENCE. */
const SC_PREFERENCE = [1, 7, 8, 6, 5, 4, 3, 2];

export type TypedChoice = { option: Option<any>; why: string };

/** open: this seat's other open decisions (combat: no next roll while hits are owed). */
export function chooseTyped(d: Decision, state: GameState | null, me: string, open: Decision[] = []): TypedChoice | null {
  if (d.kind.startsWith("combat.")) return chooseCombat(d, state, me, open);
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
    default:
      return null;
  }
}
