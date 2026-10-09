import { useEffect } from "react";
import { decisionFocusStore, logFocusStore, type FocusStore } from "./modules";
import { positionOf, useBoardFocus } from "./focus";

function follow(store: FocusStore | undefined) {
  if (!store?.subscribe || !store.getState) return () => {};
  let last = positionOf(store.getState());
  return store.subscribe((state) => {
    const next = positionOf(state);
    if (!next || next === last) {
      last = next;
      return;
    }
    last = next;
    useBoardFocus.getState().focus(next);
  });
}

/**
 * When a decision popup or a log entry is about a system, the table pans to
 * it and lights it up.
 */
export function useExternalFocus() {
  useEffect(() => {
    const stops = [follow(decisionFocusStore), follow(logFocusStore)];
    return () => stops.forEach((stop) => stop());
  }, []);
}
