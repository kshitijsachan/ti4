/**
 * Autopilot policy for the agenda phase (kinds/agenda.ts). Pure. Simple self-interest, with every voting planet
 * (agenda cleanup readies them anyway, so votes cost nothing but the speaker's patience):
 * - elections that reward the elected (GOOD_TO_WIN): ourselves / our planet;
 * - elections that hurt the elected (BAD_TO_WIN): the points leader other than us (or their planet);
 * - For/Against with a side that is better for us (FOR_AGAINST): that side;
 * - anything else (unknown laws, strategy-card / law / objective elections): abstain.
 * Pass on whens/afters and shenanigans; the speaker breaks ties, resolves and moves on.
 */
import type { AgendaId, Decision, GameState, Option, PlayerState } from "./types.js";
import type { AgendaOutcomeChoice, AgendaOutcomeId } from "./kinds/agenda.js";

/** Elections that are good for whoever (or whose planet) is elected (base + PoK agenda ids). */
const GOOD_TO_WIN = new Set<AgendaId>([
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

/** Elections that hurt whoever (or whose planet) is elected: aim them at the points leader, never at ourselves. */
const BAD_TO_WIN = new Set<AgendaId>(["execution", "standardization", "disarmament", "redistribution"]);

type Ctx = { state: GameState; me: PlayerState };
/** For/Against agendas with a side that is better for us ("for" | "against"), or null when it does not matter. */
const FOR_AGAINST: Partial<Record<AgendaId, (c: Ctx) => "for" | "against" | null>> = {
  // For: each player who voted For gains 1 VP (Against: they lose 1). Bots take the gamble.
  mutiny: () => "for",
  // For: every player discards their TGs and gains 5; Against: every player discards their TGs.
  economic_equality: () => "for",
  // For: players who voted For draw 2 action cards (Against: they discard their hands).
  unconventional: () => "for",
  // For: each player places 1 mech on a home planet; Against: each player destroys all their mechs.
  rearmament: () => "for",
  // For: the player(s) with the most VP gain 1; Against: the player(s) with the fewest VP gain 1.
  seed_empire: ({ state, me }) => {
    const vps = active(state).map((p) => p.victoryPoints);
    if (me.victoryPoints >= Math.max(...vps)) return "for";
    if (me.victoryPoints <= Math.min(...vps)) return "against";
    return null;
  },
  // For: reveal a stage I objective (cheaper to score); Against: a stage II one.
  incentive: () => "for",
};

const active = (state: GameState) => state.players.filter((p) => p.faction && !p.eliminated && p.faction !== "neutral");

/** The outcome we want elected, or null when we would rather not take part. */
export function preferredOutcome(state: GameState | null, me: string, outcomes: AgendaOutcomeChoice[]): string | null {
  const agenda = state?.agenda;
  const id = agenda?.agendaId;
  if (!state || !id) return null;
  const self = state.players.find((p) => p.userId === me);
  if (!self) return null;
  const ids = new Set(outcomes.map((o) => o.id));
  if (agenda.outcomeType === "for_against") {
    const side = FOR_AGAINST[id]?.({ state, me: self }) ?? null;
    return side && ids.has(side) ? side : null;
  }
  const good = GOOD_TO_WIN.has(id);
  const bad = BAD_TO_WIN.has(id);
  if (!good && !bad) return null;
  // Bad elections: the strongest other player (most VP; ties: most TG), so it costs the leader.
  const rivals = active(state)
    .filter((p) => p.userId !== me)
    .sort((a, b) => b.victoryPoints - a.victoryPoints || b.tg - a.tg);
  if (agenda.outcomeType === "player") {
    const isPlayer = (o: AgendaOutcomeChoice, p: PlayerState) => (!!o.userId && o.userId === p.userId) || o.id === p.faction || o.id === p.color;
    if (good) return outcomes.find((o) => isPlayer(o, self))?.id ?? null;
    for (const r of rivals) {
      const o = outcomes.find((x) => isPlayer(x, r));
      if (o) return o.id;
    }
    return null;
  }
  if (agenda.outcomeType === "planet") {
    if (good) {
      const ours = new Set<string>(self.planets);
      return outcomes.find((o) => ours.has(o.id))?.id ?? null;
    }
    for (const r of rivals) {
      const theirs = new Set<string>(r.planets);
      const o = outcomes.find((x) => theirs.has(x.id));
      if (o) return o.id;
    }
    return null;
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
      const outcomes = opts.filter((o) => "outcome" in o.value).map((o) => ({ id: o.value.outcome as AgendaOutcomeId, name: o.value.name as string }));
      const want = preferredOutcome(state, me, outcomes);
      const self = state?.players.find((p) => p.userId === me);
      const o =
        (want && pick((v) => v.outcome === want)) ||
        (state?.agenda?.agendaId && GOOD_TO_WIN.has(state.agenda.agendaId) && pick((v) => v.planetOwner === self?.faction)) ||
        (want && pick((v) => !!v.planetOwner && !!state?.players.some((p) => p.faction === v.planetOwner && (p.planets as string[]).includes(want)))) ||
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
