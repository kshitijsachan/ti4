import { useEffect } from "react";
import { useDecisionFocus } from "@/decisions";
import { useLogFocus } from "@/gamelog";
import { useBoardFocus } from "./focus";

/** The open decision's system stays lit while the decision is open. */
function followDecisions() {
  let lastKey = useDecisionFocus.getState().key;
  return useDecisionFocus.subscribe((state) => {
    if (state.key === lastKey) return;
    lastKey = state.key;
    const board = useBoardFocus.getState();
    if (state.position) board.focus(state.position, true);
    else if (board.persist) board.focus(null);
  });
}

/** How long the log keeps its clicked row marked, matching the map's flash. */
const LOG_FOCUS_MS = 4000;

/** A system clicked in the log flashes on the map; the request is cleared once shown. */
function followLog() {
  let lastAt = useLogFocus.getState().focus?.at;
  let timer: number | undefined;
  const stop = useLogFocus.subscribe((state) => {
    const focus = state.focus;
    if (!focus?.position || focus.at === lastAt) return;
    lastAt = focus.at;
    useBoardFocus.getState().focus(focus.position, false);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (useLogFocus.getState().focus?.at === focus.at) useLogFocus.getState().clear();
    }, LOG_FOCUS_MS);
  });
  return () => {
    window.clearTimeout(timer);
    stop();
  };
}

/**
 * When a decision popup or a log entry is about a system, the table pans to
 * it (if it's off screen) and lights it up.
 */
export function useExternalFocus() {
  useEffect(() => {
    const stops = [followDecisions(), followLog()];
    return () => stops.forEach((stop) => stop());
  }, []);
}
