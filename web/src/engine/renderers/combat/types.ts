import { planetName } from "../tactical/names";
import type { GameState, Option, UnitId } from "../../../../../shim/src/engine/types";
import type { CombatPlanEntry, HittableUnit } from "../../../../../shim/src/engine/kinds/combat";
import { playerLabel } from "../../names";

/** A whole hit assignment, answered in one call (engine: POST …/decisions/{id}/combat-plan). */
export type CombatPlanPayload = { action: "combat-plan"; body: { plan: CombatPlanEntry[] } };

export type RendererProps<D> = {
  decision: D;
  state: GameState | null;
  answer: (optionIdOrPayload: string | CombatPlanPayload) => unknown;
};

export const live = <V,>(o: Option<V>) => !o.disabled && !o.needsInput && !!o.value;

const UNIT_NAMES: Record<string, string> = {
  ff: "Fighter",
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
} satisfies Partial<Record<UnitId, string>>;

export const unitName = (id: string) => UNIT_NAMES[id] ?? id;

export const holderName = (holder: string) => (holder === "space" ? "space" : planetName(holder));

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
  return faction ? playerLabel(state, faction) : "?";
}

export const me = (state: GameState | null) => state?.players.find((p) => p.self) ?? null;
