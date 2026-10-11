/**
 * Autopilot policy for the agenda phase (kinds/agenda.ts). Pure. Simple self-interest: vote for ourselves (or our
 * best planet) when the agenda is known to reward the one elected, with every voting planet (agenda cleanup readies
 * them anyway); abstain when unsure (For/Against, laws, harmful or unknown elections). Pass on whens/afters and
 * shenanigans; the speaker breaks ties, resolves and moves on.
 */
import type { Decision, GameState, Option } from "./types.js";
import type { AgendaOutcomeChoice } from "./kinds/agenda.js";

/** Elections that are good for whoever (or whose planet) is elected (base + PoK agenda ids). */
const GOOD_TO_WIN = new Set([
  "secret",
  "committee",
  "arbiter",
  "minister_commerce",
  "minister_exploration",
  "minister_industry",
  "minister_peace",
  "minister_policy",
  "minister_sciences",
  "minister_war",
  "minister_antiquities",
  "prophecy",
  "shard_of_the_throne",
  "crown_of_emphidia",
  "crown_of_thalnos",
  "censure",
  "grant_reallocation",
  "warrant",
  "core_mining",
  "holy_planet_of_ixth",
  "rt_biotic",
  "rt_cybernetic",
  "rt_propulsion",
  "rt_warfare",
  "senate_sanctuary",
  "terraforming_initiative",
]);

/** How long the speaker waits for the table to decline shenanigans before resolving anyway. */
const SHENANIGANS_WAIT_MS = 120_000;

export type AgendaChoice = { option: Option<any>; why: string; payload?: Record<string, unknown> };

const live = (d: Decision) => (d.options as Option<any>[]).filter((o) => !o.disabled && !o.needsInput && o.value);

/** The outcome we want elected, or null when we would rather not take part. */
export function preferredOutcome(state: GameState | null, me: string, outcomes: AgendaOutcomeChoice[]): string | null {
  const agenda = state?.agenda;
  if (!agenda?.agendaId || !GOOD_TO_WIN.has(agenda.agendaId)) return null;
  const self = state?.players.find((p) => p.userId === me);
  if (!self) return null;
  if (agenda.outcomeType === "player") {
    return outcomes.find((o) => o.userId === me || o.id === self.faction || o.id === self.color)?.id ?? null;
  }
  if (agenda.outcomeType === "planet") {
    const ours = new Set(self.planets);
    return outcomes.find((o) => ours.has(o.id))?.id ?? null;
  }
  return null;
}

export function chooseAgenda(d: Decision, state: GameState | null, me: string, open: Decision[] = []): AgendaChoice | null {
  const opts = live(d);
  const pick = (pred: (v: any) => boolean) => opts.find((o) => pred(o.value));
  switch (d.kind) {
    case "agenda.when":
    case "agenda.after": {
      const pass = pick((v) => v.action === "pass");
      return pass ? { option: pass, why: `agenda: no ${d.kind === "agenda.when" ? "whens" : "afters"}` } : null;
    }
    case "agenda.preassign": {
      const o = pick((v) => v.preset === "pass_shenanigans") ?? pick((v) => v.preset === "pass_whens_afters");
      return o ? { option: o, why: `agenda: pre-${o.value.preset.replace(/_/g, " ")}` } : null;
    }
    case "agenda.shenanigans": {
      const o = opts[0];
      return o ? { option: o, why: "agenda: no shenanigans" } : null;
    }
    case "agenda.vote": {
      const vote = pick((v) => v.action === "vote");
      const abstain = pick((v) => v.action === "abstain");
      const want = vote ? preferredOutcome(state, me, vote.value.outcomes ?? []) : null;
      if (vote && want && (vote.value.available ?? 0) > 0) {
        return { option: vote, why: `agenda: vote for ${want} with every planet`, payload: { outcome: want, allPlanets: true } };
      }
      return abstain ? { option: abstain, why: "agenda: abstain (nothing in it for us)" } : null;
    }
    case "agenda.tiebreak": {
      const outcomes = opts.filter((o) => "outcome" in o.value).map((o) => ({ id: o.value.outcome as string, name: o.value.name as string }));
      const want = preferredOutcome(state, me, outcomes);
      const self = state?.players.find((p) => p.userId === me);
      const o =
        (want && pick((v) => v.outcome === want)) ||
        (state?.agenda && GOOD_TO_WIN.has(state.agenda.agendaId ?? "") && pick((v) => v.planetOwner === self?.faction)) ||
        opts[0];
      return o ? { option: o, why: "agenda: speaker breaks the tie" } : null;
    }
    case "agenda.resolve": {
      const resolves = opts.filter((o) => o.value.action === "resolve");
      if (resolves.length !== 1) return null; // manual pick: leave it to people / legacy
      const waiting = open.some(
        (x) => x.kind === "agenda.shenanigans" && x.window && x.window.responded.length < x.window.eligible.length && Date.now() - x.createdAt < SHENANIGANS_WAIT_MS,
      );
      return waiting ? null : { option: resolves[0], why: "agenda: resolve with the current winner" };
    }
    case "agenda.next": {
      const o = pick((v) => v.action === "flip") ?? pick((v) => v.action === "strategy_phase");
      return o ? { option: o, why: o.value.action === "flip" ? "agenda: reveal the next agenda" : "agenda: on to the strategy phase" } : null;
    }
    default:
      return null;
  }
}
