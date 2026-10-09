/** Mirrors ti4.spring.api.selfhost.DraftViewModels (GET /bot/api/public/game/{game}/draft). */

export type DraftChoice = {
  key: string;
  label: string;
  /** Discord custom_id of the bot button that makes this pick. */
  customId: string | null;
  channelId: string | null;
  /** Message carrying the button, or null when the bot couldn't find it in recent history. */
  messageId: string | null;
  /** userId of the player who took it. */
  pickedBy: string | null;
};

export type DraftPick = { type: string; key: string; label: string };

export type DraftPlayer = {
  userId: string;
  name: string;
  color: string | null;
  draftPosition: number;
  faction: string | null;
  slice: string | null;
  speakerOrder: number | null;
  seat: number | null;
  picks: DraftPick[];
  current: boolean;
  next: boolean;
};

export type DraftPlanet = {
  id: string;
  name: string;
  resources: number;
  influence: number;
  traits: string[];
  techSpecialties: string[];
  legendary: boolean;
  legendaryAbility: string | null;
  legendaryText: string | null;
  station: boolean;
};

export type DraftTile = {
  id: string;
  name: string;
  tier: string | null;
  image: string;
  resources: number;
  influence: number;
  wormholes: string[];
  anomalies: string[];
  planets: DraftPlanet[];
};

export type SliceTotals = {
  resources: number;
  influence: number;
  optimalResources: number;
  optimalInfluence: number;
  optimalFlex: number;
  optimalTotal: number;
  planets: number;
  legendaries: number;
  anomalies: number;
  techSkips: string[];
  wormholes: string[];
};

export type DraftSlice = {
  name: string;
  tiles: DraftTile[];
  totals: SliceTotals;
  choice: DraftChoice;
};

export type DraftFaction = {
  alias: string;
  name: string;
  shortName: string;
  icon: string | null;
  source: string | null;
  commodities: number;
  complexity: string | null;
  homeSystem: string | null;
  homeSystemImage: string | null;
  homePlanets: DraftPlanet[];
  abilities: string[];
  factionTech: string[];
  startingTech: string[];
  choice: DraftChoice;
};

export type DraftOrderOption = {
  number: number;
  label: string;
  icon: string | null;
  choice: DraftChoice;
};

export type DraftCategory = {
  type: string;
  label: string;
  choices: DraftChoice[];
};

export type TemplatePosition = {
  pos: string;
  x: number;
  y: number;
  playerNumber: number | null;
  miltyTileIndex: number | null;
  home: boolean;
  staticTileId: string | null;
  tileId: string | null;
  image: string | null;
};

export type MapTemplate = {
  alias: string;
  description: string | null;
  playerCount: number | null;
  tileWidth: number;
  tileHeight: number;
  /** [0] is the home system, [i + 1] is where slice tile i sits. */
  sliceLayout: { x: number; y: number }[];
  positions: TemplatePosition[];
};

export type DraftState = {
  game: string;
  system: "milty" | "draft" | null;
  status: "none" | "drafting" | "finished";
  phase: string | null;
  version: number;
  channelId: string | null;
  players: DraftPlayer[];
  /** userId for every pick slot, in order (snake). */
  pickOrder: string[];
  pickIndex: number;
  currentPlayer: string | null;
  nextPlayer: string | null;
  slices: DraftSlice[];
  factions: DraftFaction[];
  speakerOrder: DraftOrderOption[];
  seats: DraftOrderOption[];
  otherCategories: DraftCategory[];
  mapTemplate: MapTemplate | null;
  icons: { glyphs: Record<string, string> };
};

/** "slice" | "faction" | "speakerOrder" | "seat", or another draftable type name. */
export type PickCategory = string;

/**
 * Presses the bot button that makes a pick. Resolve when the bot acknowledged it; reject (or resolve with
 * `{ error }`) to have the view show the failure.
 */
export type DraftPickHandler = (
  customId: string,
  channelId: string,
  messageId: string,
) => Promise<unknown> | void;
