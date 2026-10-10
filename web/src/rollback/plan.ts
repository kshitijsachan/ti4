import type { UndoPoint } from "./types";

/** Who I am, as the undo points name players (display name; the bot's lower-case user name in older saves). */
export type Me = { id?: string; names: string[] };

/** What "Undo" should do for me right now. */
export type UndoPlan =
  /** Nothing to undo. */
  | { kind: "none" }
  /** The latest action is mine: one plain step back. */
  | { kind: "latest"; point: UndoPoint }
  /**
   * My latest action has later actions by others on top (bots act within seconds): rewind to the save just before
   * mine, which also undoes `after`.
   */
  | { kind: "mine"; point: UndoPoint; target: UndoPoint; after: UndoPoint[] }
  /** I have no action left to undo; the latest is someone else's (undo needs their consent, or force). */
  | { kind: "others"; point: UndoPoint };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export function isMine(point: UndoPoint, me: Me): boolean {
  if (me.id && point.actorUserId) return point.actorUserId === me.id;
  if (!point.actor) return false;
  const actor = norm(point.actor);
  return me.names.some((n) => n && norm(n) === actor);
}

/** A roll-back's own save ("⏪ … rewound the game"): not an action anyone can undo as theirs. */
const isRollback = (p: UndoPoint) => p.command.startsWith("⏪");

/**
 * Plans the top bar's Undo. `points` is newest first (as the bot lists them). My latest action is looked up even when
 * others acted after it, so a player who mis-clicked can take it back after the bots already answered.
 */
export function planUndo(points: readonly UndoPoint[], me: Me): UndoPlan {
  const latest = points.find((p) => p.current) ?? points[0];
  if (!latest) return { kind: "none" };
  const start = points.indexOf(latest);
  // Undoing a roll-back is always mine to do (it brings back what the roll-back threw away).
  if (isMine(latest, me) || isRollback(latest)) return points[start + 1] ? { kind: "latest", point: latest } : { kind: "none" };
  for (let i = start + 1; i < points.length - 1; i++) {
    const p = points[i];
    if (isRollback(p)) break; // never reach back across a roll-back: its earlier saves are another timeline
    if (!isMine(p, me)) continue;
    return { kind: "mine", point: p, target: points[i + 1], after: points.slice(start, i) };
  }
  return points[start + 1] ? { kind: "others", point: latest } : { kind: "none" };
}

/** "Undo Tester pressed “Trade”" → "your pick of Trade" (a strategy card pick) or "you pressed “…”". */
export function asMine(label: string, point: UndoPoint): string {
  const picked = /scPick_\d+/.test(point.command) ? /“(.+)”/.exec(label)?.[1] : undefined;
  if (picked) return `your pick of ${picked}`;
  return point.actor && label.startsWith(point.actor + " ") ? `you${label.slice(point.actor.length)}` : label;
}

/** "Bot Beta and Bot Alpha" / "Bot Beta, Bot Alpha and Tess" from the actors of `points`. */
export function whoActed(points: readonly UndoPoint[]): string {
  const names = [...new Set(points.map((p) => (p.actor && p.actor !== "someone" ? p.actor : "another player")))];
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
