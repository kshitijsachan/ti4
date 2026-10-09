import { create } from "zustand";

type BoardFocus = {
  /** Ring position of the system to bring into view, e.g. "305". */
  position: string | null;
  /** Bumps on every request so focusing the same system twice still pans. */
  key: number;
  focus: (position: string | null | undefined) => void;
};

/** The one place anything on the game screen asks the table to look at a system. */
export const useBoardFocus = create<BoardFocus>((set) => ({
  position: null,
  key: 0,
  focus: (position) =>
    set((s) => ({ position: position ?? null, key: s.key + 1 })),
}));

const POSITION = /^[0-9]{3,4}$|^[a-z]{1,4}[0-9]{0,3}$/i;

/**
 * Pulls a ring position out of whatever a focus store holds. Accepts a bare
 * string, or an object with one of the usual field names; the decisions and
 * log modules are free to shape their stores as they like.
 */
export function positionOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return POSITION.test(value) ? value : null;
  if (typeof value === "number") return String(value);
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const field of [
    "position",
    "systemPosition",
    "tile",
    "tilePosition",
    "system",
    "focus",
    "focused",
    "target",
  ]) {
    const found = positionOf(record[field]);
    if (found) return found;
  }
  return null;
}
