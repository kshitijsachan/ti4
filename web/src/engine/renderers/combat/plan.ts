import type { CombatPlanEntry, HittableUnit } from "../../../../../shim/src/engine/kinds/combat";

/** Per unit stack: how many undamaged to sustain, undamaged to destroy, damaged to destroy. */
export type PlanRow = { unit: HittableUnit; sustain: number; destroy: number; destroyDamaged: number };

export const rowKey = (u: HittableUnit) => `${u.holder}/${u.unit}`;

const COST: Record<string, number> = { ff: 0, inf: 0, gf: 0, dd: 1, mf: 2, ca: 2, cv: 3, dn: 4, fs: 8, ws: 12 };

/**
 * The engine's usual choice, as a starting point: sustain whatever can, then lose the cheapest units first.
 */
export function suggestPlan(units: HittableUnit[], hits: number, sustainCancels: number): PlanRow[] {
  const rows = units.map((unit) => ({ unit, sustain: 0, destroy: 0, destroyDamaged: 0 }));
  let left = hits;
  for (const r of rows) {
    if (!r.unit.sustain) continue;
    const n = Math.min(r.unit.count - r.unit.damaged, Math.ceil(left / sustainCancels));
    r.sustain = Math.max(0, n);
    left -= r.sustain * sustainCancels;
  }
  const byCost = [...rows].sort((a, b) => (COST[a.unit.unit] ?? 5) - (COST[b.unit.unit] ?? 5));
  for (const r of byCost) {
    if (left <= 0) break;
    const undamaged = r.unit.count - r.unit.damaged - r.sustain;
    const take = Math.min(undamaged, left);
    r.destroy = take;
    left -= take;
    const dmg = Math.min(r.unit.damaged, left);
    r.destroyDamaged = dmg;
    left -= dmg;
  }
  return rows;
}

export function assigned(rows: PlanRow[], sustainCancels: number) {
  return rows.reduce((n, r) => n + r.sustain * sustainCancels + r.destroy + r.destroyDamaged, 0);
}

/** Same rule as the engine: exactly the hits owed, or fewer only when every unit is destroyed. */
export function planProblem(rows: PlanRow[], hits: number, sustainCancels: number): string | null {
  const total = assigned(rows, sustainCancels);
  const destroyed = rows.reduce((n, r) => n + r.destroy + r.destroyDamaged, 0);
  const units = rows.reduce((n, r) => n + r.unit.count, 0);
  if (total > hits && !(sustainCancels === 2 && total - 1 === hits)) return `${total - hits} more than owed`;
  if (total < hits && destroyed < units) return `${hits - total} left to assign`;
  return null;
}

export function toEntries(rows: PlanRow[]): CombatPlanEntry[] {
  const out: CombatPlanEntry[] = [];
  for (const r of rows) {
    const base = { holder: r.unit.holder, unit: r.unit.unit };
    if (r.sustain) out.push({ ...base, damaged: false, action: "sustain", count: r.sustain });
    if (r.destroyDamaged) out.push({ ...base, damaged: true, action: "destroy", count: r.destroyDamaged });
    if (r.destroy) out.push({ ...base, damaged: false, action: "destroy", count: r.destroy });
  }
  return out;
}
