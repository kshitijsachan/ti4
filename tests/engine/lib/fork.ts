/*
 * Forks: throwaway games the harness owns, used to (a) turn any recorded save into the bot's web data and (b) replay
 * recorded actions against a recorded save.
 *
 * A fork is an ordinary game created by the "Replay 1..8" seats (created once through the shim's admin API and kept
 * in $ENGINE_RUN_DIR/seats.json). A recorded save is loaded into it by rewriting the save onto the fork (game name,
 * people seat-for-seat, channels; see savefile.rewriteForFork), writing it as the fork's next-to-latest undo copy and
 * calling the bot's own rewind endpoint (POST /api/game/{fork}/rewind). That is the same code path as the web's
 * "rewind", so the bot loads the save, saves it again (fresh web data, fresh undo copy) and nothing is restarted.
 *
 * To press a recorded button the fork needs a message carrying it (JDA resolves the pressed component from the
 * message). The rewind re-posts the pre-rewind state's "saved buttons" (GameUndoService.generateSavedButtons), so the
 * pre-rewind file is written with exactly the one button to press as its saved button: the bot itself posts the
 * carrier, in the channel the button was originally pressed in.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_STORAGE, BOT_URL, SHIM_URL, shimGlobal, botToken, ensureRunDir, gameFile, readGameFile, getJson, sleep, undoDir, undoFile, waitForStack, type Json } from "./env.ts";
import { GAME_CHANNEL_KEYS, PLAYER_CHANNEL_KEYS, isRealPlayer, parseSave, rewriteForFork, type ForkMap } from "./savefile.ts";
import { ShimClient, controlsOf, type Msg } from "./shim.ts";
import { openDecisions } from "./engine.ts";

export type Seat = { name: string; user_id: string; token: string; username: string };

const SEAT_NAMES = Array.from({ length: 8 }, (_, i) => `Replay ${i + 1}`);

/** The harness's own seats (created on first use with the shim's admin key from its state file). */
export async function replaySeats(): Promise<Seat[]> {
  const file = join(ensureRunDir(), "seats.json");
  try {
    const seats = JSON.parse(readFileSync(file, "utf8")) as Seat[];
    if (seats.length >= SEAT_NAMES.length) return seats;
  } catch {
    /* create below */
  }
  const state = shimGlobal(); // users, seats and the admin key only: never the whole store
  const existing = Object.values(state.seats as Record<string, Json>)
    .map((s) => ({ ...s, name: state.users[s.user_id]?.global_name, username: state.users[s.user_id]?.username }))
    .filter((s) => SEAT_NAMES.includes(s.name));
  const missing = SEAT_NAMES.filter((n) => !existing.some((s) => s.name === n));
  let created: Json[] = [];
  if (missing.length) {
    created = await getJson(`${SHIM_URL}/app/admin/players`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: state.admin_token, names: missing }),
    });
  }
  const seats: Seat[] = SEAT_NAMES.map((n) => {
    const s: Json | undefined = existing.find((x) => x.name === n) ?? created.find((x) => x.name === n);
    if (!s) throw new Error(`replay seat ${n} could not be created`);
    return { name: n, user_id: s.user_id, token: s.token, username: s.username ?? n.toLowerCase().replace(/[^a-z0-9_.]/g, "") };
  });
  writeFileSync(file, JSON.stringify(seats, null, 1));
  return seats;
}

/**
 * The bot reads per-person settings (auto-pass timers, preferred colours, ...) from user_settings/<user id>.json on
 * every use: give each replay seat the settings of the person it stands in for (or none, if they had none).
 */
export function mirrorUserSettings(map: ForkMap, recorded?: Record<string, Json>) {
  const dir = join(BOT_STORAGE, "user_settings");
  for (const [orig, seat] of map.users) {
    const src = join(dir, `${orig}.json`);
    const dst = join(dir, `${seat}.json`);
    try {
      // Prefer the settings captured with the recording: the live file may have changed since.
      const rec = recorded?.[orig];
      if (rec || (!recorded && existsSync(src))) {
        const s = rec ? { ...rec } : JSON.parse(readFileSync(src, "utf8"));
        s.userId = seat;
        writeFileSync(dst, JSON.stringify(s, null, 2));
      } else if (existsSync(dst)) rmSync(dst);
    } catch {
      /* settings are best effort */
    }
  }
}

/** Original user ids embedded in a component id (e.g. setupStep5_<user id>_keleresm_...) -> the replay seats'. */
export const mapIdsInCustomId = (customId: string, map: ForkMap) => customId.replace(/\d{15,20}/g, (id) => map.users.get(id) ?? id);

export function undoIndexes(game: string): number[] {
  try {
    return readdirSync(undoDir(game))
      .map((f) => new RegExp(`^${game}_(\\d+)\\.txt$`).exec(f)?.[1])
      .filter((x): x is string => !!x)
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export const latestUndo = (game: string) => undoIndexes(game).at(-1) ?? 0;

function atomicWrite(path: string, text: string) {
  const tmp = `${path}.engine-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export type Fork = {
  game: string;
  seats: Seat[];
  /** game-level channel ids of the fork */
  channels: Map<string, string>;
  actionsId: string;
  clients: Map<string, ShimClient>;
};

/** Creates a fresh fork game seating `n` replay seats (default all 8, so any recording up to 8 players fits). */
export async function createFork(n = 8, log: (s: string) => void = () => {}): Promise<Fork> {
  // One creation at a time machine-wide: two runs creating at once both saw the other's new pbdN-actions channel as
  // theirs and shared one fork (11:17, pbd656/pbd658) while their own games sat unused.
  const unlock = await creationLock(log);
  try {
    return await createForkLocked(n, log);
  } finally {
    unlock();
  }
}

async function creationLock(log: (s: string) => void): Promise<() => void> {
  const file = join(ensureRunDir(), "fork-create.lock");
  for (let warned = false; ; ) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      return () => rmSync(file, { force: true });
    } catch {
      try {
        const held = JSON.parse(readFileSync(file, "utf8"));
        if (!alive(held.pid) || Date.now() - held.at > 5 * 60000) rmSync(file, { force: true });
      } catch {
        /* being written */
      }
    }
    if (!warned) log("waiting for another run's fork creation");
    warned = true;
    await sleep(1000);
  }
}

async function createForkLocked(n: number, log: (s: string) => void): Promise<Fork> {
  // The game's fun name carries a nonce: its table-talk channel (pbdN-<nonce>) names the game this call created.
  const nonce = `fork${process.pid.toString(36)}${Date.now().toString(36)}`.toLowerCase();
  const seats = (await replaySeats()).slice(0, n);
  const me = await getJson(`${SHIM_URL}/app/me?token=${seats[0].token}`);
  const lobby = me.lobby_channel_id as string;
  const c = await ShimClient.connect(seats[0].token);
  const before = new Set([...c.channels.values()].filter((ch) => /^pbd\d+-actions$/.test(ch.name)).map((ch) => ch.id));
  const launch = c.waitFrame(
    (f) => f.t === "message_create" && f.message.channel_id === lobby && controlsOf(f.message.components).some((x) => x.id === "launchGame") && seats.every((s) => String(f.message.content).includes(s.user_id)) && String(f.message.content).includes(nonce),
    // the launch post names the game (fun name = this call's nonce): never click another creation's Launch button
    // (14:21: a run whose post came late after a bot restart had its game launched by the next run)
    180000,
  );
  log(`creating a fork game for ${seats.map((s) => s.name).join(", ")}`);
  const options = [
    { type: 3, name: "game_fun_name", value: nonce },
    ...seats.map((s, i) => ({ type: 6, name: `player${i + 1}`, value: s.user_id })),
  ];
  const r = await c.command(lobby, "game", [{ type: 1, name: "create_game_button", options }]);
  if (r.error) throw new Error(`create_game_button: ${r.error}`);
  const post = await launch;
  if (!post) throw new Error("the bot never posted the Launch Game button");
  const created = c.waitFrame((f) => (f.t === "channel_upsert" && /^pbd\d+-actions$/.test(f.channel.name) && !before.has(f.channel.id)) || (f.t === "channels" && f.channels.some((ch: Json) => /^pbd\d+-actions$/.test(ch.name) && !before.has(ch.id))), 120000);
  const lr = await c.click(lobby, post.message.id, "launchGame");
  if (lr.error) throw new Error(`launchGame: ${lr.error}`);
  const f = await created;
  if (!f) throw new Error("the fork's channels never appeared");
  const ch = f.t === "channel_upsert" ? f.channel : f.channels.find((x: Json) => /^pbd\d+-actions$/.test(x.name) && !before.has(x.id));
  const game = /^(pbd\d+)-actions$/.exec(ch.name)![1];
  c.close();
  // Wait for the bot to have written the game with its channels.
  for (let i = 0; i < 60; i++) {
    try {
      const p = parseSave(readGameFile(game));
      if (p.game.get("main_game_channel") && p.game.get("main_game_channel") !== "null" && latestUndo(game) >= 2) break;
    } catch {
      /* not yet */
    }
    await sleep(1000);
  }
  // A launch that never saved its channels (e.g. the shim restarted mid-launch: pbd260) leaves only the "Game
  // created" save; loadSave needs two. Fail here instead of handing out a fork every scenario refuses later.
  if (latestUndo(game) < 2) throw new Error(`fork ${game} was not launched cleanly (only ${latestUndo(game)} save); end it and create another`);
  // Another creator (an older harness without the lock) may have launched at the same moment: never take its game.
  const named = parseSave(readGameFile(game)).game.get("game_custom_name");
  if (named !== nonce) throw new Error(`fork creation crossed another run's: ${game} is "${named}", not this run's "${nonce}"`);
  log(`fork ${game} ready`);
  return openFork(game);
}

export async function openFork(game: string): Promise<Fork> {
  const seats = await replaySeats();
  const p = parseSave(readGameFile(game));
  const channels = new Map<string, string>();
  for (const k of GAME_CHANNEL_KEYS) if (p.game.has(k)) channels.set(k, p.game.get(k)!);
  return { game, seats, channels, actionsId: p.game.get("main_game_channel")!, clients: new Map() };
}

export async function clientFor(fork: Fork, userId: string): Promise<ShimClient> {
  let c = fork.clients.get(userId);
  if (c && c.ws.readyState === WebSocket.OPEN) return c;
  const seat = fork.seats.find((s) => s.user_id === userId);
  if (!seat) throw new Error(`no replay seat ${userId}`);
  c = await ShimClient.connect(seat.token);
  fork.clients.set(userId, c);
  return c;
}

export function closeFork(fork: Fork) {
  for (const c of fork.clients.values()) c.close();
  fork.clients.clear();
}

/** Original seats (in save order) -> replay seats: the mapping a fork uses for one recording. */
export function seatMap(fork: Fork, origText: string, usernames: Map<string, string> = new Map()): ForkMap {
  const p = parseSave(origText);
  const real = p.players.filter(isRealPlayer);
  if (real.length > fork.seats.length) throw new Error(`${real.length} players, only ${fork.seats.length} replay seats`);
  const users = new Map<string, string>();
  const names = new Map<string, string>();
  real.forEach((pl, i) => {
    users.set(pl.userId, fork.seats[i].user_id);
    names.set(pl.userName, fork.seats[i].name);
  });
  // An owner who is not seated keeps their id (the seat ids must map back one-to-one for comparisons).
  // The fork's current per-player threads, so a loaded save keeps using them instead of making new ones.
  const forkNow = parseSave(readGameFile(fork.game));
  const playerChannels = new Map<string, Map<string, string>>();
  for (const s of fork.seats) {
    const fp = forkNow.players.find((x) => x.userId === s.user_id);
    const m = new Map<string, string>();
    for (const k of PLAYER_CHANNEL_KEYS) m.set(k, fp?.kv.get(k) ?? "null");
    playerChannels.set(s.user_id, m);
  }
  const otherChannelIds = new Set<string>();
  for (const k of [...GAME_CHANNEL_KEYS]) {
    const v = p.game.get(k);
    if (v && v !== "null") otherChannelIds.add(v);
  }
  for (const pl of p.players) for (const k of PLAYER_CHANNEL_KEYS) {
    const v = pl.kv.get(k);
    if (v && v !== "null") otherChannelIds.add(v);
  }
  return {
    game: [p.name, fork.game],
    users,
    names,
    usernames,
    gameChannels: new Map([...fork.channels].filter(([k]) => k !== "saved_channel")),
    playerChannels,
    otherChannel: fork.actionsId,
    otherChannelIds,
  };
}

/** Adds every channel id of the original game (threads included) to the ids a fork remaps to its actions channel. */
export function addOriginalChannels(m: ForkMap, ids: Iterable<string>) {
  m.otherChannelIds ??= new Set();
  for (const id of ids) m.otherChannelIds.add(id);
}

/** `watcher`: the seat whose client waits for the carrier (it must see the carrier's channel). */
export type Carrier = { customId: string; label: string; faction?: string; channelId: string; thread?: boolean; message?: string; watcher?: string;
  /** a whole saved_buttons value (already in the fork's ids) to re-post instead of the one button; customId = one of its ids */
  raw?: string };

/** The fork's current thread ids, so a loaded save keeps using them (the bot may have created threads meanwhile). */
export function refreshThreads(fork: Fork, map: ForkMap) {
  const forkNow = parseSave(readGameFile(fork.game));
  for (const fp of forkNow.players) {
    const m = map.playerChannels.get(fp.userId);
    if (m) for (const k of PLAYER_CHANNEL_KEYS) if (fp.kv.get(k) && fp.kv.get(k) !== "null") m.set(k, fp.kv.get(k)!);
  }
}

/** A map that leaves a save already in the fork's terms as it is (to reload the fork's own state with a carrier). */
export function identityMap(fork: Fork): ForkMap {
  const playerChannels = new Map<string, Map<string, string>>();
  for (const s of fork.seats) playerChannels.set(s.user_id, new Map());
  const m: ForkMap = { game: [fork.game, fork.game], users: new Map(), names: new Map(), usernames: new Map(), gameChannels: new Map([...fork.channels].filter(([k]) => k !== "saved_channel")), playerChannels };
  refreshThreads(fork, m);
  return m;
}

/**
 * Loads an original save into the fork (see the file comment). With `carrier`, the bot also posts a message with that
 * one button in `carrier.channelId`; resolves with that message (for pressing it).
 */
export async function loadSave(fork: Fork, origText: string, map: ForkMap, carrier?: Carrier, nonce?: string): Promise<Msg | null> {
  const latest = latestUndo(fork.game);
  if (latest < 2) throw new Error(`fork ${fork.game} has no undo history (latest save ${latest}): it was never launched cleanly or a failed rewind consumed its saves; use a fresh fork`);
  refreshThreads(fork, map);
  const target = rewriteForFork(origText, map, { savedButtons: "", savedMessage: "", savedChannel: fork.actionsId, customName: nonce });
  atomicWrite(undoFile(fork.game, latest - 1), target);
  let pre = target;
  if (carrier) {
    const label = (carrier.label || carrier.customId).replace(/[;,\n]/g, " ").trim().slice(0, 78) || "Press";
    const saved = carrier.raw ?? `${carrier.faction ?? "null"};${carrier.customId.replace(/;/g, "fin66")};${label};PRIMARY`;
    pre = rewriteForFork(origText, map, { savedButtons: saved, savedMessage: carrier.message ?? `[replay] ${label}`, savedChannel: carrier.channelId, customName: nonce })
      // generateSavedButtons skips status phases: the pre-rewind file only needs to post the carrier.
      .replace(/^phase_of_game .*status.*$/m, "phase_of_game action")
      // Game.getSavedChannel looks the id up as a thread when the stored value savedChannelType says so.
      .replace(/^(check_reacts_info .*?)savedChannelType,[a-z]*/m, `$1savedChannelType,${carrier.thread ? "thread" : "text"}`);
    if (carrier.thread && !/^check_reacts_info .*savedChannelType,/m.test(pre)) pre = pre.replace(/^check_reacts_info (.*)$/m, (_, v) => `check_reacts_info ${v ? `${v}:` : ""}savedChannelType,thread`);
  }
  atomicWrite(gameFile(fork.game), pre);
  const c = await clientFor(fork, carrier?.watcher ?? fork.seats[0].user_id);
  const posted = carrier
    ? c.waitFrame((f) => f.t === "message_create" && f.message.channel_id === carrier.channelId && controlsOf(f.message.components).some((x) => x.id === carrier.customId), 20000)
    : Promise.resolve(null);
  const r = await fetch(`${BOT_URL}/api/game/${fork.game}/rewind`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fork.seats[0].token}` },
    body: JSON.stringify({ index: latest - 1 }),
  });
  if (!r.ok) throw new Error(`rewind ${fork.game} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
  const f = await posted;
  return f ? (f.message as Msg) : null;
}

/** Waits until the fork's saves settle: a new save appeared (or not, within `timeoutMs`) and nothing for `quietMs`. */
export async function waitForSaves(game: string, since: number, timeoutMs = 20000, quietMs = 1500): Promise<{ saves: number; latest: number }> {
  const end = Date.now() + timeoutMs;
  let last = latestUndo(game);
  let lastChange = Date.now();
  while (Date.now() < end) {
    await sleep(250);
    const now = latestUndo(game);
    if (now !== last) {
      last = now;
      lastChange = Date.now();
    }
    if (last > since && Date.now() - lastChange >= quietMs) break;
  }
  return { saves: last - since, latest: last };
}

export async function readForkSave(game: string): Promise<string> {
  return readGameFile(game);
}

/* ------------------------------------------------------------------ fork lifecycle: leases, reset, end */

/**
 * Concurrent harness-created forks are capped machine-wide (every scenario run of every agent shares
 * $ENGINE_RUN_DIR/fork-leases): a run takes one numbered lease per fork it creates (exclusive create) and frees it
 * when it ends the fork. A lease whose process is gone is reclaimed. Cap: SCEN_MAX_FORKS (default 4 = two --diff runs).
 */
export const MAX_FORKS = Number(process.env.SCEN_MAX_FORKS ?? 4);
const LEASE_DIR = () => join(ensureRunDir(), "fork-leases");

export type Lease = { file: string; release: () => void; note: (game: string) => void };

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
};

export async function acquireForkLease(log: (s: string) => void = () => {}, cap = MAX_FORKS, timeoutMs = 30 * 60000): Promise<Lease> {
  const dir = LEASE_DIR();
  mkdirSync(dir, { recursive: true });
  const end = Date.now() + timeoutMs;
  let warned = false;
  while (true) {
    for (let i = 1; i <= cap; i++) {
      const file = join(dir, `lease-${i}.json`);
      try {
        writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), game: null }), { flag: "wx" });
        const note = (game: string) => {
          try {
            writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), game }));
          } catch {}
        };
        return { file, note, release: () => rmSync(file, { force: true }) };
      } catch {
        // taken: reclaim it if its holder died (its fork, if any, is left to its owner: never end another run's game)
        try {
          const held = JSON.parse(readFileSync(file, "utf8"));
          if (held?.pid && !alive(held.pid)) {
            log(`fork lease ${i} held by dead pid ${held.pid}${held.game ? ` (fork ${held.game} was never ended)` : ""}: reclaimed`);
            rmSync(file, { force: true });
          }
        } catch {
          /* being written */
        }
      }
    }
    if (Date.now() > end) throw new Error(`no fork lease free after ${timeoutMs / 60000} min (cap ${cap}, ${dir})`);
    if (!warned) log(`waiting for a fork lease (${cap} harness forks in use; cap SCEN_MAX_FORKS)`);
    warned = true;
    await sleep(5000);
  }
}

/** Ends a fork game (the bot's /game end: no results posted, channels archived) as its first seat. */
export async function endFork(fork: Fork, log: (s: string) => void = () => {}, retry = true): Promise<boolean> {
  try {
    const c = await clientFor(fork, fork.seats[0].user_id);
    const r = await c.command(fork.actionsId, "game", [
      { type: 1, name: "end", options: [{ type: 3, name: "confirm", value: "YES" }, { type: 5, name: "publish", value: false }, { type: 5, name: "archive_channels", value: true }] },
    ]);
    if (r.error) log(`end ${fork.game}: ${r.error}`);
    else log(`fork ${fork.game} ended`);
    return !r.error;
  } catch (e: any) {
    log(`end ${fork.game}: ${e.message}`);
    if (!retry) return false;
    // The shim/bot restarting (a deploy) is the usual cause: wait for it (bounded) and try once more, so a fork this
    // run created is not left running.
    fork.clients.clear();
    await waitForStack(240000, log).catch(() => {});
    return endFork(fork, log, false);
  }
}

async function botRest(path: string, init: RequestInit = {}) {
  return fetch(`${SHIM_URL}/api/v10${path}`, { ...init, headers: { authorization: `Bot ${botToken()}`, "content-type": "application/json", ...(init.headers ?? {}) } });
}

/**
 * Resets a reused fork before a scenario loads its base: every message with buttons in the fork's channels and their
 * threads is deleted (the bot closes their decisions as "deleted"), so nothing from an earlier run (an open sabotage
 * window, a payment, a turn menu) can be answered or clicked by this one. The base save is then loaded as usual.
 */
export async function resetFork(fork: Fork, log: (s: string) => void = () => {}): Promise<number> {
  const roots = new Set([...fork.channels.values()].filter((v) => v && v !== "null"));
  const threads = (((await (await botRest(`/guilds/0/threads/active`)).json().catch(() => ({}))) as Json).threads ?? []) as Json[];
  const chans = [...roots, ...threads.filter((t) => roots.has(t.parent_id)).map((t) => t.id as string)];
  let n = 0;
  for (const ch of chans) {
    let before: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r = await botRest(`/channels/${ch}/messages?limit=100${before ? `&before=${before}` : ""}`);
      if (!r.ok) break;
      const msgs = (await r.json()) as Msg[];
      if (!msgs.length) break;
      const ids = msgs.filter((m) => controlsOf(m.components).length).map((m) => m.id);
      if (ids.length) {
        await botRest(`/channels/${ch}/messages/bulk-delete`, { method: "POST", body: JSON.stringify({ messages: ids }) });
        n += ids.length;
      }
      before = msgs.at(-1)!.id;
      if (msgs.length < 100) break;
    }
  }
  // The bot closes a deleted message's decision when its delete event arrives.
  for (let i = 0; i < 40; i++) {
    const open = await openDecisions(fork.game).catch(() => []);
    if (!open.length) break;
    await sleep(250);
  }
  log(`reset ${fork.game}: deleted ${n} message(s) with buttons`);
  return n;
}
