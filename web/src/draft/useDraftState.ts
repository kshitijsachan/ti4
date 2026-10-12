import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftState } from "./types";

type Options = {
  /** Prefix of the bot API as seen by the browser. The shim proxies `/bot/*` to the bot. */
  botBase?: string;
  pollMs?: number;
};

type Result = {
  draft: DraftState | null;
  error: string | null;
  loading: boolean;
  /** Fetch now (and again shortly after, to catch the bot's follow-up edits). */
  refresh: () => void;
};

/**
 * Polls the bot's draft endpoint. Responses carry the game's save version, so an unchanged draft
 * never re-renders. Polling pauses while the tab is hidden.
 */
export function useDraftState(
  gameName: string,
  { botBase = "/bot", pollMs = 2000 }: Options = {},
): Result {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastKey = useRef<string>("");
  const inFlight = useRef(false);
  const timers = useRef<number[]>([]);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(
        `${botBase}/api/public/game/${encodeURIComponent(gameName)}/draft`,
        {
          cache: "no-store",
        },
      );
      if (!res.ok)
        throw new Error(
          res.status === 404
            ? "Game not found"
            : `Draft unavailable (${res.status})`,
        );
      const text = await res.text();
      setError(null);
      if (text === lastKey.current) return;
      lastKey.current = text;
      setDraft(JSON.parse(text) as DraftState);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [botBase, gameName]);

  useEffect(() => {
    lastKey.current = "";
    setDraft(null);
    setLoading(true);
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    const onVisible = () =>
      document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, pollMs]);

  useEffect(
    () => () => timers.current.forEach((t) => window.clearTimeout(t)),
    [],
  );

  const refresh = useCallback(() => {
    void load();
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [350, 900, 1800].map((ms) =>
      window.setTimeout(() => void load(), ms),
    );
  }, [load]);

  return { draft, error, loading, refresh };
}
