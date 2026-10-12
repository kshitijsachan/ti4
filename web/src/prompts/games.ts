import type { Channel } from "@/discord";

/**
 * A game's channels, derived from the names the bot gives them. A private copy of `play/games.ts`, so the
 * decisions module keeps working while the page shell around it is rebuilt.
 */
export type GameChannels = {
  name: string;
  actions: Channel;
  tableTalk?: Channel;
  /** My private `Cards Info-<game>-<me>` thread, once the bot has made it. */
  hand?: Channel;
  mapUpdates?: Channel;
  /** Every other visible, unarchived thread of the game, newest first: combat, strategy cards, ... */
  threads: Channel[];
};

const THREAD_TYPES = new Set([10, 11, 12]);

function isHandThread(threadName: string, gameName: string) {
  if (!/cards[\s_-]?info/i.test(threadName)) return false;
  return threadName.split(/[\s-]+/).includes(gameName);
}

function byNewest(a: Channel, b: Channel) {
  return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
}

export function findGame(channels: Record<string, Channel>, gameName: string): GameChannels | undefined {
  const all = Object.values(channels);
  const actions = all.find((c) => c.type === 0 && c.name.toLowerCase() === `${gameName.toLowerCase()}-actions`);
  if (!actions) return undefined;
  const name = actions.name.slice(0, -"-actions".length);
  const prefix = `${name}-`;
  const tableTalk = all.find(
    (c) =>
      c.type === 0 &&
      c.id !== actions.id &&
      c.name.startsWith(prefix) &&
      (!actions.parent_id || c.parent_id === actions.parent_id),
  );
  const parents = new Set([actions.id, tableTalk?.id].filter(Boolean));
  const threads = all
    .filter((c) => THREAD_TYPES.has(c.type) && (parents.has(c.parent_id ?? "") || c.name.startsWith(prefix)))
    .sort(byNewest);
  const hand = threads.find((t) => isHandThread(t.name, name));
  const mapUpdates = threads.find((t) => t.name === `${name}-bot-map-updates`);
  return {
    name,
    actions,
    tableTalk,
    hand,
    mapUpdates,
    threads: threads.filter((t) => t !== hand && !t.thread_metadata?.archived),
  };
}
