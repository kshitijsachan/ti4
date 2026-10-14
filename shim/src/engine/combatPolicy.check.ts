/**
 * Self-check of the combat autopilot policy on synthetic decisions (run: npx tsx src/engine/combatPolicy.check.ts).
 * Exits non-zero on a failed expectation.
 */
import { chooseCombat, chooseUnitsRemove } from "./combatPolicy.js";
import type { UnitsRemove } from "./kinds/combat.js";
import type { CombatSide, CombatState } from "./kinds/combat.js";
import type { Decision, FactionId, GameState } from "./types.js";

const ME = "u1";
const OPP = "u2";
let failed = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

function state(combat: Partial<CombatState>): GameState {
  return {
    players: [
      { userId: ME, faction: "letnev", self: true },
      { userId: OPP, faction: "sol", self: false },
    ],
    combat: { tile: "201", tileId: "25", factions: ["letnev", "sol"], fronts: [], spaceCannonOffence: [], rolls: [], ...combat },
  } as unknown as GameState;
}

const side = (userId: string, faction: FactionId, roundsRolled: number, units = 1, abilities: CombatSide["abilities"] = []) => ({
  faction,
  userId,
  roundsRolled,
  units: units ? [{ holder: "space" as const, unit: "dd" as const, count: units, damaged: 0, sustain: false }] : [],
  abilities,
});

const opt = (id: string, value: unknown) => ({ id, label: id, style: "secondary", emoji: null, disabled: false, needsInput: false, handler: id, value });

function round(responded: string[], rollType = "combat", extra: unknown[] = []): Decision {
  return {
    id: "d1",
    game: "g",
    kind: "combat.round",
    seq: 1,
    revision: 1,
    stateVersion: 1,
    target: { userId: null, faction: null, color: null, resolvedBy: "none" },
    scope: "table",
    visibility: "public",
    prompt: "",
    options: [
      opt("combatRoll_201_space", { action: "roll", tile: "201", holder: "space", rollType: "combat" }),
      opt("dummyPlayerSpoofsol_combatRoll_201_space", { action: "roll", tile: "201", holder: "space", rollType: "combat" }),
      opt("announceARetreat", { action: "announce_retreat", tile: null }),
      ...extra,
    ],
    source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false },
    createdAt: 1000,
    window: { kind: "combat_roll", subject: { tile: "201", holder: "space", rollType }, eligible: [ME, OPP], responded, responses: {} },
    progress: null,
  } as unknown as Decision;
}

const hits = (target: string, n: number): Decision =>
  ({
    ...round([]),
    id: "h1",
    kind: "combat.hits",
    scope: "player",
    window: null,
    target: { userId: target, faction: null, color: null, resolvedBy: "owner_prefix" },
    options: [
      opt("FFCC_letnev_autoAssignSpaceHits_201_" + n, { action: "auto", tile: "201", holder: "space", source: "space", hits: n, units: [], sustainCancels: 1 }),
      opt("getDamageButtons_201deleteThis_spacecombat", { action: "assign_manual", tile: "201", assignType: "spacecombat" }),
      opt("FFCC_letnev_cancelSpaceHits_201_" + n, { action: "cancel", tile: "201", holder: "space", source: "space", hits: n }),
    ],
  }) as unknown as Decision;

const fight = (mine: number, theirs: number, myUnits = 1, theirUnits = 1) =>
  state({ fronts: [{ holder: "space", sides: [side(ME, "letnev", mine, myUnits), side(OPP, "sol", theirs, theirUnits)] }] });

const pick = (d: Decision, s: GameState, open: Decision[] = []) => chooseCombat(d, s, ME, open)?.option.id ?? null;

expect("rolls round 1", pick(round([]), fight(0, 0)), "combatRoll_201_space");
expect("never the dummy's copy", pick(round([]), fight(0, 0)) !== "dummyPlayerSpoofsol_combatRoll_201_space", true);
expect("not after rolling (window responded)", pick(round([ME]), fight(1, 0)), null);
expect("not ahead of the opponent (stale window)", pick(round([]), fight(1, 0)), null);
expect("rolls round 2 once both rolled", pick(round([]), fight(1, 1)), "combatRoll_201_space");
expect("not while owing hits", pick(round([]), fight(1, 1), [hits(ME, 2)]), null);
expect("opponent's hits do not block", pick(round([]), fight(1, 1), [hits(OPP, 2)]), "combatRoll_201_space");
expect("not when the fight is over", pick(round([]), fight(1, 1, 1, 0)), null);
expect("not without a combat in state", pick(round([]), state({ fronts: [] })), null);
expect("auto-assigns hits owed to me", pick(hits(ME, 2), fight(1, 1)), "FFCC_letnev_autoAssignSpaceHits_201_2");
expect("never another's hits", pick(hits(OPP, 2), fight(1, 1)), null);
expect("never zero hits", pick(hits(ME, 0), fight(1, 1)), null);
// Shields Holding cancelled 2 of 3 hits (engine value: hits 1, promptHits 3, cancelled 2): "Cancel a Hit", never auto.
const shielded = hits(ME, 3);
(shielded.options[0].value as Record<string, unknown>).hits = 1;
Object.assign(shielded.options[0].value as Record<string, unknown>, { promptHits: 3, cancelled: 2 });
expect("Shields Holding: cancels a hit instead of auto-assigning", pick(shielded, fight(1, 1)), "FFCC_letnev_cancelSpaceHits_201_3");

const afb = round([], "afb", [opt("combatRoll_201_space_afb", { action: "roll", tile: "201", holder: "space", rollType: "afb" })]);
expect("afb once", pick(afb, fight(0, 0)), "combatRoll_201_space_afb");
const afbDone = state({
  fronts: [],
  rolls: [{ at: 2000, faction: "letnev", opponent: "sol", tile: "201", holder: "space", rollType: "afb", round: null, hits: 0, dice: [] }],
});
expect("afb not twice", pick(afb, afbDone), null);

// Unit-removal list after a fleet pool / capacity reminder (live pbd114, Keleres in 307: 2 cv + ca + fs, 2 ff, 2 gf).
const removal = {
  id: "d9",
  kind: "combat.assign_units",
  scope: "player",
  target: { userId: ME, faction: "letnev", color: "red", resolvedBy: "owner_prefix" },
  window: null,
  progress: null,
  createdAt: 0,
  options: [
    opt("FFCC_letnev_assignHits_307_1_ca_red", { action: "destroy", tile: "307", count: 1, unit: "ca", holder: "space", damaged: false, state: "none", assignType: "remove" }),
    opt("deleteButtons", { action: "done", tile: null, assignType: "remove" }),
  ],
} as unknown as Decision;
const board = (fleet: number, space: [string, number][]) =>
  ({
    players: [{ userId: ME, faction: "letnev", color: "red", self: true, commandTokens: { tactic: 3, fleet, strategy: 2 } }],
    tiles: [
      { position: "307", tileId: "x", holders: [{ name: "space", units: space.map(([unit, count]) => ({ owner: "letnev", color: "red", unit, count })), tokens: [], control: [] }, { name: "valkk", units: [{ owner: "letnev", color: "red", unit: "sd", count: 1 }], tokens: [], control: [] }] },
    ],
  }) as unknown as GameState;
const pbd114: [string, number][] = [["cv", 2], ["ca", 1], ["fs", 1], ["ff", 2], ["gf", 2]];
expect("removal list, over the fleet pool: left to the unit-limit desk", pick(removal, board(3, pbd114)), null);
expect("removal list, within limits: done", pick(removal, board(4, pbd114)), "deleteButtons");
expect("removal list, cargo over the least capacity: left to the desk", pick(removal, board(4, [["ca", 1], ["gf", 3]])), null);
expect("removal list of another player: never", chooseCombat({ ...removal, target: { userId: OPP } } as unknown as Decision, board(4, pbd114), ME), null);

// pbd114 loop (00:55 merge): pickUnit's "nothing owed: Done" closed the over-limit list before the desk removed a unit,
// and units.remove dismissed the reminder itself. Neither may happen while the board shows us over the limits.
const reminder = {
  id: "d10",
  kind: "units.remove",
  scope: "player",
  target: { userId: ME, faction: "letnev", color: "red", resolvedBy: "owner_prefix" },
  window: null,
  progress: null,
  createdAt: 0,
  options: [
    opt("getDamageButtons_307_remove", { action: "open", tile: "307", assignType: "remove" }),
    opt("deleteButtons", { action: "done", tile: null, assignType: null }),
  ],
} as unknown as UnitsRemove;
const remind = (s: GameState, history: string[] = []) => chooseUnitsRemove(reminder, ME, history, [], s)?.option.id ?? null;
expect("pbd114: over-limit list is never closed by pickUnit (no hits owed)", chooseCombat(removal, board(3, pbd114), ME), null);
expect("pbd114: over-limit reminder is not dismissed (the desk removes)", remind(board(3, pbd114)), null);
expect("pbd114: nor opened again after a press", remind(board(3, pbd114), ["getDamageButtons_307_remove"]), null);
expect("reminder within limits: dismissed", remind(board(4, pbd114)), "deleteButtons");
expect("reminder without a board: left alone", chooseUnitsRemove(reminder, ME, [], [], null), null);
const hitsMenu = { ...removal, progress: { flow: "assign", step: "assign", accumulated: {}, required: { hits: 1 }, canCommit: false } } as unknown as Decision;
expect("hits owed: pickUnit still assigns", pick(hitsMenu, board(3, pbd114)), "FFCC_letnev_assignHits_307_1_ca_red");

// BOMBARDMENT hits (combat.hits without an auto option; the manual option carries hits / planet / units): one plan.
const bombHits = (hits: number | null, units: { holder: string; unit: string; count: number; damaged: number; sustain: boolean }[], sustainCancels = 1) =>
  ({
    id: "d11",
    kind: "combat.hits",
    scope: "player",
    target: { userId: ME, faction: "letnev", color: "red", resolvedBy: "owner_prefix" },
    window: null,
    progress: null,
    createdAt: 0,
    options: [opt("FFCC_letnev_getDamageButtons_201_bombardment", { action: "assign_manual", tile: "201", assignType: "bombardment", source: "ground", holder: "jord", hits, units, sustainCancels })],
  }) as unknown as Decision;
const planOf = (d: Decision) => (chooseCombat(d, fight(1, 1), ME) as { act?: { action: string; body: { plan: unknown[] } } } | null)?.act;
const jord = [
  { holder: "jord", unit: "mf", count: 1, damaged: 0, sustain: true },
  { holder: "jord", unit: "gf", count: 3, damaged: 0, sustain: false },
];
expect("bombardment: the mech sustains, then infantry die", JSON.stringify(planOf(bombHits(3, jord))), JSON.stringify({ action: "combat-plan", body: { plan: [
  { holder: "jord", unit: "mf", damaged: false, action: "sustain", count: 1 },
  { holder: "jord", unit: "gf", damaged: false, action: "destroy", count: 2 },
] } }));
expect("bombardment: 1 hit, a mech present: sustain only", JSON.stringify(planOf(bombHits(1, jord))?.body.plan), JSON.stringify([{ holder: "jord", unit: "mf", damaged: false, action: "sustain", count: 1 }]));
expect("bombardment: a damaged mech dies after the infantry", JSON.stringify(planOf(bombHits(5, [{ holder: "jord", unit: "mf", count: 1, damaged: 1, sustain: true }, { holder: "jord", unit: "gf", count: 2, damaged: 0, sustain: false }]))?.body.plan), JSON.stringify([
  { holder: "jord", unit: "gf", damaged: false, action: "destroy", count: 2 },
  { holder: "jord", unit: "mf", damaged: true, action: "destroy", count: 1 },
]));
expect("bombardment: hits unknown: left alone", chooseCombat(bombHits(null, jord), fight(1, 1), ME), null);
expect("bombardment: someone else's hits: never", chooseCombat({ ...bombHits(2, jord), target: { userId: OPP } } as unknown as Decision, fight(1, 1), ME), null);

// pbd60 / pbd161: the per-unit menu opened from a bombardment opener (no progress) was closed with Done, nothing removed.
const bombMenu = {
  id: "d12",
  kind: "combat.assign_units",
  scope: "player",
  target: { userId: ME, faction: "letnev", color: "red", resolvedBy: "owner_prefix" },
  window: null,
  progress: null,
  createdAt: 0,
  options: [
    opt("FFCC_letnev_assignHits_201_1_gf_jord_red", { action: "destroy", tile: "201", count: 1, unit: "gf", holder: "jord", damaged: false, state: "none", assignType: "bombardment" }),
    opt("FFCC_letnev_assignHits_201_1_pd_jord_red", { action: "destroy", tile: "201", count: 1, unit: "pd", holder: "jord", damaged: false, state: "none", assignType: "bombardment" }),
    opt("FFCC_letnev_assignHits_201_All", { action: "destroy_all", tile: "201", assignType: "bombardment" }),
    opt("deleteButtons", { action: "done", tile: null, assignType: "bombardment" }),
  ],
} as unknown as Decision;
const menuPick = (open: Decision[], history: string[]) => chooseCombat(bombMenu, fight(1, 1), ME, open, history)?.option.id ?? null;
expect("bombardment menu, hits unknown: remove an infantry (never the PDS)", menuPick([], []), "FFCC_letnev_assignHits_201_1_gf_jord_red");
expect("bombardment menu, one removed: done", menuPick([], ["FFCC_letnev_assignHits_201_1_gf_jord_red"]), "deleteButtons");
const owed2 = bombHits(2, jord);
(owed2 as unknown as { options: { value: { tile: string } }[] }).options[0].value.tile = "201";
expect("bombardment menu while the hits prompt is open: its plan assigns (hold)", menuPick([owed2], []), null);
expect("bombardment menu, 2 owed, one removed: one more", menuPick([owed2], ["FFCC_letnev_assignHits_201_1_gf_jord_red"]), "FFCC_letnev_assignHits_201_1_gf_jord_red");

// Letnev agent (Viscount Unlenn): on the combat controls (no roll window); used before our roll, then the roll waits for its picker.
const agentOpt = (blocked: string | null, owner = "letnev") =>
  opt("FFCC_letnev_getAgentSelection_letnevagent", { action: "ability", tile: "201", ability: "letnevagent", source: "agent", owner, name: "Viscount Unlenn", window: "At the start of a space combat round", blocked });
const controls = (o: unknown): Decision => ({ ...round([]), id: "c1", window: null, options: [o] }) as unknown as Decision;
const allPick = (d: Decision, s: GameState, all: Decision[], open: Decision[] = []) => chooseCombat(d, s, ME, open, [], all)?.option.id ?? null;
expect("round agent: used from the controls", allPick(controls(agentOpt(null)), fight(0, 0), []), "FFCC_letnev_getAgentSelection_letnevagent");
expect("round agent: roll waits while it is ready", allPick(round([]), fight(0, 0), [controls(agentOpt(null))]), null);
expect("round agent: exhausted -> roll", allPick(round([]), fight(0, 0), [controls(agentOpt("the agent is exhausted"))]), "combatRoll_201_space");
expect("round agent: not another faction's", allPick(controls(agentOpt(null, "sol")), fight(0, 0), []), null);
const picker = { ...hits(ME, 0), id: "p1", kind: "leader.use", options: [opt("FFCC_letnev_exhaustAgent_letnevagent_letnev", { leader: "letnevagent", step: "exhaustAgent", action: "target", target: "letnev" })] } as unknown as Decision;
expect("round agent: roll waits for its picker", allPick(round([]), fight(0, 0), [controls(agentOpt("the agent is exhausted"))], [picker]), null);
process.exit(failed ? 1 : 0);
