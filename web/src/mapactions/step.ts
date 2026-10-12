import type { Decision } from "../../../shim/src/engine/types";
import type { TacticalActivate, TacticalLand, TacticalMove, TurnAction } from "../../../shim/src/engine/kinds/tactical";

/*
 * The map's view of the engine's decisions, pure (node-testable): which tactical step waits on me, and which
 * decision's options are systems a map click can answer.
 */

/** Which step of a tactical action the engine waits on me for, read from my newest open tactical decision. */
export type TacticalStep =
  | { kind: "turn"; decision: TurnAction }
  | { kind: "choose"; decision: TacticalActivate }
  | { kind: "move"; decision: TacticalMove; target: string }
  | { kind: "land"; decision: TacticalLand; target: string }
  | { kind: "none" };

type AnyOption = Decision["options"][number];

export type SystemPick = {
  decision: Decision;
  byPosition: Record<string, AnyOption>;
};

/** The action-phase turn menu that still offers a tactical action (not the "end turn" menu after an action). */
export const isStartMenu = (d: Decision): d is TurnAction =>
  d.kind === "turn.action" &&
  d.options.some((o) => !o.disabled && o.value?.action === "tactical") &&
  !d.options.some((o) => !o.disabled && o.value?.action === "end_turn");

/** Later steps of a tactical action (finishing it, production, combat, …): the map has nothing to answer then. */
const LATER = /^(tactical\.conclude|production\.|combat\.|units\.)/;

const targetOfMove = (d: TacticalMove) =>
  d.progress?.accumulated.position ??
  d.options.map((o) => (o.value?.action === "done" ? o.value.position : undefined)).find(Boolean);

const targetOfLand = (d: TacticalLand) =>
  d.progress?.accumulated.position ?? d.options.map((o) => (o.value && "position" in o.value ? o.value.position : undefined)).find(Boolean);

/** My tactical step from my open decisions, newest first. Unrelated decisions (a card window, a trade) are skipped. */
export function tacticalStep(decisions: Decision[], active?: string | null): TacticalStep {
  const newestFirst = [...decisions].sort((a, b) => b.seq - a.seq);
  for (const d of newestFirst) {
    if (d.kind === "tactical.land") return { kind: "land", decision: d, target: targetOfLand(d) ?? active ?? "" };
    if (d.kind === "tactical.move") return { kind: "move", decision: d, target: targetOfMove(d) ?? active ?? "" };
    if (d.kind === "tactical.activate") return { kind: "choose", decision: d };
    if (d.kind === "turn.action") return isStartMenu(d) ? { kind: "turn", decision: d } : { kind: "none" };
    if (LATER.test(d.kind)) return { kind: "none" };
  }
  return { kind: "none" };
}

export const STEP_KINDS = new Set(["turn.action", "tactical.activate", "tactical.move", "tactical.land"]);
const POSITION_IN_ID = /(?:^|_)(\d{3,4}|tl|tr|bl|br)(?:_|$)/;

/** A typed option's system, else the position its handler names (when the label names that system too). */
function positionOf(o: AnyOption, names: Record<string, string>): string | undefined {
  const value = o.value as { position?: unknown } | null;
  if (typeof value?.position === "string" && names[value.position]) return value.position;
  const label = o.label.toLowerCase();
  /* Ids can carry several positions ("retreatUnitsFrom_<from>_<to>"): the one the label names. */
  return o.handler
    .split("_")
    .filter((p) => POSITION_IN_ID.test(p) && names[p])
    .find((p) => label.includes(p) || label.includes(names[p].toLowerCase()));
}

/** Options of a decision that each name a different system on the map; only when there are at least two. */
export function systemChoices(d: Decision, names: Record<string, string>): Record<string, AnyOption> | null {
  const out: Record<string, AnyOption> = {};
  for (const o of d.options) {
    if (o.disabled) continue;
    const pos = positionOf(o, names);
    if (!pos) continue;
    if (out[pos]) return null;
    out[pos] = o;
  }
  return Object.keys(out).length >= 2 ? out : null;
}

