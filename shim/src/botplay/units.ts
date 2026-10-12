import type { PlayerView } from "./board.js";

/*
 * Base unit stats by the bot's short ids (cv carrier, ca cruiser, dd destroyer, dn dreadnought, ws war sun,
 * fs flagship, ff fighter, gf infantry, mf mech, pd PDS, sd space dock). Faction units and upgrades are read from the
 * player's `unitsOwned` only as far as "<name>2" (upgraded) goes; the bot checks everything else.
 */

export type UnitStats = { name: string; move: number; capacity: number; cost: number; per: number; combat: number; dice: number };

const BASE: Record<string, UnitStats> = {
  cv: { name: "carrier", move: 1, capacity: 4, cost: 3, per: 1, combat: 9, dice: 1 },
  ca: { name: "cruiser", move: 2, capacity: 0, cost: 2, per: 1, combat: 7, dice: 1 },
  dd: { name: "destroyer", move: 2, capacity: 0, cost: 1, per: 1, combat: 9, dice: 1 },
  dn: { name: "dreadnought", move: 1, capacity: 1, cost: 4, per: 1, combat: 5, dice: 1 },
  ws: { name: "warsun", move: 2, capacity: 6, cost: 12, per: 1, combat: 3, dice: 3 },
  fs: { name: "flagship", move: 1, capacity: 3, cost: 8, per: 1, combat: 5, dice: 2 },
  ff: { name: "fighter", move: 0, capacity: 0, cost: 1, per: 2, combat: 9, dice: 1 },
  gf: { name: "infantry", move: 0, capacity: 0, cost: 1, per: 2, combat: 8, dice: 1 },
  mf: { name: "mech", move: 0, capacity: 0, cost: 2, per: 1, combat: 6, dice: 1 },
};

const UPGRADED: Record<string, Partial<UnitStats>> = {
  cv: { move: 2, capacity: 6 },
  ca: { move: 3, capacity: 1, combat: 6 },
  dd: { move: 2, combat: 8 },
  dn: { move: 2, combat: 5 },
  ff: { move: 2, combat: 8 },
  gf: { combat: 7 },
};

const NAMES: Record<string, string> = {
  cv: "carrier",
  ca: "cruiser",
  dd: "destroyer",
  dn: "dreadnought",
  ws: "warsun",
  fs: "flagship",
  ff: "fighter",
  gf: "infantry",
  mf: "mech",
};

export function statsOf(unit: string, me?: PlayerView): UnitStats {
  const base = BASE[unit] ?? { name: unit, move: 0, capacity: 0, cost: 99, per: 1, combat: 9, dice: 1 };
  const name = NAMES[unit];
  const owned = me?.unitsOwned ?? [];
  const upgraded = !!name && owned.some((u) => u === `${name}2` || (u.endsWith(`_${name}2`) && !u.startsWith("neutral")));
  return upgraded ? { ...base, ...UPGRADED[unit] } : base;
}

/** Rough combat value of a fleet (for "clearly outclasses" checks; a real simulator comes later). */
export function fleetStrength(units: { unit: string; count: number }[], me?: PlayerView) {
  let s = 0;
  for (const u of units) {
    if (u.unit === "gf" || u.unit === "mf" || u.unit === "pd" || u.unit === "sd") continue;
    const st = statsOf(u.unit, me);
    s += u.count * st.dice * ((11 - st.combat) / 10) * (u.unit === "dn" || u.unit === "ws" || u.unit === "fs" ? 2 : 1);
  }
  return s;
}
