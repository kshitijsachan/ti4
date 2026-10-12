/**
 * Self-check of the agenda / trade-initiative autopilot policy (run: npx tsx src/engine/agendaPolicy.check.ts).
 * Regression for the pbd161 playtest: bots abstained on every agenda (only "good to win" elections got a vote) and
 * proposed commodity washes during the status and agenda phases.
 */
import { chooseAgenda } from "./agendaPolicy.js";
import { proposesTradesIn } from "./tradePolicy.js";
import type { Decision, GameState } from "./types.js";

const ME = "u1";
let failed = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const player = (userId: string, faction: string, color: string, vp: number, planets: string[], tg = 0) =>
  ({ userId, faction, color, victoryPoints: vp, tg, planets, eliminated: false, passed: false }) as any;
const players = [player(ME, "naaz", "emerald", 3, ["naazir", "rokha"]), player("u2", "winnu", "lavender", 6, ["winnu"], 4), player("u3", "nekro", "ruby", 1, ["mordaiii"])];

function state(agendaId: string, outcomeType: string, ps = players): GameState {
  return { phase: "agendaVoting", players: ps, agenda: { agendaId, outcomeType, stage: "agendaVoting" } } as unknown as GameState;
}

function vote(outcomeType: string, outcomes: { id: string; userId?: string }[], available = 5): Decision {
  const ballot = { action: "vote", outcomeType, outcomes: outcomes.map((o) => ({ name: o.id, ...o })), planets: [{ planet: "naazir", votes: 3 }], available };
  return {
    id: "d1",
    kind: "agenda.vote",
    scope: "player",
    target: { userId: ME },
    options: [
      { id: "vote", label: "Vote", disabled: false, needsInput: false, value: ballot },
      { id: "resolveAgendaVote_0", label: "Abstain", disabled: false, needsInput: false, value: { action: "abstain" } },
    ],
  } as unknown as Decision;
}

const forAgainst = vote("for_against", [{ id: "for" }, { id: "against" }]);
const electPlayer = vote("player", [{ id: "naaz", userId: ME }, { id: "winnu", userId: "u2" }, { id: "nekro", userId: "u3" }]);
const electPlanet = vote("planet", [{ id: "naazir" }, { id: "rokha" }, { id: "winnu" }, { id: "mordaiii" }]);
const what = (d: Decision, s: GameState) => {
  const c = chooseAgenda(d, s, ME);
  return c?.payload ? c.payload.outcome : c?.option.value.action;
};

expect("mutiny: vote For", what(forAgainst, state("mutiny", "for_against")), "for");
expect("economic equality: vote For", what(forAgainst, state("economic_equality", "for_against")), "for");
expect("seed of an empire, middle of the table: abstain", what(forAgainst, state("seed_empire", "for_against")), "abstain");
expect(
  "seed of an empire, we lead: For",
  what(forAgainst, state("seed_empire", "for_against", [player(ME, "naaz", "emerald", 7, []), ...players.slice(1)])),
  "for",
);
expect(
  "seed of an empire, we trail: Against",
  what(forAgainst, state("seed_empire", "for_against", [player(ME, "naaz", "emerald", 0, []), ...players.slice(1)])),
  "against",
);
expect("unknown for/against law (conventions): abstain", what(forAgainst, state("conventions", "for_against")), "abstain");
expect("minister of war: elect ourselves", what(electPlayer, state("minister_war", "player")), "naaz");
expect("public execution: elect the points leader", what(electPlayer, state("execution", "player")), "winnu");
expect("committee formation: elect ourselves", what(electPlayer, state("committee", "player")), "naaz");
expect("core mining: our planet", what(electPlanet, state("core_mining", "planet")), "naazir");
expect("colonial redistribution: the leader's planet", what(electPlanet, state("redistribution", "planet")), "winnu");
expect("no votes available: abstain", what(vote("for_against", [{ id: "for" }, { id: "against" }], 0), state("mutiny", "for_against")), "abstain");

expect("trade washes: action phase", proposesTradesIn("action"), true);
for (const ph of ["strategy", "status", "agendawaiting", "agendaVoting", "agendaEnd", null]) expect(`trade washes: not in ${ph}`, proposesTradesIn(ph), false);

if (failed) {
  console.log(`${failed} FAILED`);
  process.exit(1);
}
console.log("all ok");
