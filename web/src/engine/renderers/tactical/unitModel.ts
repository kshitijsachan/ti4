/** Which unit model a player actually has for an async unit id (pure; the unit list is passed in for tests). */

type UnitLike = { id: string; asyncId: string; name: string; source?: string; faction?: string; upgradesFromUnitId?: string; requiredTechId?: string };

/** The owner of a unit, as far as a name needs it (engine GameState player: faction + researched techs). */
export type UnitOwner = { faction?: string | null; techs?: readonly string[] | null } | null | undefined;

const SOURCE_RANK: Record<string, number> = { base: 0, pok: 1 };

/**
 * Their faction's own unit if it has one (else the generic one, base/PoK before homebrew), upgraded only when they
 * researched its upgrade technology. Without an owner: the base generic unit (never a homebrew "Infantry II" that
 * happens to share the async id, e.g. baldrick_infantry2).
 */
export function pickUnitModel<U extends UnitLike>(units: readonly U[], asyncId: string, owner?: UnitOwner): U | undefined {
  const all = units.filter((u) => u.asyncId === asyncId);
  if (all.length === 0) return undefined;
  const faction = owner?.faction ?? null;
  const own = faction ? all.filter((u) => u.faction === faction) : [];
  const pool = (own.length ? own : all.filter((u) => !u.faction)).slice();
  if (pool.length === 0) return all[0];
  pool.sort((a, b) => (SOURCE_RANK[a.source ?? ""] ?? 2) - (SOURCE_RANK[b.source ?? ""] ?? 2));
  const techs = owner?.techs ?? [];
  const upgraded = pool.find((u) => u.upgradesFromUnitId && u.requiredTechId && techs.includes(u.requiredTechId));
  if (upgraded) return upgraded;
  return pool.find((u) => !u.upgradesFromUnitId && !/2$/.test(u.id)) ?? pool.find((u) => !u.upgradesFromUnitId) ?? pool[0];
}
