/**
 * Exploration + relic decision kinds (G9). Mirrors bot ti4.selfhost.engine.kinds.Explore*Kind / Relic*Kind.
 * Ids only for logic (card ids, planet ids, tile positions); *Name / *Text fields come from the card data for display.
 */
import type {
  DecisionBase,
  ExploreCardId,
  FactionId,
  LeaderId,
  PlanetId,
  RelicFragmentId,
  RelicId,
  TileId,
  TilePosition,
  UserId,
} from "../types.js";

export type ExploreTrait = "cultural" | "industrial" | "hazardous" | "frontier";

/** Choose a planet (and trait) to explore. One message per planet after landing; "any of your planets" lists many. */
export type ExplorePlanet = DecisionBase<
  "explore.planet",
  {
    planet: PlanetId;
    planetName: string;
    tile: TilePosition | null;
    trait: ExploreTrait;
    /** "filler" normal, "dsdihmy" Impressment Programs (exhausts the planet), "scanlink" Lanefir flagship. */
    via: string;
    /** Bentor breakthrough: explore the frontier deck instead. */
    frontierInstead: boolean;
    /** Kollecc breakthrough: resolve from the discard. */
    fromDiscard: boolean;
  }
>;

export interface ExploreCardInfo {
  card: ExploreCardId;
  cardName?: string;
  cardType?: ExploreTrait | null;
  /** "fragment" | "attach" | "token" | "instant" | "relic" | ... (card data). */
  resolution?: string | null;
  cardText?: string;
}

/** Choose which drawn card to resolve (Distant Suns / Bozgarbia, Voidsailors frontier pick, alternative resolutions). */
export type ExploreCardPick = DecisionBase<
  "explore.card_pick",
  ExploreCardInfo & {
    planet: PlanetId | null;
    planetName?: string;
    tile: TilePosition | null;
    /** Voidsailors: the card that goes back to the deck if this one is chosen. */
    rejected: ExploreCardId | null;
    variant: "distantSuns" | "voidsailors" | string | null;
  }
>;

/** Choose a system whose frontier token to explore (Empyrean hero, Exploration Probe, Circlet of the Void). */
export type ExploreFrontier = DecisionBase<
  "explore.frontier",
  { tile: TilePosition; tileId: TileId | null; source: "empyrean_hero" | "probe_or_circlet" }
>;

export type ExploreOutcomeEffect =
  | "decline"
  | "ready_planet"
  | "gain_trade_good"
  | "gain_command_token"
  | "remove_command_token"
  | "place_units"
  | "ready_agent"
  | "draw_action_card"
  | "produce"
  | "place_mech"
  | "convert_commodities"
  | "replenish_commodities"
  | "gain_commodities"
  | "place_ion_storm"
  | "gain_trade_good_instead"
  | "draw_two_choose_one"
  | "explore";

/** How to resolve an exploration card that offers a choice. */
export type ExploreOutcome = DecisionBase<
  "explore.outcome",
  {
    effect: ExploreOutcomeEffect | string;
    /** Card family: expedition, coremine, volatilefuelsource, scorcheddepot, warforgeruins, seedyspaceport,
     * immediateassembly, freelancers, localfabricators, functioningbase, merchantstation, ionstorm (absent on
     * decline / generic commodity buttons). */
    card?: string;
    /** "mech_present" (nothing lost), "remove_infantry", "commodity_or_tg". */
    cost?: "mech_present" | "remove_infantry" | "commodity_or_tg";
    planet?: PlanetId | null;
    planetName?: string;
    tile?: TilePosition | null;
    units?: string | null;
    leader?: LeaderId | null;
    side?: "alpha" | "beta";
    amount?: number;
    /** deep_mining | distant_suns (ability offered instead of / on top of an explore). */
    ability?: string;
    trait?: ExploreTrait;
    /** Costed options only: why it cannot be chosen right now (null = it can). Re-read on every state change, so it
     * clears as soon as the player can pay; validate() refuses the option while set. Rules audit (tech/relic/explore). */
    unavailable?: string | null;
  }
>;

export interface FragmentCounts {
  cultural: number;
  industrial: number;
  hazardous: number;
  frontier: number;
}

/**
 * Purge fragments, then draw (one message, several presses). progress: {flow:"relic_fragments", step:"purge",
 * accumulated:{purged, byTrait}, required:{setSize}, canCommit}.
 */
export type RelicFragments = DecisionBase<
  "relic.fragments",
  {
    action: "purge" | "draw";
    trait?: ExploreTrait | null;
    count?: number;
    fragment?: RelicFragmentId;
    supermassive?: boolean;
    /** A New Edifice: the "draw" explores 3 planets instead. */
    explore?: boolean;
    fragmentsAtStart: FragmentCounts;
    setSize: number;
  }
>;

/** Draw a relic (relic token planet, Mysterious Brokers, ...). */
export type RelicDraw = DecisionBase<"relic.draw", { action: "draw"; relicDeck: number }>;

export type ExploreDecision = ExplorePlanet | ExploreCardPick | ExploreFrontier | ExploreOutcome | RelicFragments | RelicDraw;

// ---- state (GameState.exploration) ----

export interface ExploreEvent {
  round: number;
  userId: UserId;
  faction: FactionId | null;
  /** "explore" (card = exploration card id) or "relic" (card = relic id). */
  type: "explore" | "relic";
  card: ExploreCardId | RelicId;
  name: string | null;
  trait: ExploreTrait | null;
  resolution: string | null;
  text: string | null;
  /** null for a frontier token explore. */
  planet: PlanetId | null;
  planetName: string | null;
  tile: TilePosition | null;
  at: number;
}

export interface ExplorationState {
  decks: Record<ExploreTrait, { deck: number; discard: ExploreCardId[] }>;
  relicDeck: number;
  /** Oldest first, last 15. Fog of war: only the viewer's own. */
  recent: ExploreEvent[];
}
