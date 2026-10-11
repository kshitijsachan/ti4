/*
 * Save text -> the bot's web data, through a fork game (load the save with the bot's own rewind, then read
 * GET /api/public/game/{fork}/web-data) with the fork's ids and names mapped back to the original game's.
 */
import { BOT_URL, getJson, sleep, waitForStack, type Json } from "./env.ts";
import { closeFork, createFork, loadSave, openFork, seatMap, type Fork } from "./fork.ts";
import { parseSave, type ForkMap } from "./savefile.ts";
import { WEB_PHASES } from "./invariants.ts";

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

const sorted = (x: unknown) => JSON.stringify([...((x as unknown[]) ?? [])].map(String).sort());
const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** Does this web data show the state of `save` (round, phase and every seat's pools, goods, planets, techs, follows)? */
export function webShowsSave(web: Json, save: string, map: ForkMap): string | null {
  const p = parseSave(save);
  if (Number(web.gameRound ?? 0) !== Number(p.game.get("round") ?? 0)) return "round";
  const ph = WEB_PHASES[String(web.gameState?.phase ?? "")];
  const raw = p.game.get("phase_of_game") ?? "";
  if (ph !== undefined && ph !== "finished" && ph !== "" && raw && ph.toLowerCase() !== raw.toLowerCase() && !(raw === "status" && ph === "statusScoring") && !(raw === "voting" && ph === "agendaVoting"))
    return `phase ${ph} vs ${raw}`;
  for (const pl of p.players) {
    const id = map.users.get(pl.userId) ?? pl.userId;
    const w = (web.playerData ?? []).find((x: Json) => x.discordId === id);
    if (!w) continue;
    const checks: [string, unknown, unknown][] = [
      ["tg", w.tg, Number(pl.kv.get("trade_goods") ?? w.tg)],
      ["commodities", w.commodities, Number(pl.kv.get("commodities") ?? w.commodities)],
      ["tacticalCC", w.tacticalCC, Number(pl.kv.get("tactical_cc") ?? w.tacticalCC)],
      ["fleetCC", w.fleetCC, Number(pl.kv.get("fleet_cc") ?? w.fleetCC)],
      ["strategicCC", w.strategicCC, Number(pl.kv.get("strategy_cc") ?? w.strategicCC)],
      ["followedSCs", sorted(w.followedSCs), sorted(list(pl.kv.get("followed_sc")))],
      ["planets", sorted(w.planets), sorted(list(pl.kv.get("planets")))],
      ["exhaustedPlanets", sorted(w.exhaustedPlanets), sorted(list(pl.kv.get("planets_exhausted")))],
      ["techs", sorted(w.techs), sorted(list(pl.kv.get("tech")))],
      ["passed", w.passed, pl.kv.get("passed") === "true"],
    ];
    for (const [k, a, b] of checks) if (JSON.stringify(a) !== JSON.stringify(b)) return `${pl.kv.get("faction")}.${k}`;
  }
  return null;
}

/**
 * The fork's web data once the bot has rebuilt it for `save`. The bot refreshes its web-data cache asynchronously
 * after each save (GameWebStatePipeline), so poll until the payload shows the save (webShowsSave); after `timeoutMs`
 * the last payload is returned with `_stale` set.
 */
export async function forkWebData(fork: Fork, save: string, map: ForkMap, nonce?: string, timeoutMs = 60000): Promise<Json | null> {
  const end = Date.now() + timeoutMs;
  let last: Json | null = null;
  let why: string | null = "no web data";
  while (Date.now() < end) {
    last = await readWebData(fork.game);
    // The bot rebuilds web data on one thread shared by every game: under load it can lag many seconds behind.
    why = !last ? "no web data" : nonce && last.gameCustomName !== nonce ? "not rebuilt yet" : webShowsSave(last, save, map);
    if (!why) return last;
    await sleep(300);
  }
  return last ? { ...last, _stale: why } : null;
}

let nonces = 0;
export const newNonce = () => `replay-${Date.now().toString(36)}-${++nonces}`;

/** Materializes every save (in order) and returns its web data in the original game's terms (null where it failed). */
export async function materializeAll(
  game: string,
  saves: string[],
  o: { fork?: string; usernames?: Map<string, string>; log?: (s: string) => void; extraChannelIds?: Iterable<string> } = {},
): Promise<(Json | null)[]> {
  const log = o.log ?? (() => {});
  const fork = o.fork ? await openFork(o.fork) : await createFork(8, log);
  const out: (Json | null)[] = [];
  const extra = [...(o.extraChannelIds ?? [])];
  try {
    for (let i = 0; i < saves.length; i++) {
      await waitForStack(undefined, log);
      const map = seatMap(fork, saves[i], o.usernames);
      for (const id of extra) map.otherChannelIds!.add(id);
      try {
        const nonce = newNonce();
        await loadSave(fork, saves[i], map, undefined, nonce);
        const web = await forkWebData(fork, saves[i], map, nonce);
        if (web?._stale) {
          log(`${game}: save ${i + 1}/${saves.length}: web data never showed the save (${web._stale}); dropped`);
          out.push(null);
          continue;
        }
        const w = web ? unfork(web, fork, map) : null;
        if (w) w.gameCustomName = parseSave(saves[i]).game.get("game_custom_name") ?? w.gameCustomName;
        out.push(w);
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
