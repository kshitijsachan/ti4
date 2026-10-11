import { useCallback, useMemo, useState, type SetStateAction } from "react";

const KEY = "ti4.decision.selection";
/** Prompts whose in-progress picks are kept (oldest dropped first). */
const KEEP = 40;

function all(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function write(key: string, value: unknown) {
  try {
    const next = { ...all() };
    delete next[key];
    next[key] = value;
    const keys = Object.keys(next).slice(-KEEP);
    sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, next[k]]))));
  } catch {
    /* storage blocked: the picks live for this page only */
  }
}

/**
 * `useState` for a panel's in-progress picks (stepper counts, checklist toggles) on one bot prompt, kept per tab in
 * session storage under `scope` and the prompt's message id, so a reload shows them as they were left (like the
 * payment panel). Values must be JSON (use arrays, not Sets).
 */
export function useStoredState<T>(scope: string, messageId: string, initial: T | (() => T)) {
  const key = `${scope}:${messageId}`;
  const [value, setValue] = useState<T>(() => {
    const saved = all()[key];
    if (saved !== undefined) return saved as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const set = useCallback(
    (next: SetStateAction<T>) =>
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        write(key, v);
        return v;
      }),
    [key],
  );
  return [value, set] as const;
}

/** `useStoredState` for a set of picked keys (stored as an array). */
export function useStoredSet(scope: string, messageId: string) {
  const [list, setList] = useStoredState<string[]>(scope, messageId, []);
  const value = useMemo(() => new Set(list), [list]);
  const set = useCallback(
    (next: SetStateAction<Set<string>>) => setList((prev) => [...(typeof next === "function" ? next(new Set(prev)) : next)]),
    [setList],
  );
  return [value, set] as const;
}
