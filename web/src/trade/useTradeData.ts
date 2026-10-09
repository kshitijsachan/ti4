import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPendingTrades, fetchTradeOptions } from "./api";
import type { PendingResponse, TradeOptions } from "./types";

type TradeData = {
  options: TradeOptions | null;
  pending: PendingResponse | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Polls the bot's trade options and open offers for one player. Polling pauses while the tab is hidden and
 * unchanged responses keep their previous object so React skips the re-render.
 */
export function useTradeData(
  gameName: string,
  token: string,
  { botBase = "/bot", pollMs = 4000 }: { botBase?: string; pollMs?: number } = {},
): TradeData {
  const [options, setOptions] = useState<TradeOptions | null>(null);
  const [pending, setPending] = useState<PendingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastJson = useRef({ options: "", pending: "" });

  const refresh = useCallback(async () => {
    if (!token) {
      setError("No seat token.");
      setLoading(false);
      return;
    }
    try {
      const [o, p] = await Promise.all([
        fetchTradeOptions(botBase, gameName, token),
        fetchPendingTrades(botBase, gameName, token),
      ]);
      const oj = JSON.stringify(o);
      const pj = JSON.stringify(p);
      if (oj !== lastJson.current.options) setOptions(o);
      if (pj !== lastJson.current.pending) setPending(p);
      lastJson.current = { options: oj, pending: pj };
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [botBase, gameName, token]);

  useEffect(() => {
    lastJson.current = { options: "", pending: "" };
    setLoading(true);
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = window.setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh, pollMs]);

  return { options, pending, error, loading, refresh };
}
