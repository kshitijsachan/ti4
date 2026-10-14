/**
 * Self-check of the generic faction-step policy (policy/faction.ts) on synthetic decisions
 * (run: npx tsx src/engine/policy/faction.check.ts). Exits non-zero on a failed expectation.
 *
 * Magen Defense Grid ΩΩ / Black Trench Bulwark ("When any player activates a system that contains 1 or more of your
 * structures, place 1 infantry ... with each of those structures") is mandatory: the bot presses it at once, also when
 * a decline is offered, so the active player's tactical action never waits on it (soak pbd1859).
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

const state = { players: [{ userId: ME, faction: "arborec", color: "turquoise", tg: 0 }], tiles: [], combat: null } as unknown as GameState;

let n = 0;
function decision(opts: [string, Record<string, unknown> | null][]): Decision {
  return {
    id: `d${++n}`, game: "g", kind: "faction.ability", seq: 1, stateVersion: 1, revision: 1,
    target: { userId: ME, faction: "arborec", color: "turquoise", resolvedBy: "owner_prefix" },
    scope: "player", visibility: "public", prompt: "",
    options: opts.map(([handler, value]) => ({ id: handler, label: handler, style: "danger", emoji: null, disabled: false, needsInput: false, handler, value })),
    source: { channelId: "c", messageId: "m", customIdPrefix: "", ephemeral: false },
    window: null, progress: null,
  } as unknown as Decision;
}
const magen = { source: "tech", id: "magen", faction: null, step: "useMagenDefense", action: "use", optional: true, tile: "404" };
const pick = (d: Decision) => chooseTyped(d, state, ME);

const only = pick(decision([["useMagenDefense_404", magen]]));
expect("Magen ΩΩ pressed", only?.option?.handler ?? null, "useMagenDefense_404");
expect("Magen ΩΩ reason", /free gain/.test(only?.why ?? ""), true);
expect(
  "Magen ΩΩ pressed even with a decline offered",
  pick(decision([["useMagenDefense_404", magen], ["deleteButtons", null]]))?.option?.handler ?? null,
  "useMagenDefense_404",
);
expect(
  "Black Trench Bulwark (same step) pressed",
  pick(decision([["useMagenDefense_211", { ...magen, id: "tk-blacktrenchbulwark", tile: "211" }]]))?.option?.handler ?? null,
  "useMagenDefense_211",
);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all ok");
