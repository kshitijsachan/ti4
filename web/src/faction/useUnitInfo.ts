import { bundleFor, useFactionBundles } from "./data";
import { resolveUnit } from "./model";
import { ASYNC_ID_TO_BASE_TYPE } from "./unitStats";
import type { FactionTech, FactionUnit } from "./types";

export type UnitInfo = {
  unit: FactionUnit;
  /** The other side of the card: the upgrade (if `unit` is the base) or undefined. */
  upgrade?: FactionUnit;
  upgradeTech?: FactionTech;
};

const baseTypeOf = (id: string) => ASYNC_ID_TO_BASE_TYPE[id] ?? id;

/**
 * Stats and ability text for a unit, lazily loading the faction data. `unitId` may be an exact unit id
 * ("arborec_mech", "cruiser2") or a map token / base type ("fs", "mf", "flagship"), resolved to the faction's own
 * version — and to its upgrade when `owned` (the player's `unitsOwned`) includes it. Undefined while loading.
 */
export function useUnitInfo(unitId: string, faction?: string, owned?: string[]): UnitInfo | undefined {
  const loaded = useFactionBundles(faction);
  const bundle = (faction ? bundleFor(faction, loaded) : undefined) ?? loaded?.official;
  const unit = resolveUnit(unitId, bundle, faction, baseTypeOf, owned);
  if (!unit || !bundle) return undefined;
  const upgrade = unit.upgradesToUnitId ? bundle.units[unit.upgradesToUnitId] : undefined;
  const upgradeTech = upgrade?.requiredTechId ? bundle.techs[upgrade.requiredTechId] : undefined;
  return { unit, upgrade, upgradeTech };
}
