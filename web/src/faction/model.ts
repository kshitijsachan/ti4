import { baseTypeRank } from "./unitStats";
import type {
  FactionAbility,
  FactionBreakthrough,
  FactionBundle,
  FactionInfo,
  FactionLeader,
  FactionPlanet,
  FactionPlayer,
  FactionPromissory,
  FactionTech,
  FactionUnit,
} from "./types";

export type UnitEntry = {
  key: string;
  base: FactionUnit;
  upgrade?: FactionUnit;
  upgradeTech?: FactionTech;
  /** Set when a player is given: which side of the card they have. */
  owned?: "base" | "upgraded";
};

export type TechEntry = { tech: FactionTech; owned?: boolean; exhausted?: boolean };

export type LeaderState = "locked" | "unlocked" | "exhausted" | "active" | "purged";
export type LeaderEntry = { leader: FactionLeader; state?: LeaderState };

export type BreakthroughEntry = { breakthrough: FactionBreakthrough; state?: "locked" | "unlocked" | "exhausted" };

export type FactionSheetModel = {
  info: FactionInfo;
  name: string;
  sourceLabel: string;
  commodities?: number;
  abilities: (FactionAbility | { id: string; name: string; missing: true })[];
  homePlanets: FactionPlanet[];
  startingTech: FactionTech[];
  startingTechChoices: FactionTech[];
  headlineUnits: UnitEntry[];
  otherUnits: UnitEntry[];
  variantUnits: UnitEntry[];
  techs: TechEntry[];
  altTechs: FactionTech[];
  leaders: LeaderEntry[];
  altLeaders: FactionLeader[];
  promissoryNotes: FactionPromissory[];
  breakthrough?: BreakthroughEntry;
};

const SOURCE_LABEL: Record<string, string> = {
  base: "Base game",
  pok: "Prophecy of Kings",
  codex1: "Codex",
  codex2: "Codex",
  codex3: "Codex",
  codex4: "Codex",
  thunders_edge: "Thunder's Edge",
  ds: "Discordant Stars",
};

export const sourceLabel = (source: string) =>
  SOURCE_LABEL[source] ?? source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const unique = <T>(items: T[]) => [...new Set(items)];
const defined = <T>(item: T | undefined): item is T => item !== undefined;

function unitEntry(unit: FactionUnit, units: Record<string, FactionUnit>, techs: Record<string, FactionTech>): UnitEntry {
  const from = unit.upgradesFromUnitId ? units[unit.upgradesFromUnitId] : undefined;
  const isUpgradeOfOwnUnit = from && (from.faction === unit.faction || unit.requiredTechId);
  const base = isUpgradeOfOwnUnit ? from : unit;
  const upgrade = isUpgradeOfOwnUnit ? unit : unit.upgradesToUnitId ? units[unit.upgradesToUnitId] : undefined;
  const upgradeTech = upgrade?.requiredTechId ? techs[upgrade.requiredTechId] : undefined;
  return { key: base.id, base, upgrade, upgradeTech };
}

function buildUnits(info: FactionInfo, bundle: FactionBundle, player?: FactionPlayer) {
  const owned = player?.unitsOwned ?? [];
  const lineup = unique([...info.units, ...owned])
    .map((id) => bundle.units[id])
    .filter((u): u is FactionUnit => !!u?.faction);
  const entries = new Map<string, UnitEntry>();
  for (const unit of lineup) {
    const entry = unitEntry(unit, bundle.units, bundle.techs);
    if (!entries.has(entry.key)) entries.set(entry.key, entry);
  }
  const used = new Set([...entries.values()].flatMap((e) => [e.base.id, e.upgrade?.id]));
  const variants = info.extraUnits
    .filter((id) => !used.has(id))
    .map((id) => bundle.units[id])
    .filter(defined)
    .map((u) => ({ key: u.id, base: u }));
  const withOwnership = (e: UnitEntry): UnitEntry => {
    if (!player) return e;
    return { ...e, owned: e.upgrade && owned.includes(e.upgrade.id) ? "upgraded" : "base" };
  };
  const sorted = [...entries.values()]
    .map(withOwnership)
    .sort((a, b) => baseTypeRank(a.base.baseType) - baseTypeRank(b.base.baseType));
  const isHeadline = (e: UnitEntry) => e.base.baseType === "flagship" || e.base.baseType === "mech";
  return {
    headlineUnits: sorted.filter(isHeadline),
    otherUnits: sorted.filter((e) => !isHeadline(e)),
    variantUnits: variants.sort((a, b) => baseTypeRank(a.base.baseType) - baseTypeRank(b.base.baseType)),
  };
}

function buildTechs(info: FactionInfo, bundle: FactionBundle, player?: FactionPlayer) {
  const fromPlayer = unique([...(player?.factionTechs ?? []), ...(player?.notResearchedFactionTechs ?? [])]);
  const ids = fromPlayer.length ? fromPlayer : (info.factionTech ?? []);
  const techs: TechEntry[] = ids
    .map((id) => bundle.techs[id])
    .filter(defined)
    .map((tech) =>
      player
        ? { tech, owned: player.techs?.includes(tech.alias), exhausted: player.exhaustedTechs?.includes(tech.alias) }
        : { tech },
    );
  const altTechs = unique([...info.extraTechs, ...(info.factionTech ?? [])])
    .filter((id) => !ids.includes(id))
    .map((id) => bundle.techs[id])
    .filter(defined);
  return { techs, altTechs };
}

const LEADER_ORDER = ["agent", "commander", "hero"];
const leaderRank = (type: string) => {
  const i = LEADER_ORDER.indexOf(type);
  return i === -1 ? LEADER_ORDER.length : i;
};

function leaderState(p: NonNullable<FactionPlayer["leaders"]>[number]): LeaderState {
  if (p.locked) return "locked";
  if (p.active) return "active";
  if (p.exhausted) return "exhausted";
  return "unlocked";
}

function buildLeaders(info: FactionInfo, bundle: FactionBundle, player?: FactionPlayer) {
  const defaults = (info.leaders ?? []).map((id) => bundle.leaders[id]).filter(defined);
  const playerLeaders = player?.leaders;
  let leaders: LeaderEntry[];
  if (!playerLeaders) {
    leaders = defaults.map((leader) => ({ leader }));
  } else {
    const held: LeaderEntry[] = playerLeaders
      .map((p) => {
        const leader = bundle.leaders[p.id];
        return leader ? { leader, state: leaderState(p) } : undefined;
      })
      .filter(defined);
    const heldTypes = new Set(held.map((e) => e.leader.type));
    const purged = defaults
      .filter((l) => !heldTypes.has(l.type))
      .map((leader): LeaderEntry => ({ leader, state: "purged" }));
    leaders = [...held, ...purged];
  }
  leaders.sort((a, b) => leaderRank(a.leader.type) - leaderRank(b.leader.type));
  const shown = new Set(leaders.map((e) => e.leader.id));
  const altLeaders = unique([...info.extraLeaders, ...(info.leaders ?? [])])
    .filter((id) => !shown.has(id))
    .map((id) => bundle.leaders[id])
    .filter(defined)
    .sort((a, b) => leaderRank(a.type) - leaderRank(b.type));
  return { leaders, altLeaders };
}

function buildBreakthrough(info: FactionInfo, bundle: FactionBundle, player?: FactionPlayer) {
  const id = player?.breakthrough?.breakthroughId ?? info.breakthrough;
  const breakthrough = id ? bundle.breakthroughs[id] : undefined;
  if (!breakthrough) return undefined;
  const p = player?.breakthrough;
  if (!p) return { breakthrough };
  const state = !p.unlocked ? "locked" : p.exhausted ? "exhausted" : "unlocked";
  return { breakthrough, state } satisfies BreakthroughEntry;
}

/** Everything a faction sheet shows, resolved against the bundle and (optionally) one player's live state. */
export function buildFactionSheet(
  alias: string,
  bundle: FactionBundle,
  player?: FactionPlayer,
): FactionSheetModel | undefined {
  const info = bundle.factions[alias];
  if (!info) return undefined;
  const abilityIds = player?.abilities?.length ? player.abilities : (info.abilities ?? []);
  return {
    info,
    name: info.factionName,
    sourceLabel: sourceLabel(info.source),
    commodities: player?.commoditiesTotal ?? info.commodities,
    abilities: abilityIds.map((id) => bundle.abilities[id] ?? { id, name: id, missing: true as const }),
    homePlanets: (info.homePlanets ?? []).map((id) => bundle.planets[id]).filter(defined),
    startingTech: (info.startingTech ?? []).map((id) => bundle.techs[id]).filter(defined),
    startingTechChoices: (info.startingTechOptions ?? []).map((id) => bundle.techs[id]).filter(defined),
    ...buildUnits(info, bundle, player),
    ...buildTechs(info, bundle, player),
    ...buildLeaders(info, bundle, player),
    promissoryNotes: (info.promissoryNotes ?? []).map((id) => bundle.pns[id]).filter(defined),
    breakthrough: buildBreakthrough(info, bundle, player),
  };
}

/**
 * Finds the unit a token stands for: an exact unit id, or a base type / map token id ("fs", "mech") resolved to
 * this faction's version, preferring the upgraded card when `owned` includes it.
 */
export function resolveUnit(
  unitId: string,
  bundle: FactionBundle | undefined,
  faction: string | undefined,
  baseTypeOf: (id: string) => string,
  owned?: string[],
): FactionUnit | undefined {
  if (!bundle) return undefined;
  const exact = bundle.units[unitId];
  if (exact && (!faction || exact.faction || !bundle.factions[faction])) return exact;
  const baseType = exact?.baseType ?? baseTypeOf(unitId);
  const info = faction ? bundle.factions[faction] : undefined;
  const pool = unique([...(owned ?? []), ...(info?.units ?? [])]).map((id) => bundle.units[id]).filter(defined);
  const match = pool.find((u) => u.baseType === baseType);
  if (!match) return exact ?? Object.values(bundle.units).find((u) => !u.faction && u.baseType === baseType && !u.upgradesFromUnitId);
  const upgraded = match.upgradesToUnitId && owned?.includes(match.upgradesToUnitId) ? bundle.units[match.upgradesToUnitId] : undefined;
  return upgraded ?? match;
}
