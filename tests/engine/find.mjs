#!/usr/bin/env node
// Finds recorded actions (backtest material) by handler / custom id / button label / slash command / card name.
//
//   node tests/engine/find.mjs <regex> [--in pbd75,pbd113] [--state] [--names] [--limit 40] [--json] [--replayable]
//
// <regex> (case-insensitive) is matched against every recorded action's custom id, button label, save label
// (latest_command) and slash command text. Card / ability / tech / leader names are resolved to their ids through
// the bot's data (BOT_RESOURCES/data/**.json: "Sabotage" also finds "sabo"; --names prints the resolution).
// --state also searches the saves: lines that APPEAR in save N matching the regex (e.g. a card entering a hand
// "ac sabo", a tech "gd", a stored value) -> "state" hits; this is how to find games where a card was merely held.
// Each hit prints the replay command for exactly that step:
//   node tests/engine/replay.mjs tests/engine/recordings/<game>.json --via engine --from <N-1> --to <N> --no-web
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BOT_RESOURCES, RECORDINGS_DIR } from "./lib/env.ts";

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const pat = argv.find((a, i) => !a.startsWith("--") && !["--in", "--limit"].includes(argv[i - 1]));
if (!pat) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(2);
}
const limit = Number(opt("--limit", 40));
const only = (opt("--in", "") || "").split(",").filter(Boolean);

/* names -> ids from the bot's data */
function* jsonFiles(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* jsonFiles(p);
    else if (f.endsWith(".json")) yield p;
  }
}
const nameRe = new RegExp(pat, "i");
const ids = new Set();
const resolved = [];
const dataDir = join(BOT_RESOURCES, "data");
if (existsSync(dataDir)) {
  for (const p of jsonFiles(dataDir)) {
    let arr;
    try {
      arr = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    for (const o of arr) {
      if (!o || typeof o !== "object" || typeof o.name !== "string") continue;
      const id = o.alias ?? o.id;
      if (typeof id !== "string" || id.length < 2) continue;
      if (nameRe.test(o.name)) {
        ids.add(id);
        if (o.automationID && typeof o.automationID === "string") ids.add(o.automationID);
        resolved.push(`${o.name} -> ${id} (${p.slice(dataDir.length + 1)})`);
      }
    }
  }
}
if (flag("--names")) for (const r of resolved.slice(0, 50)) console.error(`  ${r}`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// ids match as whole tokens inside custom ids (sabo in "sabotage_sabo_ac" but not "sabotagexyz") — loose: delimiters _ ; , space.
const idRe = ids.size ? new RegExp(`(^|[_;,: ~.-])(${[...ids].slice(0, 300).map(esc).join("|")})($|[_;,: ~.-])`, "i") : null;
const re = new RegExp(pat, "i");
const matches = (s) => !!s && (re.test(s) || (idRe ? idRe.test(s) : false));

import { loadRecording, recordingSaves } from "./lib/recording.ts";

const files = readdirSync(RECORDINGS_DIR)
  .filter((f) => f.endsWith(".json") && (!only.length || only.includes(f.replace(/\.json$/, ""))))
  .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
const hits = [];
const perGame = {};
for (const f of files) {
  const rec = loadRecording(join(RECORDINGS_DIR, f));
  for (const a of rec.actions) {
    if (flag("--replayable") && !a.replayable) continue;
    const fields = [a.customId, a.buttonLabel, a.label, a.command?.text, a.command ? `/${a.command.path?.join(" ")}` : null];
    if (fields.some(matches)) {
      hits.push({ game: rec.game, file: join("tests/engine/recordings", f), index: a.index, type: "action", kind: a.kind, user: a.user?.username, customId: a.customId, label: a.label, replayable: a.replayable, dice: !!a.dice?.length });
      perGame[rec.game] = (perGame[rec.game] ?? 0) + 1;
    }
  }
  if (flag("--state")) {
    for (const s of rec.saves.steps) {
      const added = s.delta.flatMap((d) => d.slice(2)).filter((l) => !/^(saved_|latest_command|last_|undo_)/.test(l) && matches(l));
      if (added.length) {
        const a = rec.actions.find((x) => x.index === s.index);
        hits.push({ game: rec.game, file: join("tests/engine/recordings", f), index: s.index, type: "state", kind: a?.kind, user: a?.user?.username, customId: a?.customId, label: a?.label, replayable: a?.replayable, lines: added.slice(0, 3).map((l) => l.slice(0, 160)) });
        perGame[rec.game] = (perGame[rec.game] ?? 0) + 1;
      }
    }
  }
}
if (flag("--json")) {
  console.log(JSON.stringify({ pattern: pat, ids: [...ids], perGame, hits }, null, 1));
  process.exit(hits.length ? 0 : 1);
}
if (ids.size) console.log(`name matches -> ids: ${[...ids].slice(0, 20).join(", ")}${ids.size > 20 ? ` (+${ids.size - 20})` : ""}`);
console.log(`${hits.length} hit(s) in ${Object.keys(perGame).length} recording(s): ${Object.entries(perGame).map(([g, n]) => `${g}×${n}`).join(" ")}`);
for (const h of hits.slice(0, limit)) {
  console.log(`${h.game.padEnd(7)} ${String(h.index).padStart(4)} ${h.type.padEnd(6)} ${String(h.kind ?? "").padEnd(13)} ${(h.user ?? "").padEnd(12)} ${h.customId ?? (h.label ?? "").slice(0, 90)}${h.replayable === false ? " [not replayable]" : ""}${h.dice ? " [dice]" : ""}`);
  if (h.lines) for (const l of h.lines) console.log(`               + ${l}`);
  console.log(`               node tests/engine/replay.mjs ${h.file} --via engine --from ${h.index - 1} --to ${h.index} --no-web`);
}
if (hits.length > limit) console.log(`… ${hits.length - limit} more (--limit, --json)`);
