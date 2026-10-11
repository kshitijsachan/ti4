import type { GameState, Option } from "../../../../../shim/src/engine/types";
import type { CombatPlanEntry, HittableUnit } from "../../../../../shim/src/engine/kinds/combat";

/** A whole hit assignment, answered in one call (engine: POST …/decisions/{id}/combat-plan). */
export type CombatPlanPayload = { kind: "combat-plan"; plan: CombatPlanEntry[] };

export type RendererProps<D> = {
  decision: D;
  state: GameState | null;
  answer: (optionIdOrPayload: string | CombatPlanPayload) => unknown;
};

export const live = <V,>(o: Option<V>) => !o.disabled && !o.needsInput && !!o.value;

const UNIT_NAMES: Record<string, string> = {
  ff: "Fighter",
  inf: "Infantry",
  gf: "Infantry",
  mf: "Mech",
  dd: "Destroyer",
  ca: "Cruiser",
  cv: "Carrier",
  dn: "Dreadnought",
  fs: "Flagship",
  ws: "War Sun",
  pd: "PDS",
  sd: "Space Dock",
};

export const unitName = (id: string) => UNIT_NAMES[id] ?? id;

export const holderName = (holder: string) => (holder === "space" ? "space" : holder);

export function unitLabel(u: HittableUnit) {
  return `${u.count} ${unitName(u.unit)}${u.damaged ? ` (${u.damaged} damaged)` : ""}`;
}

export const ROLL_NAMES: Record<string, string> = {
  combat: "Combat round",
  afb: "Anti-fighter barrage",
  bombardment: "Bombardment",
  spacecannonoffence: "Space cannon offence",
  spacecannondefence: "Space cannon defence",
};

export function playerName(state: GameState | null, faction: string | null | undefined) {
  const p = state?.players.find((x) => x.faction === faction);
  return p?.userName ?? faction ?? "?";
}

export const me = (state: GameState | null) => state?.players.find((p) => p.self) ?? null;
