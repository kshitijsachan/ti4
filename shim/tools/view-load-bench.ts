// Synthetic visibility load on a real store's channels/permissions (click-latency benchmark).
//   cd shim && npx tsx tools/view-load-bench.ts [<shim data dir>=/home/user/run/shim-data] [seconds=20] [<shim src dir>=../src]
// 180-odd seats each walk their visible channels about once a second (autopilot liveGames/decide) while the bot writes
// to one thread every 400 ms (archive flag / member / new thread). Reports event-loop lag (20 ms timer) and CPU. Reads
// only store/global.json and store/shards/*.json (channels, members, roles; no messages); writes nothing.
// Pass another checkout's src dir to compare (a store without invalidateChannels drops every view per write, as before).
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const [dataDir = "/home/user/run/shim-data", secsArg = "20", srcDir = join(import.meta.dirname, "../src")] = process.argv.slice(2);
const { Store } = await import(resolve(srcDir, "store.ts"));
const state = JSON.parse(readFileSync(join(dataDir, "store/global.json"), "utf8"));
state.channels = {};
state.thread_members = {};
state.messages = {};
for (const f of readdirSync(join(dataDir, "store/shards"))) {
  if (!f.endsWith(".json")) continue;
  const shard = JSON.parse(readFileSync(join(dataDir, "store/shards", f), "utf8"));
  Object.assign(state.channels, shard.channels ?? {});
  Object.assign(state.thread_members, shard.thread_members ?? {});
}
const s = Object.create(Store.prototype);
Object.assign(s, { state, views: new Map(), viewGen: 0, viewLog: [], viewSeq: 0, chanGen: 0 });
const seats = Object.values(state.seats as Record<string, { user_id?: string }>).map((x) => x.user_id).filter(Boolean) as string[];
const threads = Object.keys(state.channels).filter((id) => state.channels[id].type === 11);
const secs = Number(secsArg);
for (const u of seats) s.visibleChannels(u);
const lags: number[] = [];
let last = performance.now();
const tick = setInterval(() => {
  const now = performance.now();
  lags.push(now - last - 20);
  last = now;
}, 20);
let writes = 0;
const writer = setInterval(() => {
  const id = threads[writes++ % threads.length];
  if (typeof s.invalidateChannels === "function") s.invalidateChannels([id]);
  else s.invalidateViews();
}, 400);
const timers: NodeJS.Timeout[] = [];
let walks = 0;
for (const u of seats) {
  const walk = () => {
    s.visibleChannels(u);
    walks++;
    timers.push(setTimeout(walk, 700 + Math.random() * 700));
  };
  timers.push(setTimeout(walk, Math.random() * 1000));
}
const cpu0 = process.cpuUsage();
await new Promise((r) => setTimeout(r, secs * 1000));
clearInterval(tick);
clearInterval(writer);
timers.forEach(clearTimeout);
const cpu = process.cpuUsage(cpu0);
lags.sort((a, b) => a - b);
const q = (p: number) => Math.round(lags[Math.floor(p * (lags.length - 1))]);
console.log(
  `${srcDir}: ${seats.length} seats, ${Object.keys(state.channels).length} channels; ${writes} channel writes, ${walks} seat walks in ${secs}s; ` +
    `CPU ${Math.round((cpu.user + cpu.system) / 1e4 / secs)}%; event-loop lag p50 ${q(0.5)}ms p90 ${q(0.9)}ms p99 ${q(0.99)}ms max ${Math.round(lags[lags.length - 1])}ms`,
);
process.exit(0);
