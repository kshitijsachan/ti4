// Ends every game a Fuzz seat plays in that is not ended yet (orphans: a solo-game request that timed out during a
// stack restart but still created its game, a fuzzer killed before its cleanup), except the games named.
// Games created in the last --min-age minutes (default 15) are left alone: another fuzzer may be setting them up.
// Usage: node sweep.mjs [--keep pbdA,pbdB] [--min-age 15] [--dry]
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { MAPS, SEATS_FILE, endGame, parseArgs } from "./lib.mjs";

const args = parseArgs();
const keep = new Set(String(args.keep ?? "").split(",").filter(Boolean));
const seats = existsSync(SEATS_FILE) ? JSON.parse(readFileSync(SEATS_FILE, "utf8")) : [];
const shimState = JSON.parse(readFileSync("/home/user/run/shim-data/state.json", "utf8"));
const actionChannels = new Set(Object.values(shimState.channels ?? {}).map((c) => c.name).filter((n) => /-actions$/.test(n)));
for (const f of readdirSync(MAPS)) {
  const game = f.replace(/\.txt$/, "");
  if (!/^pbd\d+$/.test(game) || keep.has(game)) continue;
  const save = readFileSync(`${MAPS}/${f}`, "utf8");
  if (Number(/^ended_date (\d+)/m.exec(save)?.[1] ?? 0) > 0) continue;
  const seat = seats.find((s) => save.includes(s.user_id));
  if (!seat) continue;
  const first = `${MAPS}/undo/${game}/${game}_1.txt`;
  const born = existsSync(first) ? statSync(first).mtimeMs : statSync(`${MAPS}/${f}`).birthtimeMs || 0;
  if (Date.now() - born < Number(args["min-age"] ?? 15) * 60000) continue;
  if (!actionChannels.has(`${game}-actions`)) {
    console.log(`${game}: ${seat.name} plays it but it has no actions channel (setup never finished); left alone`);
    continue;
  }
  if (args.dry) console.log(`${game}: would end (${seat.name})`);
  else endGame(game, seat.token);
}
