// Shared pieces of the fuzzers (ws-fuzz.mjs, ui-fuzz.mjs): args, seeded PRNG, fuzz seats, the shim's ws protocol
// (messages + the engine stream), state invariants (tests/engine/lib/invariants.ts), bot-error tail, violation log.
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkSnapshot, checkSequence } from "../../../tests/engine/lib/invariants.ts";

const require = createRequire(import.meta.url);
export const WebSocket = require("/home/user/ti4/shim/node_modules/ws/index.js");

export const SHIM = process.env.SHIM ?? "http://127.0.0.1:8090";
export const BOT = process.env.BOT_URL ?? "http://127.0.0.1:8081";
export const FUZZ_DIR = process.env.FUZZ_DIR ?? "/home/user/run/fuzz";
export const SEATS_FILE = `${FUZZ_DIR}/seats.json`;
export const SHIM_LOG = process.env.SHIM_LOG ?? "/home/user/run/shim.log";
export const MAPS = `${process.env.BOT_STORAGE ?? "/home/user/run/bot-storage"}/maps`;
export const FUZZ_SRC = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
mkdirSync(FUZZ_DIR, { recursive: true });

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    out[argv[i].slice(2)] = next === undefined || next.startsWith("--") ? "1" : (i++, next);
  }
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => new Date().toISOString().slice(11, 19);

/** mulberry32: small, fast, and fully determined by the seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    pick: (list) => (list.length ? list[Math.floor(next() * list.length)] : undefined),
    /** [[weight, value], ...] → value */
    weighted: (pairs) => {
      const live = pairs.filter(([w]) => w > 0);
      const total = live.reduce((s, [w]) => s + w, 0);
      let r = next() * total;
      for (const [w, v] of live) if ((r -= w) < 0) return v;
      return live[live.length - 1]?.[1];
    },
    shuffle: (list) => {
      const a2 = [...list];
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
  };
}
export const freshSeed = () => (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 || 1;

export async function getJson(url, init, tries = 1) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), ...init });
      if (r.ok) return await r.json();
    } catch {
      /* retry */
    }
    if (i + 1 < tries) await sleep(2000);
  }
  return null;
}

/**
 * The shim's lobby admin key (admin_token in store/global.json, or state.json before the sharded store; the
 * "admin link: …?key=" line of shim.log as a fallback).
 */
export function adminKey() {
  try {
    const dir = "/home/user/run/shim-data";
    // global.json is small (~1 MB): read it whole; state.json is not, so only its start is searched.
    if (existsSync(`${dir}/store/global.json`)) return JSON.parse(readFileSync(`${dir}/store/global.json`, "utf8")).admin_token;
    const m = /"admin_token"\s*:\s*"([^"]+)"/.exec(readFileSync(`${dir}/state.json`, "utf8").slice(0, 4096));
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  const all = [...readFileSync(SHIM_LOG, "utf8").matchAll(/admin link: \S+\?key=(\w+)/g)];
  return all.at(-1)?.[1];
}

/** A fuzz seat ("Fuzz 1", "Fuzz 2"), created through the lobby admin API (POST /app/admin/players) when missing. */
export async function loadSeat(name) {
  let seats = existsSync(SEATS_FILE) ? JSON.parse(readFileSync(SEATS_FILE, "utf8")) : [];
  if (!seats.some((s) => s.name === name)) {
    const key = adminKey();
    const res = await fetch(`${SHIM}/app/admin/players?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ names: [name], key }),
    });
    const made = await res.json();
    seats = [...seats, ...made.map((s) => ({ name: s.name, user_id: s.user_id, token: s.token }))];
    writeFileSync(SEATS_FILE, JSON.stringify(seats, null, 1));
  }
  return seats.find((s) => s.name === name);
}

export const webData = (game) => getJson(`${BOT}/api/public/game/${game}/web-data`, undefined, 2);
export const draftData = (game) => getJson(`${SHIM}/bot/api/public/game/${game}/draft`);
export const engineState = (game) => getJson(`${BOT}/api/public/selfhost/engine/${game}/state`);
function botToken() {
  try {
    const m = /^DISCORD_BOT_TOKEN=(.*)$/m.exec(readFileSync("/home/user/run/bot.env", "utf8"));
    return m ? m[1].trim().replace(/^Bot /, "") : "";
  } catch {
    return "";
  }
}
/** The bot's own view of a game's open decisions (Bot token): {seq, decisions}. */
export const botDecisions = (game) => getJson(`${BOT}/api/public/selfhost/engine/${game}/decisions`, { headers: { Authorization: `Bot ${botToken()}` } });
export const readSave = (game) => {
  try {
    return readFileSync(`${MAPS}/${game}.txt`, "utf8");
  } catch {
    return null;
  }
};

/** Starts a solo game for a seat and waits until the shim's setup reports drafting/playing. */
export async function createSoloGame(token, bots = 3, log = console.log) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const t0 = Date.now();
    const r = await fetch(`${SHIM}/app/solo-game`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, bots, expansion: "te" }),
      signal: AbortSignal.timeout(360000), // creation is slow on a loaded stack; a timed-out request may still create the game (sweep.mjs ends orphans)
    }).catch((e) => ({ ok: false, json: async () => ({ message: String(e) }) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // A request that timed out may still have created the game (slow stack): adopt it instead of making another.
      const adopted = gameCreatedSince(token, t0);
      if (adopted) {
        log(`solo-game request failed (${JSON.stringify(j).slice(0, 120)}) but ${adopted} was created for this seat: using it`);
        return waitSoloSetup(adopted, log);
      }
      log(`solo-game refused: ${JSON.stringify(j).slice(0, 200)}; retrying in 30s`);
      await sleep(30000);
      continue;
    }
    log(`created ${j.game}; waiting for setup`);
    return waitSoloSetup(j.game, log);
  }
  throw new Error("could not create a solo game");
}

async function waitSoloSetup(game, log) {
  const until = Date.now() + 10 * 60000;
  while (Date.now() < until) {
    const st = await getJson(`${SHIM}/app/solo-game/status?game=${game}`);
    if (st?.state === "error") throw new Error(`solo setup of ${game} failed: ${st.error}`);
    if (st?.state === "drafting" || st?.state === "playing") return game;
    // The shim forgets a job's status after a restart: a game with a draft (running or done) is set up.
    const d = await draftData(game);
    if (d?.status === "drafting" || d?.status === "finished") return game;
    await sleep(3000);
  }
  log(`solo setup of ${game} did not reach the draft`);
  throw new Error(`solo setup of ${game} did not reach the draft`);
}

/** The newest not-ended game saved since `since` in which the seat with this token plays (or null). */
function gameCreatedSince(token, since) {
  let seats = [];
  try {
    seats = JSON.parse(readFileSync(SEATS_FILE, "utf8"));
  } catch {
    return null;
  }
  const uid = seats.find((x) => x.token === token)?.user_id;
  if (!uid) return null;
  let best = null;
  for (const f of readdirSync(MAPS)) {
    if (!/^pbd\d+\.txt$/.test(f)) continue;
    const st = statSync(`${MAPS}/${f}`);
    if ((st.birthtimeMs || st.mtimeMs) < since - 5000) continue;
    const save = readFileSync(`${MAPS}/${f}`, "utf8");
    if (!save.includes(uid) || Number(/^ended_date (\d+)/m.exec(save)?.[1] ?? 0) > 0) continue;
    const n = Number(f.match(/\d+/)[0]);
    if (!best || n > best.n) best = { n, game: f.replace(/\.txt$/, "") };
  }
  return best?.game ?? null;
}

/**
 * Is the stack up and not just restarted? Other agents restart the bot / shim (run/{bot,shim}-restarts.log); presses
 * that time out or fail around a restart are not findings. Returns false while down or within `graceS` of a restart.
 */
export async function stackHealthy(graceS = 90) {
  for (const f of ["/home/user/run/bot-restarts.log", "/home/user/run/shim-restarts.log"]) {
    try {
      if (Date.now() - statSync(f).mtimeMs < graceS * 1000) return false;
    } catch {
      /* no log */
    }
  }
  const h = await getJson(`${SHIM}/healthz`);
  return !!h?.bot;
}
/** Waits (up to `maxMin`) until stackHealthy(); returns how long it waited (ms). */
export async function waitForStack(log = console.log, maxMin = 15) {
  const t0 = Date.now();
  let said = false;
  while (!(await stackHealthy()) && Date.now() - t0 < maxMin * 60000) {
    if (!said) log("stack down or just restarted: pausing");
    said = true;
    await sleep(5000);
  }
  if (said) log(`stack back after ${Math.round((Date.now() - t0) / 1000)} s`);
  return Date.now() - t0;
}

/** Ends a game the fuzzer created (run/scripts/end-game.mjs). */
export function endGame(game, token, log = console.log) {
  try {
    const out = execFileSync("node", ["/home/user/run/scripts/end-game.mjs", game, token], { encoding: "utf8", timeout: 120000 });
    log(`end-game: ${out.trim()}`);
    return true;
  } catch (e) {
    log(`end-game ${game} failed: ${String(e.stdout ?? e.message).trim().slice(0, 200)}`);
    return false;
  }
}

/** Walks a component tree and returns its enabled interactive controls. */
export function controlsOf(components, { includeLinks = false } = {}) {
  const out = [];
  const walk = (list) => {
    for (const c of list ?? []) {
      if (!c || typeof c !== "object") continue;
      if (c.type === 2 && !c.disabled && (includeLinks || c.style !== 5) && c.custom_id) out.push({ kind: "button", id: c.custom_id, label: String(c.label ?? c.emoji?.name ?? "") });
      if ([3, 5, 6, 7, 8].includes(c.type) && !c.disabled && c.custom_id)
        out.push({ kind: "select", type: c.type, id: c.custom_id, label: String(c.placeholder ?? ""), options: c.options?.map((o) => o.value) ?? [], min: c.min_values ?? 1, max: c.max_values ?? 1 });
      walk(c.components);
      if (c.accessory) walk([c.accessory]);
    }
  };
  walk(components);
  return out;
}
export const snowTime = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);

// ---------------------------------------------------------------- engine view (mirror of web/src/engine/reducer.ts)

export function awaits(d, uid) {
  if (d.window) return d.window.eligible.includes(uid) && !d.window.responded.includes(uid);
  if (d.scope === "player") return d.target?.userId === uid;
  if (d.target?.resolvedBy === "mixed_owners") return optionsFor(d, uid).length > 0;
  return true;
}
export const optionsFor = (d, uid) => d.options.filter((o) => !o.owner?.userId || o.owner.userId === uid);
export const openToAll = (d) => d.scope === "table" && !d.window;
/** Decisions really waiting on me (the popup's list without window-less table prompts). */
export function myDecisions(view, uid, { includeOpen = false } = {}) {
  const seated = !!view.state?.players?.some((p) => p.userId === uid);
  const myFaction = view.state?.players?.find((p) => p.userId === uid)?.faction;
  const holding = (d) => d.kind === "strategy_card.resolve" && !!myFaction && d.window?.subject?.holder === myFaction;
  return Object.values(view.decisions)
    .filter((d) => (awaits(d, uid) || holding(d)) && (includeOpen ? d.scope === "player" || !!d.window || seated || holding(d) : !openToAll(d)))
    .sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
}

/**
 * A ws client of the shim (the protocol the web client speaks): channels + messages of one game, and (engine:true)
 * that game's engine stream (`engine_sub`), reduced exactly like the web's reducer. Reconnects by itself unless
 * closed; on reconnect it resumes the engine stream from the last seq applied, like the browser.
 */
export class ShimClient {
  constructor(token, { game, onFrame, label = "ws", engine = false } = {}) {
    Object.assign(this, { token, game, onFrame, label, engine });
    this.channels = new Map();
    this.msgs = new Map();
    this.waiters = new Map();
    this.nonce = 0;
    this.closed = false;
    this.connects = 0;
    this.view = { status: "off", seq: 0, state: null, decisions: {} };
    this.closedIds = new Map(); // decision id -> {at, reason, revision}
    this.lastEngineAt = 0;
  }
  inGame(ch) {
    if (!ch || !this.game) return false;
    const g = this.game;
    return String(ch.name).startsWith(`${g}-`) || String(ch.name).includes(`-${g}-`) || (!!ch.parent_id && this.inGame(this.channels.get(ch.parent_id)));
  }
  connect() {
    return new Promise((resolve) => {
      const ws = new WebSocket(`${SHIM.replace(/^http/, "ws")}/app/ws?token=${this.token}`);
      this.ws = ws;
      let done = false;
      const t = setTimeout(() => !done && ((done = true), resolve(false)), 20000);
      ws.on("message", (raw) => {
        let f;
        try {
          f = JSON.parse(String(raw));
        } catch {
          return;
        }
        this.apply(f);
        if (f.t === "hello" && !done) {
          done = true;
          clearTimeout(t);
          this.connects++;
          resolve(true);
        }
      });
      ws.on("close", () => {
        if (!done) (done = true), clearTimeout(t), resolve(false);
        if (!this.closed && this.ws === ws) setTimeout(() => !this.closed && this.ws === ws && this.connect(), 2000);
      });
      ws.on("error", () => {});
    });
  }
  /** Drops the socket without closing the client (it reconnects after 2 s, like a network blip). */
  drop() {
    try {
      this.ws?.terminate();
    } catch {
      /* gone */
    }
  }
  close() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* gone */
    }
  }
  history(channelId, limit = 50) {
    this.raw({ op: "history", channel_id: channelId, limit });
  }
  subscribeEngine(fresh = false) {
    this.view.status = this.view.status === "live" && !fresh ? "live" : "connecting";
    const resume = !fresh && this.view.seq > 0;
    this.raw({ op: "engine_sub", game: this.game, after: resume ? this.view.seq : undefined });
  }
  apply(f) {
    if (f.t === "hello") {
      this.me = f.user ?? f.me;
      this.engineInfo = f.engine;
      for (const c of f.channels ?? []) this.channels.set(c.id, c);
      for (const c of f.channels ?? []) if (this.inGame(c)) this.history(c.id);
      if (this.engine && this.game) this.subscribeEngine();
    } else if (f.t === "channels") for (const c of f.channels) this.channels.set(c.id, c);
    else if (f.t === "channel_upsert") {
      this.channels.set(f.channel.id, f.channel);
      if (this.inGame(f.channel)) this.history(f.channel.id);
    } else if (f.t === "history") for (const m of f.messages ?? []) this.put(m);
    else if (f.t === "message_create" || f.t === "message_update") this.put(f.message);
    else if (f.t === "message_delete") this.msgs.get(f.channel_id)?.delete(f.id);
    else if (f.t === "engine") this.applyEngine(f);
    const answerFrame = f.t === "engine" && f.type === "answer";
    if (f.nonce && this.waiters.has(f.nonce) && (["interaction_done", "modal", "autocomplete", "error"].includes(f.t) || answerFrame)) this.waiters.get(f.nonce)(f);
    this.onFrame?.(f);
  }
  applyEngine(f) {
    if (f.type !== "answer") this.lastEngineAt = Date.now();
    const v = this.view;
    const ev = (e) => {
      if (e.game !== this.game || e.seq <= v.seq) return;
      v.seq = e.seq;
      if (e.type === "state.changed") return;
      const held = v.decisions[e.decision.id];
      if (e.type === "decision.closed") {
        delete v.decisions[e.decision.id];
        this.closedIds.set(e.decision.id, { at: Date.now(), reason: e.reason, revision: e.decision.revision, seq: e.seq });
      } else if (!held || (e.decision.revision ?? 0) >= (held.revision ?? 0)) {
        v.decisions[e.decision.id] = e.decision;
        this.onReopen?.(e);
      }
    };
    if (f.type === "snapshot" && f.game === this.game) {
      Object.assign(v, { status: "live", seq: f.seq, state: f.state, decisions: Object.fromEntries(f.decisions.map((d) => [d.id, d])) });
      this.onSnapshot?.(f);
    } else if (f.type === "events" && f.game === this.game) {
      v.status = "live";
      f.events.forEach(ev);
    } else if (f.type === "event") ev(f.event);
    else if (f.type === "state" && f.game === this.game) {
      if (!v.state || f.state.seq >= v.state.seq || f.state.stateVersion > v.state.stateVersion) v.state = f.state;
    } else if (f.type === "unavailable" && f.game === this.game) {
      // Like the web (link.ts RETRY_MS): ask again later, from scratch (the bot may have restarted with a new seq).
      v.status = "unavailable";
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => !this.closed && this.view.status === "unavailable" && this.subscribeEngine(true), 10000);
    }
  }
  put(m) {
    if (!m?.channel_id) return;
    if (!this.msgs.has(m.channel_id)) this.msgs.set(m.channel_id, new Map());
    const prev = this.msgs.get(m.channel_id).get(m.id);
    this.msgs.get(m.channel_id).set(m.id, prev && !m.components && prev.components ? { ...prev, ...m } : m);
  }
  raw(op) {
    if (this.ws?.readyState !== 1) return null;
    const nonce = op.nonce ?? `fz-${this.label}-${++this.nonce}`;
    this.ws.send(JSON.stringify({ ...op, nonce }));
    return nonce;
  }
  /** Sends an op; resolves with the answering frame (interaction_done / modal / engine answer), or {t:"timeout"}. */
  send(op, timeout = 30000) {
    return new Promise((resolve) => {
      const nonce = this.raw(op);
      if (!nonce) return resolve({ t: "not_connected" });
      const t = setTimeout(() => (this.waiters.delete(nonce), resolve({ t: "timeout" })), timeout);
      this.waiters.set(nonce, (f) => (clearTimeout(t), this.waiters.delete(nonce), resolve(f)));
    });
  }
  gameMessages() {
    const out = [];
    for (const [cid, map] of this.msgs) {
      const ch = this.channels.get(cid);
      if (!this.inGame(ch)) continue;
      for (const m of map.values()) out.push({ ...m, _ch: ch });
    }
    return out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  }
  findMessage(channelId, messageId) {
    return this.msgs.get(channelId)?.get(messageId);
  }
}

/** Drives the Milty draft for a seat over ws (newest copy of each pick button), until the draft is finished. */
export async function driveDraft(client, game, userId, rng, log = console.log, minutes = 15) {
  const until = Date.now() + minutes * 60000;
  while (Date.now() < until) {
    const d = await draftData(game);
    if (!d || d.status === "finished") return true;
    if (d.status !== "drafting" || String(d.currentPlayer) !== userId) {
      await sleep(2000);
      continue;
    }
    const me = d.players.find((p) => String(p.userId) === userId);
    const have = new Set((me?.picks ?? []).map((p) => (p.type === "speakerOrder" ? "order" : p.type)));
    const btns = [];
    for (const m of client.gameMessages()) for (const c of controlsOf(m.components)) if (/^milty_(slice|faction|order)_/.test(c.id)) btns.push({ m, c });
    const kinds = rng.shuffle(["faction", "slice", "order"].filter((k) => !have.has(k)));
    let pressed = false;
    for (const k of kinds) {
      let opts = btns.filter((b) => b.c.id.startsWith(`milty_${k}_`));
      const newest = opts.reduce((a, b) => (BigInt(b.m.id) > BigInt(a) ? b.m.id : a), "0");
      opts = opts.filter((b) => b.m.id === newest);
      if (!opts.length) continue;
      const b = rng.pick(opts);
      const r = await client.send({ op: "click", channel_id: b.m.channel_id, message_id: b.m.id, custom_id: b.c.id });
      log(`draft pick ${b.c.id}${r.error ? ` -> ${r.error}` : ""}`);
      pressed = true;
      break;
    }
    await sleep(pressed ? 4000 : 2000);
  }
  return false;
}

// ---------------------------------------------------------------- state invariants (tests/engine/lib)

/** One snapshot of a game: the bot's web data + the current save (for card zones), labelled by the save's last command. */
export async function snapshotOf(game, id) {
  // The web data and the save must describe the same moment: re-read when a save landed while the web data was
  // fetched (else the round of one and the phase of the other disagree: fuzz pbd312's false phase.round-advance).
  let web;
  let save;
  for (let i = 0; i < 3; i++) {
    const before = readSave(game);
    web = await webData(game);
    save = readSave(game);
    if (save === before) break;
  }
  const label = save ? /^latest_command (.*)$/m.exec(save)?.[1] : undefined;
  return { id, web, save, label };
}

/**
 * Invariant violations of `cur` (and between `prev` and `cur` unless an undo happened in between).
 * Returns [{id, severity, message, player}] from tests/engine/lib/invariants.ts.
 */
export function invariantViolations(prev, cur, { undoSince = false } = {}) {
  const out = [...checkSnapshot(cur)];
  if (prev && !undoSince) out.push(...checkSequence([prev, cur]).filter((v) => !v.id.startsWith("progress.")));
  return out;
}

/** Plain summary of the parts of one seat a reload must not change (web data playerData row). */
export function seatSummary(p) {
  if (!p) return null;
  return {
    tacticalCC: p.tacticalCC,
    fleetCC: p.fleetCC,
    strategicCC: p.strategicCC,
    tg: p.tg,
    commodities: p.commodities,
    totalVps: p.totalVps,
    planets: [...(p.planets ?? [])].sort().join(","),
    exhausted: [...(p.exhaustedPlanets ?? [])].sort().join(","),
    acCount: p.acCount,
    soCount: p.soCount,
    techs: (p.techs ?? []).length,
    scs: [...(p.scs ?? [])].sort().join(","),
    passed: p.passed,
  };
}

// ---------------------------------------------------------------- bot errors (shim.log "[bot-log] ## ERROR" blocks)

/**
 * Follows shim.log from now on and returns the bot-log ERROR blocks that name the game (its channels), e.g.
 * `Error within handler "GamePhaseButtonHandler#passForRound"` + the exception line.
 */
export class BotErrorTail {
  constructor(game) {
    this.game = game;
    this.off = existsSync(SHIM_LOG) ? statSync(SHIM_LOG).size : 0;
    this.carry = "";
  }
  poll() {
    if (!existsSync(SHIM_LOG)) return [];
    const size = statSync(SHIM_LOG).size;
    if (size < this.off) this.off = 0; // rotated
    if (size === this.off) return [];
    const fd = openSync(SHIM_LOG, "r");
    const buf = Buffer.alloc(Math.min(size - this.off, 8 << 20));
    readSync(fd, buf, 0, buf.length, this.off);
    closeSync(fd);
    this.off += buf.length;
    const lines = (this.carry + buf.toString("utf8")).split("\n");
    this.carry = lines.pop() ?? "";
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/\[bot-log\] ## ERROR/.test(lines[i])) continue;
      const block = lines.slice(i, i + 8).join("\n");
      if (!block.includes(`${this.game}-`) && !block.includes(`${this.game} `)) continue;
      const handler = /Error within handler "([^"]+)"/.exec(block)?.[1] ?? /Message: ([^\n]{0,160})/.exec(block)?.[1] ?? "?";
      const exc = /(\w+(?:\.\w+)*(?:Exception|Error)[^\n]{0,200})/.exec(block.split("\n").slice(1).join("\n"))?.[1] ?? "";
      const who = /\*\*__`[^`]*`__\*\* (.*?) pressed button __\*\*(.*?)\*\*__\s+`\[([^\]]+)\]`/.exec(block);
      out.push({ handler, exc: exc.trim(), who: who?.[1], button: who?.[3], text: block.slice(0, 900) });
    }
    return out;
  }
}

// ---------------------------------------------------------------- violations

/**
 * Appends a violation to <FUZZ_DIR>/violations.jsonl and regenerates VIOLATIONS.md (deduped). `key` dedupes: the same
 * tool + kind + normalised detail counts once per run (and once per entry in VIOLATIONS.md, with a count).
 */
export function makeRecorder(tool, seed, game, extra = {}) {
  const seen = new Set();
  const list = [];
  return {
    list,
    record(v) {
      const key = violationKey(tool, v.kind, v.detail);
      if (seen.has(key)) return null;
      seen.add(key);
      const entry = { at: new Date().toISOString(), tool, seed, game: v.game ?? game(), key, severity: v.severity ?? "error", ...extra, ...v };
      list.push(entry);
      appendFileSync(`${FUZZ_DIR}/violations.jsonl`, JSON.stringify(entry) + "\n");
      console.log(`!! VIOLATION ${v.kind}: ${String(v.detail).slice(0, 300)}`);
      try {
        foldViolations();
      } catch (e) {
        console.log(`(VIOLATIONS.md not updated: ${e.message})`);
      }
      return entry;
    },
  };
}

export function violationKey(tool, kind, detail) {
  const d = String(detail ?? "")
    .replace(/\b(pbd|fuzz)\d+/g, "G")
    .replace(/\b\d{6,}\b/g, "ID")
    .replace(/\d+/g, "#")
    .slice(0, 140);
  return `${tool}|${kind}|${d}`;
}

/** Folds violations.jsonl into VIOLATIONS.md: one entry per key (count, first/last seen, a replay command), errors first. */
export function foldViolations() {
  const file = `${FUZZ_DIR}/violations.jsonl`;
  if (!existsSync(file)) return;
  const groups = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let v;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    if (v.triage === "ignore") continue;
    const k = v.key ?? violationKey(v.tool, v.kind, v.detail);
    if (!groups.has(k)) groups.set(k, { first: v, last: v, n: 0, games: new Set(), seeds: new Set() });
    const g = groups.get(k);
    g.n++;
    g.last = v;
    g.games.add(v.game);
    g.seeds.add(v.seed);
  }
  const rank = (g) => (g.first.severity === "warn" ? 1 : 0);
  const list = [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.n - a.n);
  const md = [
    "# Fuzz violations",
    "",
    `Generated ${new Date().toISOString()} from violations.jsonl by web/e2e/fuzz (deduped by tool + kind + normalised detail). ` +
      "A replay re-runs the same seed: the fuzzer's choices repeat from the same prompts, the bots are not seeded, so a whole-game replay diverges once their play differs; `--game` attaches to the recorded game if it still runs.",
    "",
  ];
  for (const g of list) {
    const v = g.last;
    md.push(`## [${v.severity ?? "error"}] ${v.tool} ${v.kind} (x${g.n}, ${g.games.size} game(s))`);
    md.push("");
    md.push(`- detail: ${String(v.detail).replace(/\n/g, " ").slice(0, 600)}`);
    if (v.triage_note) md.push(`- triage: ${v.triage_note}`);
    if (v.context) md.push(`- context: ${String(v.context).slice(0, 300)}`);
    md.push(`- first: ${g.first.at} ${g.first.game} seed ${g.first.seed}; last: ${v.at} ${v.game} seed ${v.seed}${v.step ? ` step ${v.step}` : ""}`);
    md.push(`- replay: \`${replayCommand(v)}\``);
    if (v.screenshot) md.push(`- screenshot: ${v.screenshot}`);
    if (v.trace?.length) {
      md.push("- last steps:");
      md.push("```");
      for (const t of v.trace.slice(-8)) md.push(typeof t === "string" ? t : JSON.stringify(t).slice(0, 300));
      md.push("```");
    }
    md.push("");
  }
  writeFileSync(`${FUZZ_DIR}/VIOLATIONS.md`, md.join("\n"));
}

export function replayCommand(v) {
  const dir = FUZZ_SRC;
  if (v.tool === "ui-fuzz") return `node ${dir}/ui-fuzz.mjs --seed ${v.seed}${v.engine ? " --engine 1" : " --engine 0"}${v.game ? ` --game ${v.game}` : ""}`;
  return `node ${dir}/ws-fuzz.mjs --seed ${v.seed}${v.seat ? ` --seat "${v.seat}"` : ""}${v.game ? ` --game ${v.game}` : ""}${v.step ? ` --steps ${v.step}` : ""}`;
}

/** Line logger to the console and a run log file. */
export function makeLogger(file) {
  return (...a) => {
    const line = `${now()} ${a.join(" ")}`;
    console.log(line);
    try {
      appendFileSync(file, line + "\n");
    } catch {
      /* log dir gone */
    }
  };
}
