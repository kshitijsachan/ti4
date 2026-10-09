import type { Channel } from "@/discord";

export type GameChannels = {
  name: string;
  actions: Channel;
  tableTalk?: Channel;
  /** My private `Cards Info-<game>-<me>` thread, once the bot has made it. */
  hand?: Channel;
  mapUpdates?: Channel;
  /** Every other visible thread of the game: combat, drafts, transactions... */
  threads: Channel[];
};

const THREAD_TYPES = new Set([10, 11, 12]);
const ACTIONS_SUFFIX = "-actions";

/** The bot names hand threads `Cards Info-<game>-<player>`. */
function isHandThread(threadName: string, gameName: string) {
  if (!/cards[\s_-]?info/i.test(threadName)) return false;
  return threadName.split(/[\s-]+/).includes(gameName);
}

export function isThread(channel: Channel) {
  return THREAD_TYPES.has(channel.type);
}

function byNewest(a: Channel, b: Channel) {
  return BigInt(b.id) > BigInt(a.id) ? 1 : -1;
}

/**
 * Games the player can see, derived from channel names the bot creates:
 * `<game>-actions` and `<game>-<fun-name>` under one category, with threads
 * parented to either.
 */
export function deriveGames(channels: Record<string, Channel>): GameChannels[] {
  const all = Object.values(channels);
  const actionChannels = all.filter(
    (c) => c.type === 0 && c.name.endsWith(ACTIONS_SUFFIX),
  );

  return actionChannels
    .map((actions) => buildGame(all, actions))
    .sort((a, b) => byNewest(a.actions, b.actions));
}

function buildGame(all: Channel[], actions: Channel): GameChannels {
  const name = actions.name.slice(0, -ACTIONS_SUFFIX.length);
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
    .filter(
      (c) =>
        isThread(c) &&
        (parents.has(c.parent_id ?? "") || c.name.startsWith(prefix)),
    )
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

export function findGame(
  channels: Record<string, Channel>,
  gameName: string,
): GameChannels | undefined {
  return deriveGames(channels).find(
    (g) => g.name.toLowerCase() === gameName.toLowerCase(),
  );
}

export function lobbyChannel(channels: Record<string, Channel>) {
  return Object.values(channels).find(
    (c) => c.type === 0 && c.name === "lobby",
  );
}
