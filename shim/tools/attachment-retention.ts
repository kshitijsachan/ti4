// One-off / manual attachment retention over a shim data dir, read-only on the store (the running shim may stay up:
// it never reads old files back). Same policy as the shim's periodic sweep (src/retention.ts): superseded map / Milty
// renders (all but the newest KEEP per channel), renders no message has any more, and every file of an ended game
// (archived actions channel) except its final map render. Dry run unless --apply; --apply logs each removal.
//   npx tsx tools/attachment-retention.ts /home/user/run/shim-data [--apply] [--keep 3] [--log /home/user/run/freed-files.log]
import { join, dirname } from "node:path";
import { readShimState } from "./read-state.mjs";
import { applyRemovals, planRetention, KEEP_RENDERS } from "../src/retention.js";

const args = process.argv.slice(2);
const data = args.find((a) => !a.startsWith("--")) ?? "/home/user/run/shim-data";
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const keep = Number(opt("--keep") ?? KEEP_RENDERS);
const logFile = opt("--log") ?? join(dirname(data), "freed-files.log");
const files = join(data, "files");
const state = readShimState(data);
const plan = await planRetention(state, files, { keep });
const mb = (b: number) => `${(b / 1e6).toFixed(0)} MB`;
const byGame = new Map<string, number>();
for (const r of plan.removals) byGame.set(r.game ?? "-", (byGame.get(r.game ?? "-") ?? 0) + r.bytes);
console.log(`plan: ${plan.removals.length} files, ${mb(plan.bytes)} (keep ${keep} renders per channel)`);
for (const [k, v] of Object.entries(plan.byReason)) console.log(`  ${k.padEnd(22)} ${String(v.files).padStart(6)} files ${mb(v.bytes).padStart(9)}`);
console.log("top games: " + [...byGame].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([g, b]) => `${g} ${mb(b)}`).join(", "));
if (args.includes("--apply")) {
  const freed = applyRemovals(files, plan.removals, logFile);
  console.log(`removed ${plan.removals.length} files, freed ${mb(freed)}; logged to ${logFile}`);
} else console.log("dry run (pass --apply to delete)");
