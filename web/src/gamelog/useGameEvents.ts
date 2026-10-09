import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePlay, usePlayConnection, displayName } from "@/discord";
import type { Message } from "@/discord";
import type { Actor, GameEvent } from "./types";
import type { LogMessage } from "./parse/classify";
import { buildTimeline, toLogMessage, type ParseStats } from "./parse/timeline";

export type GameEventsResult = {
  /** Chronological (oldest → newest). */
  events: GameEvent[];
  /** Players seen in the log, by faction, in order of first appearance. */
  players: Actor[];
  /** Still paging older history in. */
  loading: boolean;
  stats: ParseStats;
};

/** The channels the log reads: `<game>-actions` and its `<game>-round-…` threads (strategy cards, combats). */
export function isLogChannel(name: string, gameName: string): boolean {
  return name === `${gameName}-actions` || name.startsWith(`${gameName}-round-`);
}

const converted = new WeakMap<Message, LogMessage>();
function convert(m: Message, channelName: string): LogMessage {
  const hit = converted.get(m);
  if (hit && hit.channelName === channelName) return hit;
  const lm = toLogMessage(m, channelName);
  converted.set(m, lm);
  return lm;
}

const MAX_PAGES_PER_CHANNEL = 60;

/** The ticker and the drawer read the same game: parse once per store change, not once per component. */
const timelineCache = new WeakMap<object, { buckets: unknown[]; names: string[]; timeline: ReturnType<typeof buildTimeline> }>();
const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Structured game events for a game, parsed from the bot's messages in the game's actions channel and
 * round / combat threads. Pages in the whole history of those channels (the log is the game's memory).
 */
export function useGameEvents(gameName: string): GameEventsResult {
  const conn = usePlayConnection();
  const status = usePlay((s) => s.status);
  const channelIds = usePlay(
    useShallow((s) => Object.values(s.channels).filter((c) => isLogChannel(c.name, gameName)).map((c) => c.id)),
  );
  const channelNames = usePlay(useShallow((s) => channelIds.map((id) => s.channels[id]?.name ?? "")));
  const buckets = usePlay(useShallow((s) => channelIds.map((id) => s.messages[id])));
  const users = usePlay((s) => s.users);

  const pagingKey = buckets.map((c, i) => `${channelIds[i]}:${c?.loaded ? 1 : 0}${c?.hasMore ? 1 : 0}${c?.loading ? 1 : 0}:${c?.ids.length ?? 0}`).join("|");
  useEffect(() => {
    if (status !== "open") return;
    channelIds.forEach((id, i) => {
      const c = buckets[i];
      if (c?.loading) return;
      if (c?.loaded && !c.hasMore) return;
      if ((c?.ids.length ?? 0) >= MAX_PAGES_PER_CHANNEL * 100) return;
      conn.loadHistory(id);
    });
  }, [pagingKey, status, conn]); // pagingKey captures channelIds and buckets

  const timeline = useMemo(() => {
    const cached = timelineCache.get(users);
    if (cached && sameList(cached.buckets, buckets) && sameList(cached.names, channelNames)) return cached.timeline;
    const msgs: LogMessage[] = [];
    buckets.forEach((c, i) => {
      if (!c) return;
      for (const id of c.ids) msgs.push(convert(c.byId[id], channelNames[i]));
    });
    const nameOf = (id: string) => (users[id] ? displayName(users[id]) : undefined);
    const built = buildTimeline(msgs, nameOf);
    timelineCache.set(users, { buckets, names: channelNames, timeline: built });
    return built;
  }, [buckets, channelNames, users]);

  const players = useMemo(() => rosterOf(timeline.events), [timeline.events]);
  const loading = buckets.some((c) => !c || !c.loaded || c.loading || (c.hasMore && c.ids.length < MAX_PAGES_PER_CHANNEL * 100));

  return { events: timeline.events, stats: timeline.stats, players, loading };
}

export function rosterOf(events: GameEvent[]): Actor[] {
  const seen = new Map<string, Actor>();
  for (const e of events) {
    for (const a of [e.actor, e.target]) {
      if (!a?.faction || !a.color) continue;
      seen.set(a.faction, a);
    }
  }
  return [...seen.values()];
}

/** Stable key for filtering by player. */
export function actorKey(a: Actor | undefined): string {
  return a?.faction ?? a?.userId ?? a?.name?.toLowerCase() ?? "";
}
