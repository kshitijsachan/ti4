#!/usr/bin/env node
// Records a game (finished or ongoing) into tests/engine/recordings/<game>.json.
//
//   node tests/engine/record.mjs <game> [--every 10] [--no-web] [--fork pbdN] [--out file]
//
// Reads the bot's undo copies of the game (its last ~100 saves), the shim's #button-log / message store, and the
// bot's live web data. --every N: also materialize the bot's web data at every Nth save (plus the first and last)
// through a fork game (needs the live bot + shim; --fork reuses a fork made earlier, --no-web skips this).
// The recording's checkpoint "live" is the bot's own web data; the materialized copy of the same save is compared
// with it ("fork fidelity") so a broken materializer shows up at record time.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { RECORDINGS_DIR, gameFile, shimState, webData } from "./lib/env.ts";
import { undoIndexes } from "./lib/fork.ts";
import { buildRecording, readUndoSaves, writeRecording, gameChannels, userIndex } from "./lib/recording.ts";
import { materializeAll } from "./lib/materialize.ts";
import { normalizeSave, diffNormalized } from "./lib/savefile.ts";
import { diffWeb } from "./lib/webdiff.ts";

const argv = process.argv.slice(2);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const game = argv.find((a, i) => !a.startsWith("--") && !["--every", "--fork", "--out"].includes(argv[i - 1]));
if (!game) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(2);
}
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const idx = undoIndexes(game);
if (!idx.length) throw new Error(`${game}: no undo saves under the bot storage`);
const saves = readUndoSaves(game, idx);
const state = shimState();
const rec = buildRecording(game, saves, { state });
log(`${game}: ${saves.length} saves (${idx[0]}..${idx.at(-1)}), ${rec.presses.length} logged presses`);

// Live web data (authoritative) and whether the current game file is the latest save.
const live = await webData(game);
const current = existsSync(gameFile(game)) ? readFileSync(gameFile(game), "utf8") : null;
const liveIsLast = current && diffNormalized(normalizeSave(saves.at(-1).text), normalizeSave(current)).length === 0;
if (live) rec.checkpoints.push({ index: "live", web: live });

if (!argv.includes("--no-web")) {
  const every = Number(opt("--every", "10"));
  const pick = saves.filter((_, i) => i === 0 || i === saves.length - 1 || i % every === 0);
  const users = userIndex(state);
  const usernames = new Map(rec.players.map((p) => [p.userId, users.byId.get(p.userId)?.username ?? p.username]));
  const webs = await materializeAll(game, pick.map((s) => s.text), { fork: opt("--fork"), usernames, log, extraChannelIds: gameChannels(state, game).keys() });
  pick.forEach((s, i) => webs[i] && rec.checkpoints.push({ index: s.index, web: webs[i] }));
  if (live && liveIsLast && webs.at(-1)) {
    const d = diffWeb(live, webs.at(-1));
    rec.notes.push(`fork fidelity: materialized web data of save ${idx.at(-1)} vs the bot's live web data: ${d.length} difference(s)${d.length ? ": " + d.slice(0, 5).map((x) => x.path).join(", ") : ""}`);
    log(rec.notes.at(-1));
  }
}

const kinds = {};
for (const a of rec.actions) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
const out = opt("--out", join(RECORDINGS_DIR, `${game}.json`));
writeRecording(out, rec);
console.log(
  `${game}: wrote ${out}\n  saves ${saves.length}, actions ${JSON.stringify(kinds)}, replayable ${rec.actions.filter((a) => a.replayable).length}, ` +
    `with dice ${rec.actions.filter((a) => a.dice).length}, presses logged ${rec.presses.length} (${rec.presses.filter((p) => p.saveIndex === undefined).length} without a save), checkpoints ${rec.checkpoints.length}` +
    (rec.notes.length ? `\n  notes: ${rec.notes.join("; ")}` : ""),
);
process.exit(0);
