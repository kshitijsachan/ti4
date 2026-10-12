import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "ti4.engine.draft:";

function keyOf(decisionId: string, name: string) {
  return `${PREFIX}${decisionId}:${name}`;
}

function read<T>(key: string): { value: T } | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? null : { value: JSON.parse(raw) as T };
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the selection lasts for this page */
  }
}

/** A decision's stored selection outside React (e.g. the queue asking whether a primary was started). */
export function readDecisionState<T>(decisionId: string, name: string): T | undefined {
  return read<T>(keyOf(decisionId, name))?.value;
}

/**
 * `useState` for a selection in progress on one decision (planets ticked, units counted, a form half filled), kept
 * in this tab's session storage so a reload or reconnect lands on the same half-made choice. Forgotten when the
 * decision closes (`forgetClosedDrafts`).
 */
export function useDecisionState<T>(decisionId: string, name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const key = keyOf(decisionId, name);
  const [value, setValue] = useState<T>(() => {
    const stored = read<T>(key);
    if (stored) return stored.value;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    const stored = read<T>(key);
    if (stored) setValue(stored.value);
  }, [key]);
  const set: Dispatch<SetStateAction<T>> = useCallback(
    (next) =>
      setValue((cur) => {
        const v = typeof next === "function" ? (next as (c: T) => T)(cur) : next;
        write(key, v);
        return v;
      }),
    [key],
  );
  return [value, set];
}

/** Drops the stored selections of decisions that are no longer open. */
export function forgetClosedDrafts(openIds: Set<string>) {
  try {
    const store = window.sessionStorage;
    for (let i = store.length - 1; i >= 0; i--) {
      const k = store.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const id = k.slice(PREFIX.length, k.lastIndexOf(":"));
      if (!openIds.has(id)) store.removeItem(k);
    }
  } catch {
    /* storage unavailable */
  }
}
