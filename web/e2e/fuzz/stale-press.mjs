// Repro helper: presses one control (by custom id pattern) still visible to a seat in a game, and prints what changed
// in web data (per player: techs, planets, tokens, faction, scs, VP) and in the save's last command.
// Usage: node stale-press.mjs <game> <seat name> <customIdRegex> [--dry]
import { ShimClient, controlsOf, loadSeat, readSave, seatSummary, sleep, webData } from "./lib.mjs";

const [game, seatName, pattern] = process.argv.slice(2);
const dry = process.argv.includes("--dry");
const seat = await loadSeat(seatName);
const c = new ShimClient(seat.token, { game });
await c.connect();
await sleep(3000);
const re = new RegExp(pattern);
const hits = [];
for (const m of c.gameMessages()) for (const x of controlsOf(m.components)) if (re.test(x.id)) hits.push({ m, x });
console.log(`${hits.length} matching controls:`, hits.slice(0, 10).map((h) => `${h.x.id} in #${h.m._ch?.name} (msg ${h.m.id})`).join("; "));
if (!hits.length || dry) process.exit(0);
const view = (w) => Object.fromEntries((w?.playerData ?? []).map((p) => [p.faction, { ...seatSummary(p), techList: (p.techs ?? []).join(",") }]));
const w0 = await webData(game);
const before = { phase: w0?.gameState?.phase, round: w0?.gameRound, players: view(w0) };
const h = hits[hits.length - 1];
const r = await c.send({ op: "click", channel_id: h.m.channel_id, message_id: h.m.id, custom_id: h.x.id });
console.log(`pressed ${h.x.id}: ${r.t} ${r.error ?? ""}`);
await sleep(6000);
const w1 = await webData(game);
const after = { phase: w1?.gameState?.phase, round: w1?.gameRound, players: view(w1) };
console.log(`phase ${before.phase} r${before.round} -> ${after.phase} r${after.round}; last save: ${/^latest_command (.*)$/m.exec(readSave(game) ?? "")?.[1]}`);
for (const f of new Set([...Object.keys(before.players), ...Object.keys(after.players)])) {
  const a = before.players[f] ?? {};
  const b = after.players[f] ?? {};
  const diff = Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (diff.length) console.log(`  ${f}: ${diff.map((k) => `${k} ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`).join("; ")}`);
}
c.close();
process.exit(0);
