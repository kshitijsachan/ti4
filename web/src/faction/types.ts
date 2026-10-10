/** Slimmed bot data for faction reference sheets (see dev/gen-faction-data.mjs). */

export type FactionUnit = {
  id: string;
  baseType: string;
  asyncId: string;
  name: string;
  subtitle?: string;
  source: string;
  faction?: string;
  upgradesFromUnitId?: string;
  upgradesToUnitId?: string;
  requiredTechId?: string;
  cost?: number;
  combatHitsOn?: number;
  combatDieCount?: number;
  moveValue?: number;
  capacityValue?: number;
  productionValue?: number | string;
  basicProduction?: string;
  afbHitsOn?: number;
  afbDieCount?: number;
  bombardHitsOn?: number;
  bombardDieCount?: number;
  spaceCannonHitsOn?: number;
  spaceCannonDieCount?: number;
  deepSpaceCannon?: boolean;
  sustainDamage?: boolean;
  planetaryShield?: boolean;
  disablesPlanetaryShield?: boolean;
  isShip?: boolean;
  isGroundForce?: boolean;
  isStructure?: boolean;
  fleetSupplyBonus?: number;
  ability?: string;
  homebrewReplacesID?: string;
};

export type FactionLeader = {
  id: string;
  faction: string;
  type: string;
  name: string;
  title?: string;
  abilityName?: string;
  abilityWindow?: string;
  abilityText?: string;
  unlockCondition?: string;
  source: string;
  homebrewReplacesID?: string;
};

export type FactionAbility = {
  id: string;
  name: string;
  faction?: string;
  permanentEffect?: string;
  window?: string;
  windowEffect?: string;
  source: string;
};

export type FactionTech = {
  alias: string;
  name: string;
  types: string[];
  requirements?: string;
  faction?: string;
  baseUpgrade?: string;
  text: string;
  source: string;
  homebrewReplacesID?: string;
};

export type FactionPromissory = {
  alias: string;
  name: string;
  faction?: string;
  playArea?: boolean;
  text: string;
  source: string;
};

export type FactionBreakthrough = {
  alias: string;
  name: string;
  faction: string;
  synergy?: string[];
  text: string;
  source: string;
};

export type FactionPlanet = {
  id: string;
  name: string;
  resources: number;
  influence: number;
  techSpecialties?: string[];
  legendaryAbilityName?: string;
  legendaryAbilityText?: string;
};

export type FactionInfo = {
  alias: string;
  factionName: string;
  shortName?: string;
  source: string;
  commodities?: number;
  homeSystem?: string;
  homeTileImage?: string;
  homePlanets?: string[];
  startingFleet?: string;
  startingTech?: string[];
  startingTechOptions?: string[];
  startingTechAmount?: number;
  complexity?: string;
  abilities?: string[];
  leaders?: string[];
  promissoryNotes?: string[];
  factionTech?: string[];
  units: string[];
  wikiURL?: string;
  /** Same-faction entries not on the default sheet: alternate versions, breakthrough units, Codex/TE replacements. */
  extraUnits: string[];
  extraLeaders: string[];
  extraTechs: string[];
  breakthrough?: string;
};

export type FactionBundle = {
  factions: Record<string, FactionInfo>;
  units: Record<string, FactionUnit>;
  leaders: Record<string, FactionLeader>;
  abilities: Record<string, FactionAbility>;
  techs: Record<string, FactionTech>;
  pns: Record<string, FactionPromissory>;
  breakthroughs: Record<string, FactionBreakthrough>;
  planets: Record<string, FactionPlanet>;
};

/** The parts of the bot's per-player web-data the sheet reads (structurally compatible with PlayerData). */
export type FactionPlayer = {
  faction: string;
  color?: string;
  unitsOwned?: string[];
  techs?: string[];
  exhaustedTechs?: string[];
  factionTechs?: string[];
  notResearchedFactionTechs?: string[];
  leaders?: { id: string; type: string; locked: boolean; exhausted: boolean; active?: boolean; tgCount?: number }[];
  leaderIDs?: string[];
  abilities?: string[];
  breakthrough?: { breakthroughId: string; unlocked: boolean; exhausted: boolean; tradeGoodsStored?: number };
  commoditiesTotal?: number;
};
