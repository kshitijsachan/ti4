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
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readShimState } from "../../../shim/tools/read-state.mjs";
import { BOT_STORAGE, BOT_URL, SHIM_STATE, SHIM_URL, ensureRunDir, gameFile, getJson, sleep, undoDir, undoFile, type Json } from "./env.ts";
import { GAME_CHANNEL_KEYS, PLAYER_CHANNEL_KEYS, isRealPlayer, parseSave, rewriteForFork, type ForkMap } from "./savefile.ts";
import { ShimClient, controlsOf, type Msg } from "./shim.ts";

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
  const state = readShimState(SHIM_STATE);
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
  const seats = (await replaySeats()).slice(0, n);
  const me = await getJson(`${SHIM_URL}/app/me?token=${seats[0].token}`);
  const lobby = me.lobby_channel_id as string;
  const c = await ShimClient.connect(seats[0].token);
  const before = new Set([...c.channels.values()].filter((ch) => /^pbd\d+-actions$/.test(ch.name)).map((ch) => ch.id));
  const launch = c.waitFrame(
    (f) => f.t === "message_create" && f.message.channel_id === lobby && controlsOf(f.message.components).some((x) => x.id === "launchGame") && seats.every((s) => String(f.message.content).includes(s.user_id)),
    60000,
  );
  log(`creating a fork game for ${seats.map((s) => s.name).join(", ")}`);
  const options = [
    { type: 3, name: "game_fun_name", value: "_" },
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
      const p = parseSave(readFileSync(gameFile(game), "utf8"));
      if (p.game.get("main_game_channel") && p.game.get("main_game_channel") !== "null" && latestUndo(game) >= 2) break;
    } catch {
      /* not yet */
    }
    await sleep(1000);
  }
  log(`fork ${game} ready`);
  return openFork(game);
}

export async function openFork(game: string): Promise<Fork> {
  const seats = await replaySeats();
  const p = parseSave(readFileSync(gameFile(game), "utf8"));
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
  const forkNow = parseSave(readFileSync(gameFile(fork.game), "utf8"));
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
  const forkNow = parseSave(readFileSync(gameFile(fork.game), "utf8"));
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
  if (latest < 2) throw new Error(`fork ${fork.game} has no undo history`);
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
  return readFileSync(gameFile(game), "utf8");
}
