import { buttonUndoPhrase, lowerFirst, plainId } from "../decisions/model/phrasing.ts";
import type { Flow } from "./flows.ts";
import type { UndoPoint } from "./types";

/** Who I am, as the undo points name players (display name; the bot's lower-case user name in older saves). */
export type Me = { id?: string; names: string[] };

/** What "Undo" should do for me right now. */
export type UndoPlan =
  /** Nothing to undo. */
  | { kind: "none" }
  /** The latest action is mine and was one bot press: one plain step back. */
  | { kind: "latest"; point: UndoPoint }
  /**
   * My latest action, made of several bot presses (a panel that pressed a planet, then Done), with nothing of anyone
   * else's on top: rewind to the save before its first press. `summary` says what the action did.
   */
  | { kind: "flow"; point: UndoPoint; first: UndoPoint; target: UndoPoint; summary?: string }
  /**
   * My latest action has later actions by others on top (bots act within seconds): rewind to the save just before
   * mine, which also undoes `after`.
   */
  | { kind: "mine"; point: UndoPoint; target: UndoPoint; after: UndoPoint[]; summary?: string }
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

/** The button a save's press was on, without the faction lock ("… pressed button: Nestphar (3/2) (FFCC_x_refresh_nestphar)"). */
export function pointButtonId(point: UndoPoint): string {
  return plainId(/\(([^()]*)\)\s*$/.exec(point.command)?.[1]);
}

/** A press that only closes a prompt ("Done Readying Planets"): undone alone, it changes nothing. */
const CLOSER = /^deleteButtons(_|~|$)/;
/** How soon after my previous press a closing press counts as part of it (the web pressed both). */
const CLOSER_GAP_MS = 3000;
/** A recorded flow matches saves made around when it ran (the browser's clock and the bot's can differ a little). */
const FLOW_CLOCK_MS = 15 * 60_000;

/** The press that activates a system, and the presses that only lead up to it (Tactical Action, a ring menu). */
const ACTIVATE = /^ringTile_/;
const LEADS_TO_ACTIVATE = /^(tacticalAction(?!Build)|ring_|getTilesThisFarAway_)/;
/** How far apart the presses of one activation may be (the map presses them back to back; a player by hand, slower). */
const ACTIVATE_GAP_MS = 5 * 60_000;

/** Whether `point` is the press that activated a system. */
export const isActivation = (point: UndoPoint) => ACTIVATE.test(pointButtonId(point));

/**
 * An activation at `points[i]` and the Tactical Action / ring presses of mine right before it: one action for undo,
 * so one Undo gives the tactic token back and returns to the turn menu.
 */
function activationSpan(points: readonly UndoPoint[], i: number, me: Me): { first: number; summary?: string } | undefined {
  if (!isActivation(points[i])) return undefined;
  let first = i;
  for (let j = i + 1; j < points.length - 1; j++) {
    const p = points[j];
    if (isRollback(p) || !isMine(p, me) || !LEADS_TO_ACTIVATE.test(pointButtonId(p))) break;
    if (points[j - 1].savedAt - p.savedAt > ACTIVATE_GAP_MS) break;
    first = j;
    if (/^tacticalAction/.test(pointButtonId(p))) break;
  }
  if (first === i) return undefined;
  const words = pressedWords(points[i].label)?.trim();
  return { first, summary: words ? `Activated ${words}` : "Activated a system" };
}

/**
 * My action at `points[i]` as the saves it spans (newest first): the press there plus the earlier presses of the same
 * web flow, consecutive and mine. Returns the index of its first press and what the flow did.
 */
export function actionSpan(points: readonly UndoPoint[], i: number, me: Me, flows: readonly Flow[] = []): { first: number; summary?: string } {
  const activation = activationSpan(points, i, me);
  if (activation) return activation;
  const id = pointButtonId(points[i]);
  const savedAt = points[i].savedAt;
  const flow = id ? [...flows].reverse().find((f) => f.ids.includes(id) && Math.abs(f.at - savedAt) < FLOW_CLOCK_MS) : undefined;
  if (flow) {
    const left = [...flow.ids];
    left.splice(left.lastIndexOf(id), 1);
    let first = i;
    for (let j = i + 1; j < points.length - 1 && left.length; j++) {
      const p = points[j];
      const at = left.lastIndexOf(pointButtonId(p));
      if (isRollback(p) || !isMine(p, me) || at < 0) break;
      left.splice(at, 1);
      first = j;
    }
    return { first, summary: first > i ? flow.summary : undefined };
  }
  /* Not on record (another tab, storage blocked): a Done pressed right after my previous press closes that press. */
  const prev = points[i + 1];
  const closes =
    CLOSER.test(id) && !!prev && !!points[i + 2] && !isRollback(prev) && isMine(prev, me) && points[i].savedAt - prev.savedAt < CLOSER_GAP_MS;
  return { first: closes ? i + 1 : i };
}

/**
 * Plans the top bar's Undo. `points` is newest first (as the bot lists them). My latest action is looked up even when
 * others acted after it, so a player who mis-clicked can take it back after the bots already answered. An action the
 * web made of several presses (see `recordFlow`) is undone as a whole.
 */
export function planUndo(points: readonly UndoPoint[], me: Me, flows: readonly Flow[] = []): UndoPlan {
  const latest = points.find((p) => p.current) ?? points[0];
  if (!latest) return { kind: "none" };
  const start = points.indexOf(latest);
  // Undoing a roll-back is always mine to do (it brings back what the roll-back threw away).
  if (isRollback(latest)) return points[start + 1] ? { kind: "latest", point: latest } : { kind: "none" };
  if (isMine(latest, me)) {
    if (!points[start + 1]) return { kind: "none" };
    const span = actionSpan(points, start, me, flows);
    if (span.first === start) return { kind: "latest", point: latest };
    return { kind: "flow", point: latest, first: points[span.first], target: points[span.first + 1], summary: span.summary };
  }
  for (let i = start + 1; i < points.length - 1; i++) {
    const p = points[i];
    if (isRollback(p)) break; // never reach back across a roll-back: its earlier saves are another timeline
    if (!isMine(p, me)) continue;
    const span = actionSpan(points, i, me, flows);
    return { kind: "mine", point: p, target: points[span.first + 1], after: points.slice(start, i), summary: span.summary };
  }
  return points[start + 1] ? { kind: "others", point: latest } : { kind: "none" };
}

/** Buttons that pick something (a strategy card, a draft slice, seat or faction): undone as "you picked …". */
const PICK_ID = /^(scPick_\d+|(?:milty|queueMilyPick|draft\w*)_(?:faction|slice|order|seat|speaker)\w*)/i;

/** The button's words in a "X pressed “…”" label. */
const pressedWords = (label: string) => /pressed “(.*)”/.exec(label)?.[1];

/** A press in plain words ("readied Nestphar", "opened the end-of-turn abilities"); undefined when not a press. */
function pressPhrase(label: string, point: UndoPoint): string | undefined {
  const words = pressedWords(label);
  if (!words?.trim()) return undefined;
  const phrase = buttonUndoPhrase(pointButtonId(point), words);
  return phrase ? lowerFirst(phrase) : undefined;
}

/**
 * "Undo Tester pressed “Trade”" → "you picked Trade" (a strategy card, slice or faction pick), "you readied Nestphar"
 * (any other press, in plain words). `summary` is what a multi-press web action did ("Readied Nestphar").
 */
export function asMine(label: string, point: UndoPoint, summary?: string): string {
  if (summary) return `you ${lowerFirst(summary)}`;
  const id = pointButtonId(point);
  const picked = PICK_ID.test(id) || /scPick_\d+/.test(point.command) ? pressedWords(label) : undefined;
  if (picked) return `you picked ${picked}`;
  const phrase = pressPhrase(label, point);
  if (phrase) return `you ${phrase}`;
  const readable = readableLabel(label, point);
  return point.actor && readable.startsWith(point.actor + " ") ? `you${readable.slice(point.actor.length)}` : readable;
}

/** Someone else's action in plain words: "Bot Alpha 3 readied Nestphar". */
export function asTheirs(label: string, point: UndoPoint): string {
  const phrase = pressPhrase(label, point);
  return phrase && point.actor ? `${point.actor} ${phrase}` : readableLabel(label, point);
}

/**
 * A press on a button with no words (the draft's slice and seat buttons are emoji only) reads "X pressed “”": name it
 * from the button id the bot logged ("… (milty_slice_D)") instead, or just say a button was pressed.
 */
export function readableLabel(label: string, point: UndoPoint): string {
  if (!/“\s*”/.test(label)) return label;
  const id = pointButtonId(point);
  const draft = /^(?:milty|queueMilyPick)_(slice|order|faction)_(\w+)$/.exec(id);
  const what = draft
    ? draft[1] === "slice"
      ? `picked slice ${draft[2].toUpperCase()}`
      : draft[1] === "order"
        ? `picked seat ${draft[2]}`
        : `picked ${draft[2]}`
    : "pressed a button";
  return label.replace(/pressed “\s*”/, what);
}

/** "Bot Beta and Bot Alpha" / "Bot Beta, Bot Alpha and Tess" from the actors of `points`. */
export function whoActed(points: readonly UndoPoint[]): string {
  const names = [...new Set(points.map((p) => (p.actor && p.actor !== "someone" ? p.actor : "another player")))];
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
