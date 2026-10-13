#!/usr/bin/env node
// Click-latency report: where a human click's time goes, from the live logs (and an optional responsiveness probe).
//
//   node tests/engine/latency.mjs --since 06:10 [--until 07:00] [--game pbd539] [--probe 30] [--json]
//
// - human answers (shim.log "engine answer <user> <game> <kind> <what> -> <status> (Nms: shim a, bot b)"): p50/p90/max
//   of the whole answer, the shim's part (its checks, waiting on its own event loop) and the bot's part (game lock wait +
//   handler + the bot's REST round trips to the shim). Since click-latency every human answer carries the timing;
//   before, only answers >= 1 s did (then the percentiles are of slow answers only: see "timed").
// - shim event loop: "event loop blocked Nms" warnings (>= 1 s stalls: every HTTP request, bot REST call and SSE write
//   waits them out) and what was running.
// - bot game locks (bot.log): "Held lock" (>= 1.5 s write holds) and "Took N ms to get lock" (>= 1 s waits).
// - --probe S: GET /healthz on the shim every 250 ms for S seconds (event-loop responsiveness right now).
// Logs default to /home/user/run/{shim,bot}.log. Times are the logs' own (UTC); the window is taken from the latest day
// in shim.log (its lines carry no date).
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const flag = (k) => args.includes(k);
const SHIM_LOG = opt("--shim-log", "/home/user/run/shim.log");
const BOT_LOG = opt("--bot-log", "/home/user/run/bot.log");
const secs = (t) => {
  const [h, m, s = "0"] = t.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
};
const since = secs(opt("--since", "00:00"));
const until = secs(opt("--until", "24:00"));
const onlyGame = opt("--game", null);

const q = (xs, p) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return Math.round(a[Math.min(a.length - 1, Math.floor(p * a.length))]);
};
const dist = (xs) => (xs.length ? { n: xs.length, p50: q(xs, 0.5), p90: q(xs, 0.9), max: Math.round(Math.max(...xs)), sum: Math.round(xs.reduce((a, b) => a + b, 0)) } : { n: 0 });
const fmt = (d) => (d.n ? `n ${d.n}, p50 ${d.p50}ms, p90 ${d.p90}ms, max ${d.max}ms` : "n 0");

/** Lines of the latest day of a log whose leading HH:MM:SS.mmm is within the window. */
function windowLines(file, timeRe) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  let out = [];
  let prev = -1;
  for (const line of text.split("\n")) {
    const m = timeRe.exec(line);
    if (!m) continue;
    const t = secs(m[1]);
    if (prev >= 0 && t < prev - 3600) out = []; // next day
    prev = t;
    if (t >= since && t <= until) out.push({ t, line });
  }
  return out;
}

// ---- shim.log
const shim = windowLines(SHIM_LOG, /^(\d\d:\d\d:\d\d(?:\.\d+)?) /);
const human = [];
let humanUntimed = 0;
const blocked = [];
const blockedBy = new Map();
for (const { t, line } of shim) {
  const a = / INFO  engine answer (\d+) (\S+) (\S+) (.*?) -> (\S+?):?(?: .*)?$/.exec(line);
  if (a) {
    if (onlyGame && a[2] !== onlyGame) continue;
    const m = /\((\d+)ms: shim (\d+)ms, bot (\d+)ms\)$/.exec(line);
    if (!m) {
      humanUntimed++;
      continue;
    }
    human.push({ t, user: a[1], game: a[2], kind: a[3], what: a[4].slice(0, 50), status: a[5], total: +m[1], shim: +m[2], bot: +m[3] });
    continue;
  }
  const b = /WARN  event loop blocked (\d+)ms.*?sync: (.*?); open:/.exec(line);
  if (b) {
    blocked.push(+b[1]);
    for (const part of b[2].split("; ")) {
      const k = /^(autopilot \S+|solo|store \w+|rest \w+|engine \w+|nothing instrumented|[^:\d]+)/.exec(part)?.[1]?.replace(/autopilot \S+/, "autopilot decide") ?? part;
      blockedBy.set(k, (blockedBy.get(k) ?? 0) + 1);
    }
  }
}

// ---- bot.log
const bot = windowLines(BOT_LOG, /`\d{4}-\d\d-\d\d (\d\d:\d\d:\d\d(?:\.\d+)?) *`/);
const held = [];
const waits = [];
for (const { line } of bot) {
  const h = /Held lock "(\w+)" for (\d+) ms/.exec(line);
  if (h && (!onlyGame || h[1] === onlyGame)) held.push(+h[2]);
  const w = /Took (\d+) ms to get lock "(\w+)"/.exec(line);
  if (w && (!onlyGame || w[2] === onlyGame)) waits.push(+w[1]);
}

// ---- probe
async function probe(seconds) {
  const out = [];
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const t0 = performance.now();
    try {
      await fetch("http://127.0.0.1:8090/healthz", { signal: AbortSignal.timeout(10_000) }).then((r) => r.arrayBuffer());
      out.push(performance.now() - t0);
    } catch {
      out.push(10_000);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}
const probed = opt("--probe", null) ? await probe(Number(opt("--probe"))) : null;

const report = {
  window: `${opt("--since", "00:00")}..${opt("--until", "24:00")}${onlyGame ? ` ${onlyGame}` : ""}`,
  humanAnswers: { timed: human.length, untimedFast: humanUntimed, total: dist(human.map((x) => x.total)), shim: dist(human.map((x) => x.shim)), bot: dist(human.map((x) => x.bot)) },
  byGame: Object.fromEntries(
    [...new Set(human.map((x) => x.game))].map((g) => {
      const xs = human.filter((x) => x.game === g);
      return [g, { total: dist(xs.map((x) => x.total)), bot: dist(xs.map((x) => x.bot)) }];
    }),
  ),
  slowest: [...human].sort((a, b) => b.total - a.total).slice(0, 8),
  shimEventLoopBlocked: { ...dist(blocked), by: Object.fromEntries([...blockedBy].sort((a, b) => b[1] - a[1]).slice(0, 6)) },
  botLockHeldOver1500ms: dist(held),
  botLockWaitOver1000ms: dist(waits),
  healthzProbe: probed ? dist(probed) : undefined,
};

if (flag("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else {
  const h = report.humanAnswers;
  console.log(`window ${report.window}`);
  console.log(`human answers: ${h.timed} timed${h.untimedFast ? ` (+${h.untimedFast} under 1 s, untimed: logs before click-latency)` : ""}`);
  console.log(`  total ${fmt(h.total)}`);
  console.log(`  shim  ${fmt(h.shim)}`);
  console.log(`  bot   ${fmt(h.bot)}`);
  for (const [g, d] of Object.entries(report.byGame)) console.log(`  ${g}: total ${fmt(d.total)}; bot p50 ${d.bot.p50}ms`);
  for (const x of report.slowest) console.log(`  slow: ${x.total}ms (shim ${x.shim}, bot ${x.bot}) ${x.game} ${x.kind} ${x.what}`);
  const b = report.shimEventLoopBlocked;
  console.log(`shim event loop blocked >= 1 s: ${fmt(b)}${b.n ? `, total ${b.sum}ms` : ""}; during: ${Object.entries(b.by ?? {}).map(([k, n]) => `${k} ${n}x`).join(", ")}`);
  console.log(`bot lock held >= 1.5 s: ${fmt(report.botLockHeldOver1500ms)}`);
  console.log(`bot lock wait >= 1 s:   ${fmt(report.botLockWaitOver1000ms)}`);
  if (report.healthzProbe) console.log(`shim /healthz probe:    ${fmt(report.healthzProbe)}`);
}
