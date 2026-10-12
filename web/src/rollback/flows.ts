import { plainId } from "../decisions/model/phrasing.ts";

/**
 * One panel action the web made of several bot presses ("ready Nestphar" = press the planet, then "Done Readying
 * Planets"). The bot saves after each press, so its plain one-step undo would only take back the last of them (the
 * Done, which changes nothing) and leave the planet readied. The Undo button undoes a recorded flow as a whole.
 */
export type Flow = {
  /** The pressed button ids, in order, without the faction lock. */
  ids: string[];
  /** What the flow did, in words ("Readied Nestphar"), for the Undo label. */
  summary?: string;
  at: number;
};

const KEY = "ti4.rollback.flows";
const KEEP = 30;

export function readFlows(): Flow[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.sessionStorage?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Flow[]) : [];
  } catch {
    return [];
  }
}

/** Remembers that `customIds` were pressed as one action (a single press is not worth recording). */
export function recordFlow(customIds: string[], summary?: string) {
  const ids = customIds.map(plainId).filter(Boolean);
  if (ids.length < 2) return;
  try {
    const next = [...readFlows(), { ids, summary, at: Date.now() }].slice(-KEEP);
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: undo falls back to one bot step */
  }
}
