import type { Snowflake } from "../types";

const key = (scope: string) => `ti4play.lastRead.${scope}`;

/** Per-browser read markers. Storage can be unavailable (private mode); the UI works without it. */
export function readLastRead(scope: string): Record<Snowflake, Snowflake> {
  try {
    const raw = window.localStorage.getItem(key(scope));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<Snowflake, Snowflake>) : {};
  } catch {
    return {};
  }
}

export function writeLastRead(scope: string, value: Record<Snowflake, Snowflake>) {
  try {
    window.localStorage.setItem(key(scope), JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/** Generic per-browser JSON record under `ti4play.<name>`; `{}` when storage is unavailable. */
export function readStored<T>(name: string): Record<string, T> {
  try {
    const raw = window.localStorage.getItem(`ti4play.${name}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

export function writeStored(name: string, value: object) {
  try {
    window.localStorage.setItem(`ti4play.${name}`, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
