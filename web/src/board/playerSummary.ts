import type { PlayerData } from "@/entities/data/types";
import { getFactionImage } from "@/entities/lookup/factions";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import {
  getTechData,
  partitionGenericTechs,
  TECH_TYPE_COLOR,
  type TechColor,
} from "@/entities/lookup/tech";
import { getPlayerFactionDisplayName } from "@/entities/game/playerUtils";
import { SC_COLORS, SC_NAMES } from "@/entities/data/strategyCardColors";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";

export type LeaderState = "ready" | "exhausted" | "locked" | "gone";

export type PlayerSummary = {
  key: string;
  name: string;
  faction: string;
  factionName: string;
  factionImage?: string;
  color: string;
  vp: number;
  active: boolean;
  passed: boolean;
  speaker: boolean;
  eliminated: boolean;
  strategyCards: { initiative: number; name: string; color: string; played: boolean }[];
  tg: number;
  commodities: number;
  commoditiesMax: number;
  tactic: number;
  fleet: number;
  strategy: number;
  planets: number;
  resources: number;
  resourcesTotal: number;
  influence: number;
  influenceTotal: number;
  techs: Record<TechColor | "unit", number>;
  relics: number;
  fragments: number;
  leaders: { agent: LeaderState; commander: LeaderState; hero: LeaderState };
  actionCards: number;
  secrets: number;
  promissory: number;
};

function leaderState(player: PlayerData, type: string): LeaderState {
  const leader = player.leaders?.find((l) => l.type === type);
  if (!leader) return "gone";
  if (leader.locked) return "locked";
  if (leader.exhausted) return "exhausted";
  return "ready";
}

function countTechs(techs: string[]) {
  const counts: PlayerSummary["techs"] = { blue: 0, green: 0, red: 0, yellow: 0, unit: 0 };
  for (const id of partitionGenericTechs(techs).standardTechs) {
    const type = getTechData(id)?.types?.[0] ?? "";
    const color = TECH_TYPE_COLOR[type];
    if (color) counts[color] += 1;
    else if (type === "UNITUPGRADE") counts.unit += 1;
  }
  return counts;
}

/** Everything a compact player board shows, from the bot's web-data. */
export function summarizePlayer(
  player: PlayerData,
  strategyCardIdMap?: Record<number, string>,
): PlayerSummary {
  const fragments = (player.crf ?? 0) + (player.hrf ?? 0) + (player.irf ?? 0) + (player.urf ?? 0);
  return {
    key: player.color,
    name: player.userName,
    faction: player.faction,
    factionName: getPlayerFactionDisplayName(player),
    factionImage: getFactionImage(player.faction, player.factionImage, player.factionImageType),
    color: getPrimaryColorCSS(player.color),
    vp: player.totalVps ?? 0,
    active: player.active,
    passed: player.passed,
    speaker: player.isSpeaker,
    eliminated: player.eliminated,
    strategyCards: (player.scs ?? []).map((initiative) => ({
      initiative,
      name:
        getStrategyCardByInitiative(initiative, strategyCardIdMap)?.name ??
        SC_NAMES[initiative] ??
        `Card ${initiative}`,
      color: SC_COLORS[initiative] ?? "gray",
      played: (player.exhaustedSCs ?? []).includes(initiative),
    })),
    tg: player.tg ?? 0,
    commodities: player.commodities ?? 0,
    commoditiesMax: player.commoditiesTotal ?? 0,
    tactic: player.tacticalCC ?? 0,
    fleet: (player.fleetCC ?? 0) + (player.mahactEdict?.length ?? 0),
    strategy: player.strategicCC ?? 0,
    planets: player.planets?.length ?? 0,
    resources: player.resources ?? 0,
    resourcesTotal: player.totResources ?? 0,
    influence: player.influence ?? 0,
    influenceTotal: player.totInfluence ?? 0,
    techs: countTechs(player.techs ?? []),
    relics: player.relics?.length ?? 0,
    fragments: fragments || (player.fragments?.length ?? 0),
    leaders: {
      agent: leaderState(player, "agent"),
      commander: leaderState(player, "commander"),
      hero: leaderState(player, "hero"),
    },
    actionCards: player.acCount ?? 0,
    secrets: player.soCount ?? 0,
    promissory: player.pnCount ?? 0,
  };
}
