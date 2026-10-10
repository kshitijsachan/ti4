import type { FactionUnit } from "./types";

export type UnitStat = { label: string; value: string };
export type UnitKeyword = { label: string; detail?: string };

const dice = (hitsOn?: number, count?: number) => {
  if (hitsOn === undefined) return undefined;
  return count && count > 1 ? `${hitsOn} ×${count}` : `${hitsOn}`;
};

function costLabel(cost?: number) {
  if (cost === undefined) return undefined;
  if (cost === 0.5) return "1 ×2";
  return `${cost}`;
}

/** The printed stat row of a unit card: cost, combat, move, capacity. Missing stats are omitted. */
export function unitStats(unit: FactionUnit): UnitStat[] {
  const stats: [string, string | undefined][] = [
    ["Cost", costLabel(unit.cost)],
    ["Combat", dice(unit.combatHitsOn, unit.combatDieCount)],
    ["Move", unit.moveValue !== undefined ? `${unit.moveValue}` : undefined],
    ["Capacity", unit.capacityValue !== undefined ? `${unit.capacityValue}` : undefined],
  ];
  return stats.filter((s): s is [string, string] => s[1] !== undefined).map(([label, value]) => ({ label, value }));
}

function productionLabel(unit: FactionUnit) {
  if (unit.productionValue === undefined) return undefined;
  if (unit.basicProduction === "res") return `resources ${unit.productionValue}`;
  return `${unit.productionValue}`;
}

/** Unit abilities printed in caps on the card (SUSTAIN DAMAGE, SPACE CANNON 5 ×3, …). */
export function unitKeywords(unit: FactionUnit): UnitKeyword[] {
  const out: UnitKeyword[] = [];
  if (unit.sustainDamage) out.push({ label: "Sustain Damage" });
  if (unit.planetaryShield) out.push({ label: "Planetary Shield" });
  const afb = dice(unit.afbHitsOn, unit.afbDieCount);
  if (afb) out.push({ label: "Anti-Fighter Barrage", detail: afb });
  const bombard = dice(unit.bombardHitsOn, unit.bombardDieCount);
  if (bombard) out.push({ label: "Bombardment", detail: bombard });
  const cannon = dice(unit.spaceCannonHitsOn, unit.spaceCannonDieCount);
  if (cannon) out.push({ label: unit.deepSpaceCannon ? "Deep Space Cannon" : "Space Cannon", detail: cannon });
  const production = productionLabel(unit);
  if (production) out.push({ label: "Production", detail: production });
  return out;
}

const BASE_TYPE_LABEL: Record<string, string> = {
  flagship: "Flagship",
  mech: "Mech",
  warsun: "War Sun",
  dreadnought: "Dreadnought",
  carrier: "Carrier",
  cruiser: "Cruiser",
  destroyer: "Destroyer",
  fighter: "Fighter",
  infantry: "Infantry",
  pds: "PDS",
  spacedock: "Space Dock",
};

export const baseTypeLabel = (baseType: string) => BASE_TYPE_LABEL[baseType] ?? baseType;

const BASE_TYPE_ORDER = [
  "flagship",
  "mech",
  "warsun",
  "dreadnought",
  "carrier",
  "cruiser",
  "destroyer",
  "fighter",
  "infantry",
  "pds",
  "spacedock",
];

export const baseTypeRank = (baseType: string) => {
  const i = BASE_TYPE_ORDER.indexOf(baseType);
  return i === -1 ? BASE_TYPE_ORDER.length : i;
};

/** Map-token ids ("fs", "mf", …) the board uses for units, by base type. */
export const ASYNC_ID_TO_BASE_TYPE: Record<string, string> = {
  fs: "flagship",
  mf: "mech",
  ws: "warsun",
  dn: "dreadnought",
  cv: "carrier",
  ca: "cruiser",
  dd: "destroyer",
  ff: "fighter",
  gf: "infantry",
  pd: "pds",
  sd: "spacedock",
};
