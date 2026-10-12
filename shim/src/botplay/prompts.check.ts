/** Self-check of the button-lock helpers (run: npx tsx src/botplay/prompts.check.ts). */
import { lockIs } from "./prompts.js";

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

process.exit(failed ? 1 : 0);
