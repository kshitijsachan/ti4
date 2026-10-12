/**
 * Self-check of the contract validator (run: npx tsx src/engine/validate.check.ts). Exits non-zero on a failure.
 */
import { createValidator } from "./validate.js";

let failed = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

function run(fn: (v: ReturnType<typeof createValidator>) => void): string[] {
  const out: string[] = [];
  const v = createValidator((m) => out.push(m), true);
  fn(v);
  return out.map((m) => m.replace(/^engine contract drift: unknown /, ""));
}

const cleanState = {
  phase: "action",
  players: [
    {
      userId: "u1",
      faction: "letnev",
      color: "red",
      strategyCards: [7],
      techs: ["amd", "pa"],
      exhaustedTechs: [],
      planets: ["arcprime", "wrenterra"],
      exhaustedPlanets: ["arcprime"],
      relics: ["shard"],
      fragments: ["crf1"],
      leaders: ["letnevagent", "letnevcommander:locked", "letnevhero:locked"],
      promissoryNotesInPlayArea: ["blue_sftt"],
      secretsScored: { ans: 12 },
      hand: { actionCards: { sabo1: 3 }, secretObjectives: { mp: 4 }, promissoryNotes: { red_cf: 1, war_funding: 2 } },
    },
  ],
  strategyCards: [{ number: 7, holder: "u1", card: "pok7technology", holderFaction: "letnev", reactions: [{ faction: "letnev" }] }],
  tiles: [
    {
      position: "000",
      tileId: "18",
      holders: [
        { name: "space", units: [{ owner: "letnev", color: "red", unit: "dn", count: 1 }], tokens: [], control: [] },
        { name: "mr", units: [{ owner: "letnev", color: "red", unit: "gf", count: 2 }], tokens: [], control: [] },
      ],
    },
  ],
  publicObjectives: { corner: ["u1"], "Custodian/Imperial": ["u1"] },
  laws: ["minister_war"],
  agenda: { agendaId: "mutiny", stage: "agendaVoting", number: 2 },
  status: { players: { u1: { publicScored: "none", secretScored: "ans" } } },
};

expect("clean state", run((v) => v.state(cleanState, "s")), []);

const drift = structuredClone(cleanState) as typeof cleanState;
drift.phase = "statusScoringX";
drift.players[0].faction = "homebrewfaction";
drift.players[0].techs.push("absol_amd");
drift.players[0].leaders.push("nopeagent:exhausted");
drift.players[0].hand.actionCards = { sabo1: 3, madeup: 9 } as typeof drift.players[0]["hand"]["actionCards"];
drift.tiles[0].holders[1].name = "notaplanet";
drift.tiles[0].holders[0].units[0].unit = "plenaryorbital";
drift.strategyCards[0].number = 9;
expect(
  "drift state",
  run((v) => v.state(drift, "s")).map((m) => m.split(" at ")[0]),
  [
    'phase "statusScoringX"',
    'faction "homebrewfaction"',
    'tech "absol_amd"',
    'leaderStatus "nopeagent:exhausted"',
    'actionCard "madeup"',
    'unit "plenaryorbital"',
    'holder "notaplanet"',
    'strategyCardNumber 9',
  ],
);

expect(
  "reported once per id",
  run((v) => {
    v.state(drift, "a");
    v.state(drift, "b");
  }).length,
  8,
);

const decision = {
  id: "d1",
  kind: "strategy_card.resolve",
  target: { userId: "u1", faction: "letnev", color: "red", resolvedBy: "owner_prefix" },
  options: [
    { id: "o1", value: { strategyCard: 4, holder: "letnev", unit: "spacedock", card: "pok4construction" } },
    { id: "o2", value: null },
  ],
  window: { kind: "strategy_card", subject: { holder: "letnev", owner: "u1" } },
  progress: null,
};
expect("strategy card vocabulary is not unit / holder", run((v) => v.decision(decision, "d")), []);

const land = {
  id: "d2",
  kind: "tactical.land",
  target: null,
  options: [{ id: "o1", value: { op: "land", position: "101", planet: "jord", unit: "gf", count: 1, color: "blue", owner: "sol" } }],
  progress: { accumulated: { position: "101", inSpace: [{ unit: "zz", count: 1 }], onPlanets: [] } },
};
expect("decision drift", run((v) => v.decision(land, "d")).map((m) => m.split(" at ")[0]), ['unit "zz"']);

expect("disabled validator is silent", (() => {
  const out: string[] = [];
  createValidator((m) => out.push(m), false).state(drift, "s");
  return out;
})(), []);

expect("never throws", (() => {
  const out: string[] = [];
  const v = createValidator((m) => out.push(m), true);
  const evil = { get players() { throw new Error("boom"); } };
  v.state(evil, "s");
  return out.length;
})(), 1);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
