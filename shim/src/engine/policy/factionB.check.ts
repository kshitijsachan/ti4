/**
 * Self-check of the Creuss / L1Z1X / Mentak / Naalu / Nekro / Sardakk faction-step policy on synthetic decisions
 * (run: npx tsx src/engine/policy/factionB.check.ts). Exits non-zero on a failed expectation.
 */
import { chooseTyped } from "../autopilot.js";
import type { Decision, GameState } from "../types.js";

const ME = "u1";
let failed = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const ships = (color: string) => [{ owner: null, color, unit: "ca", count: 1, damaged: 0, galvanized: 0 }];
function state(combatTile: string | null, space: { color: string }[] = []): GameState {
  return {
    players: [
      { userId: ME, faction: "mentak", color: "black" },
      { userId: "u2", faction: "sol", color: "blue" },
    ],
    tiles: [{ position: "201", tileId: "25", holders: [{ name: "space", units: space.flatMap((s) => ships(s.color)), tokens: [], control: [] }] }],
    combat: combatTile ? { tile: combatTile, tileId: "25", factions: [], fronts: [], spaceCannonOffence: [], rolls: [] } : null,
  } as unknown as GameState;
}

let n = 0;
function decision(kind: string, opts: [string, Record<string, unknown> | null][]): Decision {
  return {
    id: `d${++n}`, game: "g", kind, seq: 1, stateVersion: 1, revision: 1,
    target: { userId: ME, faction: "mentak", color: "black", resolvedBy: "faction_component" },
    scope: "player", visibility: "public", prompt: "",
    options: opts.map(([handler, value]) => ({ id: handler, label: handler, style: "secondary", emoji: null, disabled: false, needsInput: false, handler, value })),
    source: { channelId: "c", messageId: "m", customIdPrefix: "", ephemeral: false },
    window: null, progress: null,
  } as unknown as Decision;
}
const ab = (step: string, action: string, extra: Record<string, unknown> = {}) => ({ source: "ability", id: step, faction: "mentak", step, action, optional: true, ...extra });
const pick = (d: Decision, s: GameState) => chooseTyped(d, s, ME)?.option?.handler ?? null;

expect("ambush pressed", pick(decision("faction.ability", [["rollForAmbush_201", ab("rollForAmbush", "use", { tile: "201" })]]), state("201")), "rollForAmbush_201");
expect(
  "ambush before hero",
  pick(decision("faction.ability", [["purgeMentakHero_201", null], ["rollForAmbush_201", ab("rollForAmbush", "use", { tile: "201" })]]), state("201")),
  "rollForAmbush_201",
);
expect(
  "pillage taken",
  pick(decision("faction.ability", [["pillage_blue_unchecked", ab("pillage", "use", { target: "sol" })], ["declinePillage_blue", ab("declinePillage", "skip")]]), state(null)),
  "pillage_blue_unchecked",
);
expect(
  "pillage: trade good",
  pick(decision("faction.ability", [["pillage_blue_checkedcomm", ab("pillage", "target", { what: "commodity" })], ["pillage_blue_checked", ab("pillage", "target", { what: "tg" })]]), state(null)),
  "pillage_blue_checked",
);
const salvage = decision("faction.ability", [["salvageOps_201", ab("salvageOps", "use", { tile: "201" })]]);
expect("salvage waits during combat", pick(salvage, state("201", [{ color: "black" }, { color: "blue" }])), null);
expect("salvage after a won combat", pick(salvage, state(null, [{ color: "black" }])), "salvageOps_201");
expect("salvage not after a draw", pick(salvage, state(null, [])), null);
const cmdr = decision("leader.use", [["mentakCommander_blue", { leader: "mentakcommander", step: "mentakCommander", action: "use", optional: true, target: "sol" }], ["deleteButtons", null]]);
expect("commander waits during combat", pick(cmdr, state("201", [{ color: "black" }, { color: "blue" }])), null);
expect("commander after a win", pick(cmdr, state(null, [{ color: "black" }])), "mentakCommander_blue");
const cmdr2 = decision("leader.use", [["mentakCommander_blue", { leader: "mentakcommander", step: "mentakCommander", action: "use", optional: true, target: "sol" }], ["deleteButtons", null]]);
pick(cmdr2, state("201", [{ color: "black" }, { color: "blue" }]));
expect("commander declined after a loss", pick(cmdr2, state(null, [{ color: "blue" }])), "deleteButtons");
expect(
  "propagation: 3 command tokens",
  pick(decision("faction.ability", [["propagationResearch_first", ab("propagationResearch", "skip")], ["propagationGainCC", ab("propagationGainCC", "use", { amount: 3 })]]), state(null)),
  "propagationGainCC",
);
expect(
  "sardakk commander declined (generic)",
  pick(decision("leader.use", [["sardakkcommander_infantry_a_b", { leader: "sardakkcommander", step: "sardakkcommander", action: "use", optional: true }], ["deleteButtons", null]]), state(null)),
  "deleteButtons",
);
expect(
  "creuss mech wormhole: first",
  pick(decision("faction.ability", [["creussMechStep3_201_alpha", ab("creussMechStep3", "target", { optional: false, wormhole: "alpha" })], ["creussMechStep3_201_beta", ab("creussMechStep3", "target", { optional: false, wormhole: "beta" })]]), state(null)),
  "creussMechStep3_201_alpha",
);

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
