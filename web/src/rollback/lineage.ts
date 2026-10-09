import type { Rewind, UndoPoint } from "./types";

/**
 * Pure helpers that line the game log up with the bot's undo saves.
 *
 * The bot saves the game (and an undo copy) right after each action, so a log message belongs to the first save at or
 * after it. Messages are sent asynchronously and can reach the shim a few ms after that save, hence `SLACK_MS`.
 * The bot never deletes the messages of undone actions; the roll-back journal says "at `at`, the game went back to
 * the state saved at `toSavedAt`", from which we rebuild which stretches of time are still part of the live history.
 */

/** A message up to this long after a save still belongs to that save's action. */
export const SLACK_MS = 400;
/** A message more than this long before the next save was not followed by a save (nothing changed). */
export const ATTACH_MS = 15_000;

export type Interval = readonly [number, number];

/** Time ranges whose events are part of the current game history (everything else was undone). */
export function liveIntervals(rewinds: readonly Rewind[], now = Number.POSITIVE_INFINITY): Interval[] {
  const sorted = [...rewinds].sort((a, b) => a.at - b.at);
  const out: Interval[] = [];
  let x = now;
  for (let guard = 0; guard < 10_000; guard++) {
    const r = latestAtOrBefore(sorted, x);
    if (!r) {
      out.push([Number.NEGATIVE_INFINITY, x]);
      break;
    }
    out.push([r.at, x]);
    x = Math.min(r.toSavedAt + SLACK_MS, r.at - 1);
  }
  return out.reverse();
}

function latestAtOrBefore(sorted: readonly Rewind[], x: number): Rewind | undefined {
  let found: Rewind | undefined;
  for (const r of sorted) {
    if (r.at > x) break;
    found = r;
  }
  return found;
}

export function isLive(t: number, intervals: readonly Interval[]): boolean {
  return intervals.some(([a, b]) => t >= a && t <= b);
}

/** A save time: an existing undo copy, or one a roll-back deleted (`lost`). */
export type Save = { savedAt: number; point?: UndoPoint };

/**
 * The save that holds the state "just after" an event at time `t`: the first save from `t - SLACK_MS` on, if it came
 * soon enough to be that event's save; otherwise the save before it (the event changed nothing that was saved).
 * `saves` must be live and sorted by `savedAt` ascending. A result without `point` means that save no longer exists.
 */
export function saveAfter(t: number, saves: readonly Save[]): Save | undefined {
  const i = saves.findIndex((p) => p.savedAt >= t - SLACK_MS);
  if (i >= 0 && saves[i].savedAt - t <= ATTACH_MS) return saves[i];
  const before = i < 0 ? saves.length - 1 : i - 1;
  return before >= 0 ? saves[before] : undefined;
}

/** `saveAfter` over existing points only. */
export function pointAfter(t: number, points: readonly UndoPoint[]): UndoPoint | undefined {
  return saveAfter(t, points.map((point) => ({ savedAt: point.savedAt, point })))?.point;
}

export type RowRewind =
  /** Rewinding here restores `point`. */
  | { status: "live"; point: UndoPoint }
  /** The event is what the game currently shows (its save is the latest one). */
  | { status: "current"; point: UndoPoint }
  /** Part of history, but older than the oldest kept save. */
  | { status: "too-old" }
  /** Part of history, but its exact save was deleted by an earlier roll-back (later undone). */
  | { status: "lost" }
  /** Undone by a later rewind / undo. */
  | { status: "undone"; by?: Rewind };

export type RewindIndex = {
  rows: Map<string, RowRewind>;
  livePoints: UndoPoint[];
  latest?: UndoPoint;
};

type EventLike = { id: string; time: string };

/** Classify every event: undone, rewindable (and to which save), current, or too old. */
export function buildRewindIndex(events: readonly EventLike[], points: readonly UndoPoint[], rewinds: readonly Rewind[]): RewindIndex {
  const intervals = liveIntervals(rewinds);
  const livePoints = points.filter((p) => isLive(p.savedAt, intervals)).sort((a, b) => a.savedAt - b.savedAt);
  const latest = points.find((p) => p.current) ?? livePoints[livePoints.length - 1];
  const oldest = livePoints[0];
  const existing = new Set(points.map((p) => p.savedAt));
  const lost = rewinds.flatMap((r) => r.lostSavedAt ?? []).filter((t) => !existing.has(t) && isLive(t, intervals));
  const saves: Save[] = [...livePoints.map((point) => ({ savedAt: point.savedAt, point })), ...[...new Set(lost)].map((savedAt) => ({ savedAt }))].sort(
    (a, b) => a.savedAt - b.savedAt,
  );
  const sortedRewinds = [...rewinds].sort((a, b) => a.at - b.at);
  const rows = new Map<string, RowRewind>();
  for (const e of events) {
    const t = Date.parse(e.time);
    if (Number.isNaN(t)) continue;
    if (!isLive(t, intervals)) {
      rows.set(e.id, { status: "undone", by: sortedRewinds.find((r) => r.at >= t) });
      continue;
    }
    if (!oldest || t < oldest.savedAt - ATTACH_MS) {
      rows.set(e.id, { status: "too-old" });
      continue;
    }
    const save = saveAfter(t, saves);
    const point = save?.point;
    if (save && !point) rows.set(e.id, { status: "lost" });
    else if (!point) rows.set(e.id, { status: "too-old" });
    else if (latest && point.index === latest.index) rows.set(e.id, { status: "current", point });
    else rows.set(e.id, { status: "live", point });
  }
  return { rows, livePoints, latest };
}
