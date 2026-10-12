import { getTileById } from "@/entities/lookup/systems";
import { getPlanetData } from "@/entities/lookup/planets";
import { units } from "@/entities/data/units";
import { pickUnitModel, type UnitOwner } from "./unitModel";

import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";

export type { UnitOwner };

/** The unit model this owner actually has (faction unit, upgraded only with its upgrade tech). */
export const unitModel = (asyncId: string, owner?: UnitOwner) => pickUnitModel(units, asyncId, owner);

/** Display names for the ids typed decisions carry (positions, tile ids, planet ids, async unit ids). */

export function systemName(position: string, tileId?: string | null) {
  const name = tileId ? getTileById(tileId)?.name : undefined;
  return name ? `${name} (${position})` : position;
}

export function planetName(planetId: string) {
  return getPlanetData(planetId)?.name ?? planetId;
}

export function unitName(asyncId: string, count = 1, owner?: UnitOwner) {
  const name = unitModel(asyncId, owner)?.name ?? asyncId;
  if (count === 1) return name;
  return name.endsWith("y") ? `${name.slice(0, -1)}ies` : `${name}s`;
}

export function strategyCardName(initiative: number) {
  return getStrategyCardByInitiative(initiative)?.name ?? `Strategy card ${initiative}`;
}
