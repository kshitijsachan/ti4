import { getTileById } from "@/entities/lookup/systems";
import { getPlanetData } from "@/entities/lookup/planets";
import { getGenericUnitDataByAsyncId } from "@/entities/lookup/units";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";

/** Display names for the ids typed decisions carry (positions, tile ids, planet ids, async unit ids). */

export function systemName(position: string, tileId?: string | null) {
  const name = tileId ? getTileById(tileId)?.name : undefined;
  return name ? `${name} (${position})` : position;
}

export function planetName(planetId: string) {
  return getPlanetData(planetId)?.name ?? planetId;
}

export function unitName(asyncId: string, count = 1) {
  const name = getGenericUnitDataByAsyncId(asyncId)?.name ?? asyncId;
  if (count === 1) return name;
  return name.endsWith("y") ? `${name.slice(0, -1)}ies` : `${name}s`;
}

export function strategyCardName(initiative: number) {
  return getStrategyCardByInitiative(initiative)?.name ?? `Strategy card ${initiative}`;
}
