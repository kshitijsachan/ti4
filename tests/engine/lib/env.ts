/*
 * Where the local stack lives. Everything here is overridable by environment variables so the harness can run
 * against another deployment (or a copy of the data directories).
 *
 *   SHIM_URL        shim HTTP/ws base                (http://127.0.0.1:8090)
 *   BOT_URL         bot Spring API, direct           (http://127.0.0.1:8081)
 *   BOT_STORAGE     bot DB_PATH (maps/, maps/undo/)  (/home/user/run/bot-storage)
 *   SHIM_STATE      shim state.json                  (/home/user/run/shim-data/state.json)
 *   ENGINE_RUN_DIR  harness scratch (seats, forks)   (/home/user/run/engine)
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
export const undoDir = (game: string) => join(mapsDir(), "undo", game);
export const undoFile = (game: string, index: number) => join(undoDir(game), `${game}_${index}.txt`);

export function ensureRunDir(): string {
  mkdirSync(RUN_DIR, { recursive: true });
  return RUN_DIR;
}

export type Json = Record<string, any>;

let shimCache: { mtime: number; state: Json } | null = null;
/** The shim's persisted state (users, channels, messages). ~60MB: cached until the file changes. */
export function shimState(): Json {
  const mtime = statSync(SHIM_STATE).mtimeMs;
  if (!shimCache || shimCache.mtime !== mtime) shimCache = { mtime, state: JSON.parse(readFileSync(SHIM_STATE, "utf8")) };
  return shimCache.state;
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
