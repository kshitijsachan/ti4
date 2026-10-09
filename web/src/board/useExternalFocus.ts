import { useEffect } from "react";
import { decisionFocusStore, logFocusStore, type FocusStore } from "./modules";
import { useBoardFocus } from "./focus";

type DecisionFocus = { position?: string | null; key?: number };
type LogFocus = {
  focus?: { position?: string; at?: number } | null;
  clear?: () => void;
};

/** The open decision's system stays lit while the decision is open. */
function followDecisions(store: FocusStore | undefined) {
  if (!store) return () => {};
  let lastKey = (store.getState() as DecisionFocus).key;
  return store.subscribe((raw) => {
    const state = raw as DecisionFocus;
    if (state.key === lastKey) return;
    lastKey = state.key;
    const board = useBoardFocus.getState();
    if (state.position) board.focus(state.position, true);
    else if (board.persist) board.focus(null);
  });
}

/** A system clicked in the log flashes once, then the request is cleared. */
function followLog(store: FocusStore | undefined) {
  if (!store) return () => {};
  return store.subscribe((raw) => {
    const state = raw as LogFocus;
    if (!state.focus?.position) return;
    useBoardFocus.getState().focus(state.focus.position, false);
    state.clear?.();
  });
}

/**
 * When a decision popup or a log entry is about a system, the table pans to
 * it (if it's off screen) and lights it up.
 */
export function useExternalFocus() {
  useEffect(() => {
    const stops = [followDecisions(decisionFocusStore), followLog(logFocusStore)];
    return () => stops.forEach((stop) => stop());
  }, []);
}
