import { useEffect } from "react";
import { create } from "zustand";
import { usePlay } from "@/discord";
import { getToken } from "@/play/session";
import { fetchUndoPoints, postRewind, postUndo } from "./api";
import type { RewindResponse, UndoPointsResponse } from "./types";

type GameEntry = { data?: UndoPointsResponse; error?: string; loading: boolean; fetchedAt: number };

type UndoStore = {
  games: Record<string, GameEntry>;
  /** Monotonic counter bumped after each rewind / undo from this tab (lets the log re-measure). */
  epoch: number;
  refresh: (game: string) => Promise<void>;
  rewind: (game: string, index: number) => Promise<RewindResponse>;
  undo: (game: string, force?: boolean) => Promise<RewindResponse>;
};

const inFlight = new Map<string, Promise<void>>();

function requireToken(): string {
  const token = getToken();
  if (!token) throw new Error("No seat token: open your player link first.");
  return token;
}

/** Shared per-game cache of the bot's undo saves and roll-back journal (one fetch for the log and the top bar). */
export const useUndoStore = create<UndoStore>((set, get) => ({
  games: {},
  epoch: 0,
  refresh: (game) => {
    const running = inFlight.get(game);
    if (running) return running;
    const token = getToken();
    if (!token) return Promise.resolve();
    const patch = (p: Partial<GameEntry>) =>
      set((s) => ({ games: { ...s.games, [game]: { ...(s.games[game] ?? { loading: false, fetchedAt: 0 }), ...p } } }));
    patch({ loading: true });
    const job = fetchUndoPoints(game, token)
      .then((data) => patch({ data, error: undefined, loading: false, fetchedAt: Date.now() }))
      .catch((e: unknown) => patch({ error: e instanceof Error ? e.message : String(e), loading: false, fetchedAt: Date.now() }))
      .finally(() => inFlight.delete(game));
    inFlight.set(game, job);
    return job;
  },
  rewind: async (game, index) => {
    const res = await postRewind(game, requireToken(), index);
    set((s) => ({ epoch: s.epoch + 1 }));
    await get().refresh(game);
    return res;
  },
  undo: async (game, force) => {
    const res = await postUndo(game, requireToken(), force);
    set((s) => ({ epoch: s.epoch + 1 }));
    await get().refresh(game);
    return res;
  },
}));

const POLL_MS = 30_000;
const SETTLE_MS = 700;

/**
 * The game's undo saves, kept fresh: re-fetched shortly after any new message in the game's actions channel or
 * undo-log thread (a save lands right after the bot posts), and every 30 s. Must sit inside `<PlayProvider>`.
 */
export function useUndoPoints(gameName: string) {
  const entry = useUndoStore((s) => s.games[gameName]);
  const refresh = useUndoStore((s) => s.refresh);
  const activity = usePlay((s) => {
    let key = "";
    for (const c of Object.values(s.channels)) {
      if (c.name !== `${gameName}-actions` && c.name !== `${gameName}-undo-log`) continue;
      const ids = s.messages[c.id]?.ids;
      key += `${c.id}:${ids?.[ids.length - 1] ?? ""}|`;
    }
    return key;
  });

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(gameName), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [gameName, activity, refresh]);

  useEffect(() => {
    const t = window.setInterval(() => void refresh(gameName), POLL_MS);
    return () => window.clearInterval(t);
  }, [gameName, refresh]);

  return { data: entry?.data, error: entry?.error, loading: !entry?.data && (entry?.loading ?? true) };
}
