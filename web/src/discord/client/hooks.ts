import { useEffect } from "react";
import type { Channel, Snowflake, User } from "../types";
import { usePlay, usePlayConnection } from "./PlayProvider";
import { EMPTY_CHANNEL } from "./store";

/** Messages for a channel; fetches the newest page the first time it is shown (and after reconnects). */
export function useChannelMessages(channelId: Snowflake | null | undefined) {
  const conn = usePlayConnection();
  const status = usePlay((s) => s.status);
  const data = usePlay((s) => (channelId ? s.messages[channelId] : undefined) ?? EMPTY_CHANNEL);
  useEffect(() => {
    if (!channelId || status !== "open") return;
    const c = conn.store.getState().messages[channelId];
    if (!c?.loaded) conn.loadHistory(channelId);
  }, [channelId, conn, status]);
  return data;
}

/** Marks a channel as on-screen while mounted, so it never accrues unread and stays read. */
export function useViewingChannel(channelId: Snowflake | null | undefined) {
  const conn = usePlayConnection();
  useEffect(() => {
    if (!channelId) return;
    conn.actions.view(channelId);
    return () => conn.actions.unview(channelId);
  }, [channelId, conn]);
}

export function displayName(u: User | undefined | null): string {
  if (!u) return "Unknown";
  return u.global_name || u.username;
}

/** First channel whose name matches the predicate (game channels are found by naming convention). */
export function useChannelWhere(pred: (c: Channel) => boolean): Channel | undefined {
  return usePlay((s) => Object.values(s.channels).find(pred));
}

export function isPendingKey(pending: Record<string, { key: string }>, key: string): boolean {
  for (const n in pending) if (pending[n].key === key) return true;
  return false;
}

/** True while an action with this key (e.g. `messageId:customId`) waits for the bot. */
export function usePendingKey(key: string): boolean {
  return usePlay((s) => isPendingKey(s.pending, key));
}
