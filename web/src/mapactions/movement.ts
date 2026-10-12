import type { PlayConnection } from "@/discord";
import type { TacticalMove } from "../../../shim/src/engine/kinds/tactical";
import type { HolderName, MoveRequest, UnitId } from "../../../shim/src/engine/types";
import type {
  EntityData,
  PlayerData,
  PlayerDataResponse,
  StateCounts,
} from "@/entities/data/types";
import { lookupUnit } from "@/entities/lookup/units";
import { moveViaEngine } from "./engine";

/** Units that never leave their planet. */
const STRUCTURES = new Set(["pd", "sd"]);
/** Units that ride in a ship's capacity rather than flying on their own. */
const CARGO = new Set(["ff", "gf", "mf"]);
const GROUND = new Set(["gf", "mf"]);

/** One kind of my units in one place of an origin system, e.g. 2 carriers (1 damaged) in space. */
export type UnitGroup = {
  /** "space" or a planet id. */
  holder: string;
  /** asyncId: cv, ff, gf, … */
  unit: string;
  name: string;
  /** Per state: healthy, damaged, galvanized, galvanized + damaged. */
  states: StateCounts;
  total: number;
  move: number;
  capacity: number;
  /** Rides in capacity (fighters, ground forces). */
  cargo: boolean;
};

export const groupKey = (g: { holder: string; unit: string }) =>
  `${g.holder}:${g.unit}`;

function statesOf(e: EntityData): StateCounts {
  const s = e.unitStates;
  if (s && s.some((n) => n > 0))
    return [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0];
  const damaged = Math.min(e.sustained ?? 0, e.count);
  return [e.count - damaged, damaged, 0, 0];
}

function groupOf(holder: string, e: EntityData, me: PlayerData): UnitGroup {
  const model = lookupUnit(e.entityId, me.faction, me);
  return {
    holder,
    unit: e.entityId,
    name: model?.name ?? e.entityId,
    states: statesOf(e),
    total: e.count,
    move: model?.moveValue ?? 0,
    capacity: model?.capacityValue ?? 0,
    cargo: CARGO.has(e.entityId),
  };
}

/** My movable units in a system: ships, fighters and ground forces in space, ground forces on its planets. */
export function unitsAt(
  position: string,
  me: PlayerData,
  web?: PlayerDataResponse,
): UnitGroup[] {
  const data = web?.tileUnitData?.[position];
  if (!data) return [];
  const out: UnitGroup[] = [];
  for (const e of data.space?.[me.faction] ?? []) {
    if (e.entityType !== "unit" || e.count < 1 || STRUCTURES.has(e.entityId))
      continue;
    out.push(groupOf("space", e, me));
  }
  for (const [planet, p] of Object.entries(data.planets ?? {})) {
    for (const e of p.entities?.[me.faction] ?? []) {
      if (e.entityType !== "unit" || e.count < 1 || !GROUND.has(e.entityId))
        continue;
      out.push(groupOf(planet, e, me));
    }
  }
  const order = ["ws", "fs", "dn", "ca", "cv", "dd", "ff", "mf", "gf"];
  return out.sort(
    (a, b) =>
      (a.holder === "space" ? 0 : 1) - (b.holder === "space" ? 0 : 1) ||
      order.indexOf(a.unit) - order.indexOf(b.unit),
  );
}

/** Planned moves: origin position → group key → how many. */
export type MovePlan = Record<string, Record<string, number>>;

/** Healthy units go first; damaged ones only once the healthy ones are all taken. */
export function splitStates(states: StateCounts, n: number): StateCounts {
  const out: StateCounts = [0, 0, 0, 0];
  let left = n;
  for (const i of [0, 2, 1, 3] as const) {
    const take = Math.min(left, states[i]);
    out[i] = take;
    left -= take;
  }
  return out;
}

export type PlanSummary = {
  ships: number;
  capacity: number;
  cargo: number;
  /** "2 Carrier, 4 Fighter". */
  text: string;
  empty: boolean;
};

export function summarize(
  plan: MovePlan,
  groups: Record<string, UnitGroup[]>,
): PlanSummary {
  let ships = 0;
  let capacity = 0;
  let cargo = 0;
  const names = new Map<string, number>();
  for (const [origin, picks] of Object.entries(plan)) {
    for (const g of groups[origin] ?? []) {
      const n = picks[groupKey(g)] ?? 0;
      if (!n) continue;
      if (g.cargo) cargo += n;
      else ships += n;
      capacity += n * g.capacity;
      names.set(g.name, (names.get(g.name) ?? 0) + n);
    }
  }
  const text = [...names.entries()]
    .map(([name, n]) => `${n} ${name}`)
    .join(", ");
  return { ships, capacity, cargo, text, empty: names.size === 0 };
}

/** The plan as the engine's move order: per origin and holder, how many of which unit (damaged ones last). */
function unitsOf(plan: MovePlan, groups: Record<string, UnitGroup[]>) {
  // Legacy map data spells units / holders with the engine's async ids: typed here, where they enter a MoveRequest.
  const out: MoveRequest["units"] = [];
  for (const [origin, picks] of Object.entries(plan)) {
    for (const g of groups[origin] ?? []) {
      const n = picks[groupKey(g)] ?? 0;
      if (!n) continue;
      const s = splitStates(g.states, n);
      out.push({ from: origin, holder: g.holder as HolderName, unit: g.unit as UnitId, count: n, damaged: s[1] + s[3] });
    }
  }
  return out;
}

/** Whether units were already staged on the engine's movement step (with its own buttons): the popup finishes it. */
export function hasStagedMoves(d: TacticalMove) {
  return (d.progress?.accumulated.staged?.length ?? 0) > 0;
}

/** Origins the engine's movement step offers ("move from" options; else its movement picture's origins with units). */
export function moveOrigins(d: TacticalMove, target: string): string[] {
  const from = new Set<string>();
  const pictured = new Set<string>();
  for (const o of d.options) {
    const v = o.value;
    if (o.disabled || !v) continue;
    if (v.action === "from") from.add(v.position);
    if (v.action === "done") for (const origin of v.origins ?? []) if (origin.units.length) pictured.add(origin.position);
  }
  const out = from.size ? from : pictured;
  out.delete(target);
  return [...out];
}

/** Moves the planned units into the active system and finishes movement, as one engine action. */
export async function commitMove(
  conn: PlayConnection,
  decision: TacticalMove,
  plan: MovePlan,
  groups: Record<string, UnitGroup[]>,
  onProgress?: (text: string) => void,
) {
  onProgress?.(summarize(plan, groups).empty ? "Done moving…" : "Moving your fleet…");
  await moveViaEngine(conn, decision, unitsOf(plan, groups));
}
