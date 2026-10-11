#!/usr/bin/env node
// Invariant check of a game (live, from the bot + its save files) or of a recording.
//
//   node tests/engine/check.mjs <game> [--history] [--materialize] [--fork pbdN] [--json] [--warn]
//   node tests/engine/check.mjs tests/engine/recordings/<game>.json [--json] [--warn]
//
// <game>: the live web data and current save, plus (--history) every undo copy the bot still keeps: card-zone and
// speaker checks on each save and the sequence checks (round / phase / techs / secrets) between them. --materialize
// also turns every undo copy into web data through a fork game (see lib/fork.ts) so the web-data invariants and the
// VP sequence run on the history too (~1-2 s per save). Exit code 1 when any error-severity invariant fails.
import { readFileSync, existsSync } from "node:fs";
import { gameFile, undoFile, webData } from "./lib/env.ts";
import { checkSnapshot, checkSequence, summarize, INVARIANTS } from "./lib/invariants.ts";
import { undoIndexes } from "./lib/fork.ts";
import { loadRecording, recordingSnapshots } from "./lib/recording.ts";
import { materializeAll } from "./lib/materialize.ts";

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const target = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--fork"].includes(argv[i - 1])));
if (!target || flag("--help")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  console.log("\nInvariants:\n" + INVARIANTS.map((i) => `  ${i.severity.padEnd(5)} ${i.id}: ${i.what}`).join("\n"));
  process.exit(target ? 0 : 2);
}

let snapshots = [];
let title = target;
if (target.endsWith(".json") && existsSync(target)) {
  const rec = loadRecording(target);
  title = `recording ${rec.game}`;
  snapshots = recordingSnapshots(rec);
} else {
  const game = target;
  if (flag("--history") || flag("--materialize")) {
    const idx = undoIndexes(game);
    let saves = idx.map((i) => ({ id: i, save: readFileSync(undoFile(game, i), "utf8") }));
    for (const s of saves) s.label = /^latest_command (.*)$/m.exec(s.save)?.[1];
    if (flag("--materialize")) {
      const webs = await materializeAll(game, saves.map((s) => s.save), { fork: opt("--fork"), log: (m) => console.error(m) });
      saves = saves.map((s, i) => ({ ...s, web: webs[i] }));
    }
    snapshots.push(...saves);
  }
  const live = await webData(game);
  if (!live) console.error(`(no web data for ${game}: fog of war, unknown game or the bot is down)`);
  snapshots.push({ id: "live", web: live, save: existsSync(gameFile(game)) ? readFileSync(gameFile(game), "utf8") : null, label: "live" });
}

const violations = [];
for (const s of snapshots) violations.push(...checkSnapshot(s));
violations.push(...checkSequence(snapshots.filter((s) => s.id !== "live" || snapshots.length === 1)));

const shown = flag("--warn") ? violations : violations.filter((v) => v.severity === "error");
if (flag("--json")) console.log(JSON.stringify({ target: title, snapshots: snapshots.length, violations: shown }, null, 1));
else {
  const errors = violations.filter((v) => v.severity === "error").length;
  console.log(`${title}: ${snapshots.length} snapshot(s), ${errors} error(s), ${violations.length - errors} warning(s)`);
  for (const [id, list] of summarize(shown)) {
    // A violation that persists across snapshots is reported once with the snapshots it was seen in.
    const byMsg = new Map();
    for (const v of list) {
      const k = `${v.player ?? ""}|${v.message.replace(/ \(after .*\)$/, "")}`;
      if (!byMsg.has(k)) byMsg.set(k, { v, at: [] });
      byMsg.get(k).at.push(v.snapshot);
    }
    console.log(`  [${list[0].severity}] ${id} (${list.length})`);
    for (const { v, at } of [...byMsg.values()].slice(0, 12))
      console.log(`     ${v.player ? v.player + ": " : ""}${v.message}${at.length > 1 ? `  [x${at.length}: ${at.slice(0, 3).join(",")}${at.length > 3 ? ",…" : ""}]` : ` [${at[0]}]`}`);
    if (byMsg.size > 12) console.log(`     … ${byMsg.size - 12} more`);
  }
}
process.exit(violations.some((v) => v.severity === "error") ? 1 : 0);
