// Autopilot decide() benchmark on a real store (decide-slicing): every autopilot seat of the live store, with the bot
// replaced by fixtures (web-data, draft, engine decisions + state per game, fetched once from the bot read-only).
//
//   cd shim && npx tsx tools/decide-bench.ts <mode> [--data /home/user/run/shim-data] [--fixtures <dir>] [--secs 60]
//     [--src ../src] [--old <src dir of the baseline>] [--fetch]
//
// Modes:
//   full  the autopilots run as in the shim (think loop, presses answered by a stub client) for --secs; reports the
//         event-loop lag (20 ms timer: p50/p90/p99/max, ticks >= 100 ms / >= 1 s), shim CPU, and decide() per call:
//         count, synchronous (slice) ms p50/p90/max and total, from the Slicer records.
//   diff  equivalence: --old and --src autopilots side by side on the same store, think() disabled; every seat's
//         decide() is called on both, several passes, with store edits between passes (new prompts, edits, deletes);
//         prints every pass where the two choose differently (message, control, score, why). Exit 1 on a difference.
//   once  one decide() pass over every seat (CPU-profile it with node --cpu-prof).
// --fetch (re)fetches the fixtures from the bot at BOT_API_URL (default http://127.0.0.1:8081), one GET at a time.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { readShimState } from "./read-state.mjs";

const args = process.argv.slice(2);
const mode = args[0] ?? "full";
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const dataDir = opt("--data", "/home/user/run/shim-data");
const fixDir = opt("--fixtures", join(process.cwd(), "decide-fixtures"));
const secs = Number(opt("--secs", "60"));
const srcDir = resolve(opt("--src", join(import.meta.dirname, "../src")));
const oldDir = args.includes("--old") ? resolve(opt("--old", "")) : null;
/** A module of a shim src dir (.ts) or of a compiled one (.js, for line-level CPU profiles). */
const mod = (dir: string, name: string) => resolve(dir, existsSync(resolve(dir, `${name}.js`)) ? `${name}.js` : `${name}.ts`);
const BOT = process.env.BOT_API_URL ?? "http://127.0.0.1:8081";

process.env.AUTOPILOT_MIN_DELAY_MS ??= "700";
const t0 = Date.now();
const state = readShimState(dataDir);
console.error(`state read in ${Date.now() - t0}ms`);

const { log } = await import(mod(srcDir, "log"));
const quiet = !args.includes("--verbose");
const warns: string[] = [];
for (const l of [log, ...(oldDir ? [(await import(mod(oldDir, "log"))).log] : [])]) {
  if (!quiet) break;
  l.info = () => {};
  l.warn = (m: string) => void warns.push(m);
  l.error = (m: string) => void warns.push(`ERROR ${m}`);
}

function gameOf(ch: any, channels: Record<string, any>): string | null {
  let c = ch;
  if ([10, 11, 12].includes(c.type)) {
    c = c.parent_id ? channels[c.parent_id] : undefined;
    if (!c) return null;
  }
  if (!c.parent_id) return null;
  return /^([a-z]+\d+)-/i.exec(String(c.name ?? ""))?.[1] ?? null;
}

const autoSeats = Object.values(state.seats as Record<string, any>).filter((s) => s.autopilot).map((s) => s.user_id as string);
const games = new Set<string>();
for (const ch of Object.values(state.channels as Record<string, any>)) {
  const g = gameOf(ch, state.channels);
  if (g) games.add(g);
}
console.error(`${autoSeats.length} autopilot seats, ${games.size} games, ${Object.keys(state.channels).length} channels`);

// ---- fixtures ----
mkdirSync(fixDir, { recursive: true });
const fixFile = (g: string) => join(fixDir, `${g}.json`);
if (args.includes("--fetch")) {
  const auth = { authorization: `Bot ${state.bot_token}`, accept: "application/json" };
  const get = async (url: string, headers: Record<string, string> = {}) => {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  let n = 0;
  for (const g of games) {
    const webData = await get(`${BOT}/api/public/game/${g}/web-data`);
    const draft = await get(`${BOT}/api/public/game/${g}/draft`);
    const decisions = await get(`${BOT}/api/public/selfhost/engine/${g}/decisions`, auth);
    const engineState = await get(`${BOT}/api/public/selfhost/engine/${g}/state`, auth);
    writeFileSync(fixFile(g), JSON.stringify({ webData, draft, decisions, engineState }));
    if (++n % 50 === 0) console.error(`fetched ${n}/${games.size}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}
const fixtures = new Map<string, any>();
for (const g of games) if (existsSync(fixFile(g))) fixtures.set(g, JSON.parse(readFileSync(fixFile(g), "utf8")));
console.error(`${fixtures.size} game fixtures`);

// ---- stub bot (web-data, draft) ----
const unknown = new Map<string, number>();
const server = createServer((req, res) => {
  const m = /^\/api\/public\/game\/([^/]+)\/(web-data|draft)/.exec(req.url ?? "");
  const f = m ? fixtures.get(decodeURIComponent(m[1])) : undefined;
  const body = f ? (m![2] === "draft" ? f.draft : f.webData) : undefined;
  if (body == null) {
    const k = (req.url ?? "").replace(/\/pbd\d+/g, "/<game>").replace(/\?.*/, "");
    unknown.set(k, (unknown.get(k) ?? 0) + 1);
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const botApi = `http://127.0.0.1:${(server.address() as any).port}`;

/** In-process engine client over the fixtures (decisions as of the fetch; no answers accepted). */
function fakeEngine() {
  const decisions = new Map<string, Map<string, any>>();
  for (const [g, f] of fixtures) decisions.set(g, new Map((f.decisions?.decisions ?? []).map((d: any) => [d.id, d])));
  return {
    decisions,
    isLive: true,
    available: true,
    currentSeq: 1,
    async state(game: string) {
      return fixtures.get(game)?.engineState ?? null;
    },
    async factionOf(game: string, userId: string) {
      return fixtures.get(game)?.engineState?.players?.find((p: any) => p.userId === userId)?.faction ?? null;
    },
    async openDecisions(game: string) {
      return fixtures.get(game)?.decisions?.decisions ?? null;
    },
    async decisionsSnapshot(game: string) {
      const d = fixtures.get(game)?.decisions;
      return d ? { seq: d.seq ?? 1, decisions: d.decisions ?? [] } : null;
    },
    async decisionsFor(game: string, userId: string) {
      return (fixtures.get(game)?.decisions?.decisions ?? []).filter((d: any) => (d.awaiting ?? []).includes?.(userId));
    },
    since() {
      return [];
    },
    async answer() {
      return null;
    },
    async act() {
      return null;
    },
    async resnapshot() {
      return null;
    },
    async proposeTrade() {
      return null;
    },
    onEvent() {
      return () => {};
    },
    onReset() {
      return () => {};
    },
  };
}

/** A shim Store over the read state (no disk). Each autopilot build gets its own Store object over the same state. */
async function makeStore(dir: string) {
  const { Store } = await import(mod(dir, "store"));
  const s = Object.create(Store.prototype);
  Object.assign(s, { state, views: new Map(), viewGen: 0, viewLog: [], viewSeq: 0, chanGen: 0, globalGen: 0, changeSeq: 0, changeLog: [], interactions: new Map(), interactionsByToken: new Map() });
  // No disk; the change log (Store.noteChange) as scheduleSave keeps it.
  s.scheduleSave = (channelId?: string | null) => (typeof s.noteChange === "function" ? s.noteChange(channelId) : undefined);
  s.saveNow = () => {};
  return s;
}

async function makeAutopilot(dir: string, botReady: boolean) {
  const { Autopilot } = await import(mod(dir, "autopilot"));
  const store = await makeStore(dir);
  const hub = { store, gateway: { botReady } };
  const clients = {
    attachVirtual(_userId: string, onFrame: (f: any) => void) {
      return {
        send(op: any) {
          // A press: the bot "answers" it after 150 ms (no change to the store).
          if (op.nonce && (op.op === "click" || op.op === "select")) setTimeout(() => onFrame({ t: "interaction_done", nonce: op.nonce }), 150);
        },
        close() {},
      };
    },
  };
  // Autopilot's constructor starts the pilots; the engine must be in place for their first think().
  const proto = Autopilot.prototype;
  const sync = proto.sync;
  proto.sync = function () {};
  const ap = new Autopilot(hub, clients, botApi);
  proto.sync = sync;
  if (!args.includes("--no-engine")) ap.engine = fakeEngine();
  ap.sync();
  return { ap, store, pilots: [...(ap as any).pilots.values()] as any[] };
}

/** Slicer accounting: every decide() call's synchronous ms (the sum of its slices) and its longest slice. */
async function instrument(dir: string) {
  const lag = await import(mod(dir, "lag"));
  const calls: { busy: number; maxSlice: number }[] = [];
  const P = lag.Slicer.prototype as any;
  const tick = P.tick;
  const done = P.done;
  P.tick = async function (this: any) {
    const before = this.busyMs;
    await tick.call(this);
    if (this.busyMs !== before) this._max = Math.max(this._max ?? 0, this.busyMs - before);
  };
  P.done = function (this: any) {
    const before = this.busyMs;
    const r = done.call(this);
    this._max = Math.max(this._max ?? 0, r - before);
    if (/: decide$/.test(this.label)) calls.push({ busy: r, maxSlice: this._max });
    return r;
  };
  return calls;
}

const q = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return Math.round(a[Math.min(a.length - 1, Math.floor(p * a.length))]);
};

if (mode === "full") {
  const calls = await instrument(srcDir);
  const { ap, store, pilots } = await makeAutopilot(srcDir, true);
  // Live-like traffic (--traffic): the bot posts / edits a prompt in one of the most recently active games every
  // 400 ms (frames to every pilot, as the hub fans them out), and rolls one of them back every --rewind-ms (fuzzers
  // and replays rewind forks all the time live: 4 roll-backs of pbd506 in 6 s at 08:40).
  const trafficTimers: NodeJS.Timeout[] = [];
  if (args.includes("--traffic")) {
    const chans = Object.values(state.channels as Record<string, any>).filter((c: any) => gameOf(c, state.channels) && [0, 11, 12].includes(c.type));
    const lastAt = (c: any) => {
      const m = (state.messages[c.id] ?? []).at(-1);
      return m ? Date.parse(m.timestamp) : 0;
    };
    const active = chans.sort((a, b) => lastAt(b) - lastAt(a)).slice(0, 40);
    const activeGames = [...new Set(active.map((c) => gameOf(c, state.channels)!))].slice(0, 12);
    console.error(`traffic over ${active.length} channels of ${activeGames.join(", ")}`);
    let seq = BigInt(Date.now() - 1420070400000) << 22n;
    let i = 0;
    trafficTimers.push(
      setInterval(() => {
        const ch = active[i++ % active.length];
        const list = state.messages[ch.id] ?? (state.messages[ch.id] = []);
        const src = [...list].reverse().find((m: any) => (m.components ?? []).length && state.users[m.author?.id]?.bot);
        if (!src) return;
        let frame: any;
        if (i % 3) {
          const copy = structuredClone(src);
          copy.id = String(++seq);
          copy.timestamp = new Date().toISOString();
          copy.edited_timestamp = null;
          delete copy._presses;
          list.push(copy);
          if (list.length > 400) list.splice(0, list.length - 400);
          frame = { t: "message_create", message: copy };
        } else {
          src.edited_timestamp = new Date().toISOString();
          frame = { t: "message_update", message: src };
        }
        store.scheduleSave(ch.id, frame.message.id);
        for (const p of pilots) (p as any).onFrame(frame);
      }, 400),
    );
    const rewindMs = Number(opt("--rewind-ms", "6000"));
    let r = 0;
    if (rewindMs > 0) trafficTimers.push(setInterval(() => ap.rewound(activeGames[r++ % activeGames.length], "event"), rewindMs));
  }
  const lags: number[] = [];
  const stalls: string[] = [];
  const gcs: { at: number; ms: number; kind: number }[] = [];
  const { PerformanceObserver } = await import("node:perf_hooks");
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) gcs.push({ at: e.startTime, ms: e.duration, kind: (e as any).detail?.kind ?? 0 });
  });
  obs.observe({ entryTypes: ["gc"] });
  const start = performance.now();
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const l = now - last - 20;
    lags.push(l);
    if (l >= 200) {
      const gc = gcs.filter((g) => g.at + g.ms >= last && g.at <= now).reduce((a, g) => a + g.ms, 0);
      stalls.push(`${((now - start) / 1000).toFixed(1)}s ${Math.round(l)}ms (gc ${Math.round(gc)}ms)`);
    }
    last = now;
  }, 20);
  const cpu0 = process.cpuUsage();
  const w0 = performance.now();
  await new Promise((r) => setTimeout(r, secs * 1000));
  clearInterval(timer);
  trafficTimers.forEach(clearInterval);
  const cpu = process.cpuUsage(cpu0);
  const wall = performance.now() - w0;
  for (const p of pilots) p.stop();
  const busy = calls.map((c) => c.busy);
  const slices = calls.map((c) => c.maxSlice);
  console.log(
    JSON.stringify({
      src: srcDir,
      seats: pilots.length,
      secs,
      cpuPct: Math.round((100 * (cpu.user + cpu.system)) / 1000 / wall),
      lag: { p50: q(lags, 0.5), p90: q(lags, 0.9), p99: q(lags, 0.99), max: Math.round(Math.max(...lags)), over100: lags.filter((l) => l >= 100).length, over1s: lags.filter((l) => l >= 1000).length },
      decide: { calls: calls.length, busyP50: q(busy, 0.5), busyP90: q(busy, 0.9), busyMax: Math.round(Math.max(0, ...busy)), busyTotal: Math.round(busy.reduce((a, b) => a + b, 0)), maxSliceP90: q(slices, 0.9), maxSlice: Math.round(Math.max(0, ...slices)) },
      gc: { n: gcs.length, totalMs: Math.round(gcs.reduce((a, g) => a + g.ms, 0)), maxMs: Math.round(Math.max(0, ...gcs.map((g) => g.ms))) },
      stalls: stalls.slice(0, 20),
      decideWarns: warns.filter((w) => w.includes("decide took")).length,
      errors: warns.filter((w) => w.startsWith("ERROR")).slice(0, 5),
      stubMisses: Object.fromEntries([...unknown].sort((a, b) => b[1] - a[1]).slice(0, 8)),
    }),
  );
  server.close();
  process.exit(0);
}

if (mode === "once") {
  const calls = await instrument(srcDir);
  const { pilots } = await makeAutopilot(srcDir, false);
  for (let pass = 0; pass < 3; pass++) {
    const c0 = process.cpuUsage();
    for (const p of pilots) await p.decide();
    const c = process.cpuUsage(c0);
    console.log(`pass ${pass}: ${pilots.length} seats, cpu ${Math.round((c.user + c.system) / 1000)}ms; decide busy total ${Math.round(calls.splice(0).reduce((a, b) => a + b.busy, 0))}ms`);
  }
  server.close();
  process.exit(0);
}

if (mode === "diff") {
  if (!oldDir) throw new Error("diff needs --old <baseline src dir>");
  const A = await makeAutopilot(oldDir, false);
  const B = await makeAutopilot(srcDir, false);
  const fmt = (c: any) => (c ? `${c.msg.id}:${c.control.custom_id}:${c.score}:${c.why}` : "none");
  let diffs = 0;
  let compared = 0;
  let chosen = 0;
  const passes = Number(opt("--passes", "6"));
  const chans = Object.values(state.channels as Record<string, any>).filter((c: any) => gameOf(c, state.channels) && [0, 11, 12].includes(c.type));
  let seq = BigInt(Date.now() - 1420070400000) << 22n;
  const edit = (pass: number) => {
    // Store edits between passes: a re-post of a recent prompt (new id), an edit of a prompt, a deleted prompt,
    // in a few game channels, as the bot would (Store.insertMessage / scheduleSave paths bump the same generations).
    const touched: string[] = [];
    for (let i = 0; i < 25; i++) {
      const ch = chans[(pass * 97 + i * 31) % chans.length] as any;
      const list = state.messages[ch.id] ?? [];
      const withButtons = list.filter((m: any) => (m.components ?? []).length);
      if (!withButtons.length) continue;
      const m = withButtons[(pass + i) % withButtons.length];
      const kind = (pass + i) % 3;
      if (kind === 0) {
        const copy = structuredClone(m);
        copy.id = String(++seq);
        copy.timestamp = new Date().toISOString();
        copy.edited_timestamp = null;
        delete copy._presses;
        list.push(copy);
        state.messages[ch.id] = list;
      } else if (kind === 1) {
        m.edited_timestamp = new Date().toISOString();
        m.content = String(m.content ?? "") + " ";
      } else {
        list.splice(list.indexOf(m), 1);
      }
      touched.push(ch.id);
    }
    for (const s of [A.store, B.store]) for (const id of touched) s.scheduleSave(id, "edit");
  };
  for (let pass = 0; pass < passes; pass++) {
    if (pass > 0) edit(pass);
    for (let i = 0; i < A.pilots.length; i++) {
      const a = await A.pilots[i].decide();
      const b = await B.pilots[i].decide();
      compared++;
      if (a) chosen++;
      if (fmt(a) !== fmt(b)) {
        diffs++;
        console.log(`pass ${pass} seat ${A.pilots[i].name}: old ${fmt(a)} | new ${fmt(b)}`);
      }
    }
    console.error(`pass ${pass}: ${compared} compared, ${chosen} with a choice, ${diffs} differences`);
  }
  for (const p of [...A.pilots, ...B.pilots]) p.stop();
  server.close();
  console.log(`${diffs} differences over ${compared} decide() calls (${chosen} chose something)`);
  process.exit(diffs ? 1 : 0);
}
