#!/usr/bin/env node
// Engine coverage + consistency report against a running bot (docs/ENGINE.md §4).
//
//   node tools/engine-metrics.mjs [--games pbd1,pbd2] [--json] [--no-shim] [--since 2026-10-11T16:50:00Z]
//
// For each live game: GameState vs the bot's independent web-data (user <-> faction <-> colour, active player,
// speaker), open decisions (typed %, target resolution, untyped handler prefixes, malformed typed values), and —
// unless --no-shim — registry vs screen: decisions whose message is gone from the shim store ("stale") and bot
// messages with live components that have no decision ("missed"). Server-side counters/latency come from
// GET /api/public/selfhost/engine/metrics when the bot has it.
// Env: BOT_URL (default http://127.0.0.1:8081), BOT_TOKEN (default: DISCORD_BOT_TOKEN in /home/user/run/bot.env),
// SHIM_STATE (default /home/user/run/shim-data/state.json).
import fs from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const BOT = process.env.BOT_URL ?? "http://127.0.0.1:8081";
const TOKEN = process.env.BOT_TOKEN ?? readToken();
const SHIM_STATE = process.env.SHIM_STATE ?? "/home/user/run/shim-data/state.json";
const H = { Authorization: `Bot ${TOKEN}` };

function readToken() {
  try {
    const m = /^DISCORD_BOT_TOKEN=(.*)$/m.exec(fs.readFileSync("/home/user/run/bot.env", "utf8"));
    return m ? m[1].trim().replace(/^Bot /, "") : "";
  } catch { return ""; }
}
async function get(path, headers = H) {
  const r = await fetch(BOT + path, { headers });
  if (!r.ok) return { status: r.status };
  return { status: r.status, body: await r.json() };
}
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const head = (h) => (h ? (h.includes("_") ? h.slice(0, h.indexOf("_") + 1) : h) : "(none)");
const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const top = (m, n = 15) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);

const shim = flag("--no-shim") ? null : loadShim();
function loadShim() {
  try { return JSON.parse(fs.readFileSync(SHIM_STATE, "utf8")); } catch { return null; }
}

// Games: --games, else every "<game>-actions" channel in the shim store whose game the bot knows.
let games = opt("--games")?.split(",").filter(Boolean);
if (!games) {
  const names = new Set();
  for (const c of Object.values(shim?.channels ?? {})) {
    const m = /^([a-z]+\d+)-actions$/.exec(c.name ?? "");
    if (m) names.add(m[1]);
  }
  games = [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

const server = await get("/api/public/selfhost/engine/metrics");
const report = { games: [], totals: {}, server: server.body ?? `unavailable (${server.status})` };
const all = { open: 0, typed: 0, weak: 0, byKind: new Map(), byTarget: new Map(), untyped: new Map(), stale: 0, missed: 0, badValues: 0, stateMismatches: 0 };

for (const g of games) {
  const st = await get(`/api/public/selfhost/engine/${g}/state`);
  if (st.status !== 200) continue;
  const web = await get(`/api/public/game/${g}/web-data`, {});
  const state = st.body;
  const problems = [];
  // ---- state vs web-data (independent serialiser of the same Game)
  if (web.body?.playerData) {
    for (const wp of web.body.playerData) {
      if (!wp.discordId || !wp.faction || wp.faction === "null") continue;
      const sp = state.players.find((p) => p.userId === wp.discordId);
      if (!sp) problems.push(`player ${wp.userName ?? wp.discordId} missing from state`);
      else if (sp.faction !== wp.faction || sp.color !== wp.color)
        problems.push(`${wp.discordId}: state ${sp.faction}/${sp.color} vs web ${wp.faction}/${wp.color}`);
    }
    const webActive = web.body.playerData.find((p) => p.active)?.discordId ?? null;
    if ((state.activePlayer ?? null) !== webActive && webActive)
      problems.push(`activePlayer state=${state.activePlayer} web=${webActive}`);
  }
  for (const p of state.players) if (p.real && (!p.faction || p.faction === "null")) problems.push(`seated ${p.userName} has no faction`);
  const ended = web.body?.gameState?.ended || false;

  // ---- decisions
  const dr = await get(`/api/public/selfhost/engine/${g}/decisions`);
  const decisions = dr.body?.decisions ?? [];
  const seated = new Set(state.players.map((p) => p.userId));
  let typed = 0, weak = 0, badValues = 0;
  for (const d of decisions) {
    inc(all.byKind, d.kind);
    const how = d.target?.resolvedBy ?? "none";
    inc(all.byTarget, how);
    if (d.kind !== "legacy") {
      typed++;
      // a typed decision should type at least one option, and every typed value must be an object
      if (!d.options.some((o) => o.value && typeof o.value === "object")) { badValues++; problems.push(`${d.id} ${d.kind}: no typed option`); }
    } else {
      for (const h of new Set(d.options.map((o) => head(o.handler)))) inc(all.untyped, h);
    }
    if (how === "none" || how === "mention") weak++;
    if (d.target?.userId && !seated.has(d.target.userId)) problems.push(`${d.id}: target ${d.target.userId} not seated`);
    if (d.target?.userId) {
      const p = state.players.find((x) => x.userId === d.target.userId);
      if (p && d.target.faction && p.faction !== d.target.faction) problems.push(`${d.id}: target faction ${d.target.faction} != state ${p.faction}`);
    }
  }
  // ---- registry vs screen (shim store is saved with a delay: ignore the last 90 s)
  let stale = 0, missed = 0;
  if (shim) {
    const cutoff = Date.now() - 90_000;
    // Before the bot started, only a rebuild can know a message: count "missed" from bot start (when known).
    const since = opt("--since") ? Date.parse(opt("--since")) : typeof server.body?.uptimeSec === "number" ? Date.now() - server.body.uptimeSec * 1000 : 0;
    const t = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);
    const byMsg = new Map(decisions.map((d) => [d.source.messageId, d]));
    // actions, table talk, bot-map, SC/combat threads ("<game>-…") and cards-info threads ("Cards Info-<game>-<user>")
    const re = new RegExp(`(^|-)${g}(-|$)`);
    const gameChannels = new Set(Object.values(shim.channels).filter((c) => re.test(c.name ?? "")).map((c) => c.id));
    for (const d of decisions) {
      const msgs = shim.messages[d.source.channelId];
      const m = msgs && (Array.isArray(msgs) ? msgs.find((x) => x.id === d.source.messageId) : msgs[d.source.messageId]);
      if (t(d.source.messageId) > cutoff) continue;
      const comps = m ? countComponents(m.components) : 0;
      if (!m && !d.source.ephemeral && msgs) { stale++; problems.push(`stale ${d.id} (${d.kind}, ${head(d.options[0]?.handler)}) message gone`); }
      else if (m && comps === 0) { stale++; problems.push(`stale ${d.id} (${d.kind}) message has no components`); }
    }
    for (const ch of gameChannels) {
      const msgs = shim.messages[ch];
      const list = Array.isArray(msgs) ? msgs : Object.values(msgs ?? {});
      for (const m of list) {
        if (m.author?.id !== shim.bot_id || t(m.id) > cutoff || t(m.id) < since || m._ephemeral_for) continue;
        if (countComponents(m.components) === 0 || byMsg.has(m.id)) continue;
        if (!hasCustomId(m.components)) continue;
        missed++;
        if (missed <= 5) problems.push(`missed message ${m.id} in ${shim.channels[ch]?.name}: ${firstCustomId(m.components)}`);
      }
    }
  }
  all.open += decisions.length; all.typed += typed; all.weak += weak; all.stale += stale; all.missed += missed; all.badValues += badValues;
  if (problems.some((p) => /state|web|faction|activePlayer|missing/.test(p))) all.stateMismatches++;
  report.games.push({ game: g, phase: state.phase, round: state.round, ended, players: state.players.length, activePlayer: state.activePlayer, open: decisions.length, typedPct: pct(typed, decisions.length), weakPct: pct(weak, decisions.length), stale, missed, problems });
}

function countComponents(cs) {
  let n = 0;
  for (const c of cs ?? []) { if (c.custom_id) n++; n += countComponents(c.components); if (c.accessory) n += countComponents([c.accessory]); }
  return n;
}
function hasCustomId(cs) { return countComponents(cs) > 0; }
function firstCustomId(cs) {
  for (const c of cs ?? []) { if (c.custom_id) return c.custom_id; const f = firstCustomId(c.components); if (f) return f; }
  return "";
}

report.totals = {
  games: report.games.length,
  open: all.open,
  typedPct: pct(all.typed, all.open),
  weakTargetPct: pct(all.weak, all.open),
  byKind: Object.fromEntries(top(all.byKind, 50)),
  byTarget: Object.fromEntries(top(all.byTarget, 50)),
  topUntypedPrefixes: Object.fromEntries(top(all.untyped, 20)),
  stale: all.stale, missed: all.missed, badTypedValues: all.badValues, gamesWithStateMismatch: all.stateMismatches,
};

if (flag("--json")) console.log(JSON.stringify(report, null, 2));
else {
  const T = report.totals;
  console.log(`games ${T.games}  open decisions ${T.open}  typed ${T.typedPct}%  weak target (none/mention) ${T.weakTargetPct}%  stale ${T.stale}  missed ${T.missed}  bad typed ${T.badTypedValues}  state mismatches ${T.gamesWithStateMismatch}`);
  console.log("by kind:   ", JSON.stringify(T.byKind));
  console.log("by target: ", JSON.stringify(T.byTarget));
  console.log("top untyped prefixes:", Object.entries(T.topUntypedPrefixes).map(([k, v]) => `${k}${v}`).join("  "));
  for (const r of report.games) {
    console.log(`\n${r.game} ${r.phase} r${r.round} players=${r.players} active=${r.activePlayer ?? "-"} open=${r.open} typed=${r.typedPct}% weak=${r.weakPct}% stale=${r.stale} missed=${r.missed}`);
    for (const p of r.problems.slice(0, 8)) console.log("   ! " + p);
  }
  if (typeof report.server === "object") {
    const s = report.server;
    console.log(`\nserver: uptime ${s.uptimeSec}s seq ${s.seq} counters ${JSON.stringify(s.counters)}`);
    console.log(`capture ms ${JSON.stringify(s.captureMs)}  answers ms ${JSON.stringify(s.answersMs)}`);
  } else console.log(`\nserver metrics: ${report.server}`);
}
