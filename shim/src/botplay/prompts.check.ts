/** Self-check of the button-lock helpers (run: npx tsx src/botplay/prompts.check.ts). */
import { controlsOf, lockIs } from "./prompts.js";

let failed = 0;
const expect = (name: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${String(got)}, want ${String(want)}`}`);
};

// Live pbd114: the autopilot names Keleres "keleres"; the bot locks its buttons to the flavour.
expect("keleres family owns keleresa's lock", lockIs("FFCC_keleresa_assignHits_307_1_ca_vapourwave", "keleres"), true);
expect("and the flavour itself", lockIs("FFCC_keleresa_turnEnd", "keleresa"), true);
expect("another faction's lock", lockIs("FFCC_mentak_turnEnd", "keleres"), false);
expect("no lock", lockIs("deleteButtons", "keleres"), false);
expect("plain factions unchanged", lockIs("FFCC_sol_tacticalAction", "sol"), true);

// controlsOf is memoized per components array (a stored message's components are replaced on edit, never mutated).
const row = [{ type: 1, components: [{ type: 2, style: 1, custom_id: "a", label: "A" }, { type: 2, style: 5, url: "x", label: "link" }] }];
expect("controlsOf: one control", controlsOf(row).length, 1);
expect("controlsOf: same array, same answer object", controlsOf(row), controlsOf(row));
const edited = [{ type: 1, components: [{ type: 2, style: 1, custom_id: "b", label: "B" }, { type: 2, style: 1, custom_id: "c", label: "C", disabled: true }] }];
expect("controlsOf: a replaced array is read afresh", controlsOf(edited)[0].custom_id, "b");
expect("controlsOf: no components", controlsOf(undefined).length, 0);

process.exit(failed ? 1 : 0);
