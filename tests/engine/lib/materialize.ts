/*
 * Save text -> the bot's web data, through a fork game (load the save with the bot's own rewind, then read
 * GET /api/public/game/{fork}/web-data) with the fork's ids and names mapped back to the original game's.
 */
import { BOT_URL, getJson, sleep, type Json } from "./env.ts";
import { closeFork, createFork, loadSave, openFork, seatMap, type Fork } from "./fork.ts";
import type { ForkMap } from "./savefile.ts";

/** Maps fork ids / names / game name in any JSON back to the original game's. */
export function unfork(json: Json, fork: Fork, map: ForkMap): Json {
  let s = JSON.stringify(json);
  for (const [orig, f] of map.users) s = s.split(f).join(orig);
  for (const [origName, forkName] of map.names) s = s.replace(new RegExp(`\\b${forkName}\\b`, "g"), origName);
  const seats = new Map(fork.seats.map((x) => [x.user_id, x.username]));
  for (const [orig, f] of map.users) {
    const un = seats.get(f);
    const origUn = map.usernames.get(orig);
    if (un && origUn) s = s.replace(new RegExp(`"${un}"`, "g"), JSON.stringify(origUn));
  }
  s = s.replace(new RegExp(`\\b${map.game[1]}\\b`, "g"), map.game[0]);
  return JSON.parse(s);
}

export async function readWebData(game: string): Promise<Json | null> {
  try {
    return await getJson(`${BOT_URL}/api/public/game/${game}/web-data`);
  } catch {
    return null;
  }
}

const stable = (w: Json | null) => (w ? JSON.stringify({ ...w, gameState: { ...w.gameState, turnStartedAt: 0 }, objectives: null }) : "");

/**
 * The fork's web data once the bot has rebuilt it after a save. The bot refreshes its web-data cache asynchronously
 * after each save (GameWebStatePipeline), so: wait for the payload to differ from `before` (read before the save),
 * or, when the new state renders identically, for `settleMs` with no change.
 */
export async function forkWebData(fork: Fork, before: Json | null, settleMs = 2500, timeoutMs = 10000): Promise<Json | null> {
  const end = Date.now() + timeoutMs;
  const start = Date.now();
  const was = stable(before);
  let last: Json | null = null;
  while (Date.now() < end) {
    last = await readWebData(fork.game);
    if (last && (stable(last) !== was || Date.now() - start >= settleMs)) return last;
    await sleep(250);
  }
  return last;
}

/** Materializes every save (in order) and returns its web data in the original game's terms (null where it failed). */
export async function materializeAll(
  game: string,
  saves: string[],
  o: { fork?: string; usernames?: Map<string, string>; log?: (s: string) => void; extraChannelIds?: Iterable<string> } = {},
): Promise<(Json | null)[]> {
  const log = o.log ?? (() => {});
  const fork = o.fork ? await openFork(o.fork) : await createFork(8, log);
  const out: (Json | null)[] = [];
  try {
    for (let i = 0; i < saves.length; i++) {
      const map = seatMap(fork, saves[i], o.usernames);
      if (o.extraChannelIds) for (const id of o.extraChannelIds) map.otherChannelIds!.add(id);
      try {
        const before = await readWebData(fork.game);
        await loadSave(fork, saves[i], map);
        const web = await forkWebData(fork, before);
        out.push(web ? unfork(web, fork, map) : null);
      } catch (e) {
        log(`${game}: save ${i + 1}/${saves.length} could not be materialized: ${(e as Error).message}`);
        out.push(null);
      }
      if ((i + 1) % 10 === 0) log(`${game}: materialized ${i + 1}/${saves.length} saves on ${fork.game}`);
    }
  } finally {
    closeFork(fork);
  }
  return out;
}
