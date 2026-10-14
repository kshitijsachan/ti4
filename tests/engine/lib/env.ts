/*
 * Where the local stack lives. Everything here is overridable by environment variables so the harness can run
 * against another deployment (or a copy of the data directories).
 *
 *   SHIM_URL        shim HTTP/ws base                (http://127.0.0.1:8090)
 *   BOT_URL         bot Spring API, direct           (http://127.0.0.1:8081)
 *   BOT_STORAGE     bot DB_PATH (maps/, maps/undo/)  (/home/user/run/bot-storage)
 *   SHIM_STATE      shim data dir or its state.json  (/home/user/run/shim-data/state.json; read with shim/tools/read-state.mjs)
 *   ENGINE_RUN_DIR  harness scratch (seats, forks)   (/home/user/run/engine)
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readShimState, shimStateStamp } from "../../../shim/tools/read-state.mjs";

export const SHIM_URL = process.env.SHIM_URL ?? "http://127.0.0.1:8090";
export const BOT_URL = process.env.BOT_URL ?? "http://127.0.0.1:8081";
export const BOT_STORAGE = process.env.BOT_STORAGE ?? "/home/user/run/bot-storage";
export const SHIM_STATE = process.env.SHIM_STATE ?? "/home/user/run/shim-data/state.json";
export const RUN_DIR = process.env.ENGINE_RUN_DIR ?? "/home/user/run/engine";
export const ENGINE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const RECORDINGS_DIR = join(ENGINE_DIR, "recordings");
/** Bot resources (unit models etc.), used by the invariant checker for unit capacities. Optional. */
export const BOT_RESOURCES =
  process.env.BOT_RESOURCES ?? "/home/user/asyncti4/ti4_map_generator_bot/src/main/resources";

export const mapsDir = () => join(BOT_STORAGE, "maps");
export const gameFile = (game: string) => join(mapsDir(), `${game}.txt`);

/** The game's live save, retried while the bot replaces it (the file can be missing for a moment mid-save: ENOENT). */
export function readGameFile(game: string): string {
  for (let i = 0; ; i++) {
    try {
      return readFileSync(gameFile(game), "utf8");
    } catch (e: any) {
      if (e?.code !== "ENOENT" || i >= 40) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}
export const undoDir = (game: string) => join(mapsDir(), "undo", game);
export const undoFile = (game: string, index: number) => join(undoDir(game), `${game}_${index}.txt`);

export function ensureRunDir(): string {
  mkdirSync(RUN_DIR, { recursive: true });
  return RUN_DIR;
}

export type Json = Record<string, any>;

let shimCache: { mtime: string; state: Json } | null = null;
/** The shim's persisted state (users, channels, messages). ~60MB: cached until the file changes. */
export function shimState(): Json {
  const mtime = shimStateStamp(SHIM_STATE);
  if (!shimCache || shimCache.mtime !== mtime) shimCache = { mtime, state: readShimState(SHIM_STATE) };
  return shimCache.state;
}

/*
 * Light reads of the shim store: the whole state (shimState) is every game's channels AND messages (~2 GB parsed);
 * a scenario only needs the slash-command registry (global.json) and its fork's channels (one game shard). The
 * sharded store is read directly, file by file, cached on the file's mtime; the old single state.json falls back to
 * shimState().
 */
const SHIM_DIR = SHIM_STATE.endsWith("state.json") ? dirname(SHIM_STATE) : SHIM_STATE;
const STORE = join(SHIM_DIR, "store");
const sharded = () => existsSync(join(STORE, "global.json"));
const lightCache = new Map<string, { mtime: number; value: any }>();
function readStoreJson(path: string, strip = false): any {
  let mtime = 0;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  const hit = lightCache.get(path);
  if (hit && hit.mtime === mtime) return hit.value;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const m = strip ? /^\{"seq":(\d+),/.exec(raw) : null;
  const value = JSON.parse(m ? "{" + raw.slice(m[0].length) : raw);
  lightCache.set(path, { mtime, value });
  return value;
}

/** The shim's global state (users, seats, commands, admin token…) without any channel or message. */
export function shimGlobal(): Json {
  return sharded() ? readStoreJson(join(STORE, "global.json")) ?? {} : shimState();
}

/** The shim's slash-command registry (array). */
export function shimCommands(): Json[] {
  const cmds = sharded() ? readStoreJson(join(STORE, "global.json"))?.commands : shimState().commands;
  return Array.isArray(cmds) ? cmds : Object.values(cmds ?? {});
}

/** The channel objects of one game (its shard: text channels, threads), keyed by id. No messages are read. */
export function shimGameChannels(game: string): Record<string, Json> {
  if (!sharded()) {
    const all = shimState().channels ?? {};
    const ids = new Set(Object.values(all).filter((c: any) => String(c?.name ?? "").toLowerCase().startsWith(`${game.toLowerCase()}-`)).map((c: any) => c.id));
    return Object.fromEntries(Object.entries(all).filter(([id, c]: [string, any]) => ids.has(id) || ids.has(c?.parent_id)));
  }
  return readStoreJson(join(STORE, "shards", `game-${game}.json`), true)?.channels ?? {};
}

/** Category channels (the archive category included), keyed by id. */
export function shimCategories(): Record<string, Json> {
  if (!sharded()) return Object.fromEntries(Object.entries(shimState().channels ?? {}).filter(([, c]: [string, any]) => c?.type === 4));
  return readStoreJson(join(STORE, "shards", "categories.json"), true)?.channels ?? {};
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function getJson(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** The bot's public web data for a game (what the web client renders), straight from the bot. */
export async function webData(game: string): Promise<Json | null> {
  try {
    return await getJson(`${BOT_URL}/api/public/game/${encodeURIComponent(game)}/web-data`);
  } catch {
    return null;
  }
}

/**
 * Waits until the shim is up and the bot is connected to it (others restart the stack while tests run): a step that
 * starts during a restart would otherwise fail for no reason of its own. Throws after `timeoutMs`.
 */
export async function waitForStack(timeoutMs = 600000, log: (s: string) => void = () => {}): Promise<void> {
  const end = Date.now() + timeoutMs;
  let said = false;
  while (Date.now() < end) {
    try {
      const h = await getJson(`${SHIM_URL}/healthz`);
      if (h?.ok && h.bot) {
        if (said) log("stack is back");
        return;
      }
    } catch {
      /* down */
    }
    if (!said) log("waiting for the shim / bot to come back…");
    said = true;
    await sleep(3000);
  }
  throw new Error(`the shim/bot did not come back within ${timeoutMs / 1000}s`);
}

export function fileExists(p: string) {
  return existsSync(p);
}

/** The bot token (engine API: `Authorization: Bot …`): $BOT_TOKEN, else DISCORD_BOT_TOKEN from $BOT_ENV (/home/user/run/bot.env). */
export function botToken(): string {
  if (process.env.BOT_TOKEN) return process.env.BOT_TOKEN;
  const file = process.env.BOT_ENV ?? "/home/user/run/bot.env";
  const m = /^DISCORD_BOT_TOKEN=(.*)$/m.exec(readFileSync(file, "utf8"));
  if (!m) throw new Error(`no DISCORD_BOT_TOKEN in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

/** GET/POST on the bot's trusted engine API (/api/public/selfhost/engine…). Returns {status, body}; never throws on HTTP errors. */
export async function engineApi(path: string, body?: Json, timeoutMs = 60000): Promise<{ status: number; body: any }> {
  const call = () =>
    fetch(`${BOT_URL}/api/public/selfhost/engine${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bot ${botToken()}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  let r: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await call();
      break;
    } catch (e: any) {
      // A pooled keep-alive socket the bot already closed (UND_ERR_SOCKET "other side closed", ECONNRESET): after a
      // long synchronous stretch (shimState reads of the whole store while polling) the close is only seen once the
      // next request went out on it (scenario game-end-rewind-unarchive step 6: "fetch failed"). GETs are safe to repeat.
      const code = e?.cause?.code;
      if (body || attempt >= 2 || !["UND_ERR_SOCKET", "ECONNRESET", "UND_ERR_CLOSED"].includes(code)) throw e;
      console.error(`engineApi ${path}: ${code} on a reused connection, retrying`);
      await sleep(500);
    }
  }
  const text = await r.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  return { status: r.status, body: parsed };
}
