#!/usr/bin/env node
// Replays a recording in a fork game on the live bot and compares every save with the recorded one.
//
//   node tests/engine/replay.mjs tests/engine/recordings/<game>.json [--mode step|chain] [--from N] [--to M]
//        [--fork pbdN] [--no-resync] [--stop-on-first] [--ignore key,key] [--out report.json] [--quiet]
//
// step  (default) each action on top of the recorded save before it ("replay from snapshot N", for every N)
// chain load save --from once, then press every action on the fork's own state; a divergence is reported and
//       (unless --no-resync) the fork is reset to the recorded save so dice steps use the recorded outcome.
// Statuses: match, dice (differs, and dice were rolled: expected, the bot's RNG cannot be seeded), diverged
// (differs without dice: a determinism or rules bug), skipped (not replayable from the log: selections, modals,
// web API calls, system saves), resync (chain: state reset to the recording), error.
// The report (JSON) goes to $ENGINE_RUN_DIR/reports/<game>-<mode>.json unless --out is given.
// Exit code 1 if any step diverged without dice.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureRunDir } from "./lib/env.ts";
import { createFork, openFork, closeFork } from "./lib/fork.ts";
import { loadRecording } from "./lib/recording.ts";
import { replay, summarizeReplay } from "./lib/replay.ts";

const argv = process.argv.slice(2);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const path = argv.find((a, i) => a.endsWith(".json") && !["--out"].includes(argv[i - 1]));
if (!path) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(2);
}
const rec = loadRecording(path);
const mode = opt("--mode", "step");
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const fork = opt("--fork") ? await openFork(opt("--fork")) : await createFork(8, log);
log(`replaying ${rec.game} (${rec.actions.length} saves) in ${mode} mode on fork ${fork.game}`);
const quiet = argv.includes("--quiet");
const short = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const results = await replay(rec, fork, {
  mode,
  from: opt("--from") ? Number(opt("--from")) : undefined,
  to: opt("--to") ? Number(opt("--to")) : undefined,
  resync: !argv.includes("--no-resync"),
  stopOnFirst: argv.includes("--stop-on-first"),
  ignore: (opt("--ignore", "") || "").split(",").filter(Boolean),
  log,
  onStep: (r) => {
    if (quiet && r.status === "match") return;
    const extra =
      r.status === "dice" ? ` dice recorded=[${(r.recordedDice ?? []).join(",")}] replay=[${(r.replayDice ?? []).join(",")}]` : r.why ? ` (${r.why})` : "";
    console.log(`${String(r.index).padStart(4)} ${r.status.padEnd(8)} ${short(r.label)}${extra}`);
    if (r.diffs && r.status !== "match") for (const d of r.diffs.slice(0, 6)) console.log(`        ${d.key}: ${short(String(d.expected), 70)}  =>  ${short(String(d.actual), 70)}`);
  },
});
closeFork(fork);
const sum = summarizeReplay(results);
const reportDir = join(ensureRunDir(), "reports");
mkdirSync(reportDir, { recursive: true });
const out = opt("--out", join(reportDir, `${rec.game}-${mode}.json`));
writeFileSync(out, JSON.stringify({ game: rec.game, mode, fork: fork.game, at: new Date().toISOString(), summary: sum, results }, null, 1));
console.log(`\n${rec.game} ${mode}: ${JSON.stringify(sum.counts)} in ${((Date.now() - t0) / 1000).toFixed(0)}s; report ${out}`);
if (sum.firstDivergence) {
  const d = sum.firstDivergence;
  console.log(`first divergence (no dice): save ${d.index} "${d.label}"`);
  for (const x of (d.diffs ?? []).slice(0, 10)) console.log(`   ${x.key}\n      recorded: ${short(String(x.expected), 160)}\n      replay:   ${short(String(x.actual), 160)}`);
} else console.log("no divergence without dice");
process.exit(sum.firstDivergence ? 1 : 0);
