/**
 * Thunder's Edge decision kinds (G10). Mirrors bot ti4.selfhost.engine.kinds.Te*Kind 1:1.
 * Dependency-free (imported by the web too).
 */
import type { BreakthroughId, DecisionBase, FactionId, HolderName, TileId, TilePosition, UnitId } from "../types.js";

/** Roll for The Fracture after a breakthrough unlock (rollFracture_<bt>); spawn: Al'Raith / Styx and Stones bring it in without a roll. */
export type TeFractureRoll = DecisionBase<"te.fracture.roll", { breakthrough: BreakthroughId | null; spawn: boolean; canEnterPlay: boolean }>;

/**
 * Place an ingress token (addIngressToken_<pos>_<perType>), one prompt per technology type; "Done Resolving" has
 * value null. progress.accumulated.placed / progress.required.remaining say how many this prompt still places.
 */
export type TeFractureIngress = DecisionBase<
  "te.fracture.ingress",
  { position: TilePosition; tileId: TileId | null; skips: string[]; hasIngress: boolean; perType: number }
>;

export type TeGalvanizeValue =
  | { action: "galvanize" | "ungalvanize"; position: TilePosition; unit: UnitId; holder: HolderName }
  | { action: "system"; position: TilePosition };

/**
 * Galvanize menu (galvanize_ / ungalvanize_ per unit, edited in place; toggleGalvanize_ = pick the system first).
 * progress.required.mandatory: the Bastion agent forces one galvanize; progress.accumulated.galvanized: net units
 * galvanized since the menu opened. "Done Galvanizing Units" has value null.
 */
export type TeGalvanize = DecisionBase<"te.galvanize", TeGalvanizeValue>;

export type ExpeditionKey = "techSkip" | "tradeGoods" | "fiveRes" | "fiveInf" | "secret" | "actionCards";

/** Complete an open expedition (TEexpedition_<key>); "Delete These Buttons" has value null. */
export type TeExpedition = DecisionBase<
  "te.expedition",
  { expedition: ExpeditionKey; affordable: boolean; unlocksBreakthrough: boolean; remaining: number }
>;

export type TePlaceThundersEdgeValue =
  | { step: "start" }
  | { step: "system"; position: TilePosition; tileId: TileId | null }
  | { step: "infantry"; position: TilePosition; tileId: TileId | null; faction: FactionId };

/** The last expedition's completer places Thunder's Edge: start → system → whose infantry goes on it. */
export type TePlaceThundersEdge = DecisionBase<"te.thunders_edge.place", TePlaceThundersEdgeValue>;

/**
 * Deepwrought's Visionaria Select: a reaction window (window.kind "visionaria", subject.owner = Deepwrought's user).
 * Others respond (research / give_promissory / decline); the owner may preset how the turn moves on.
 */
export type TeVisionaria = DecisionBase<
  "te.visionaria.respond",
  { choice: "research" | "give_promissory" | "decline" | "wait_for_all" | "end_turn_after_all"; respondent: boolean }
>;

/**
 * Fields of the table-driven TE kinds (c5: te.breakthrough / te.breach / te.plot; bot TeStepTable). Only fields present
 * in the option id are set; ids only, never labels.
 */
export type TeStepFields = {
  /** Faction the component belongs to (null for breakthroughs without one, e.g. Stone Embrace). */
  faction: string | null;
  /** Engine step (handler prefix without the trailing "_"), e.g. "placeVoidTether", "deorbitBarrageTarget". */
  step: string;
  /** use = start / accept an optional effect; target = a choice inside an effect under way; skip = back out / finish. */
  action: "use" | "target" | "skip" | "undo";
  /** The effect may be declined (a Decline/Done option is offered, or this is an offer). */
  optional: boolean;
  /** Tile positions. */
  tile?: string;
  to?: string;
  from?: string;
  planet?: string;
  /** "space" or a planet id. */
  holder?: string;
  unit?: string;
  /** Another player (faction id). */
  target?: string;
  amount?: number;
  /** Void Tether: adjacency direction index. */
  dir?: string;
  tech?: string;
  card?: string;
  /** Step-specific raw choice (e.g. "top"/"bottom", a leader id, an SC number). */
  choice?: string;
  /** Raw id segments the kind does not type further. */
  args?: string[];
};

/**
 * Using a Thunder's Edge breakthrough through its prompts: Void Tether, Deorbit Barrage, Thunder's Paradox, The Sowing /
 * The Reaping, The Icon, Data Skimmer, Mindsieve, Stone Embrace, Al'Raith, Vaults of the Heir, Fealty Uplink,
 * Psychospore, Stellar Genesis, Valefar Assimilator Z, Deepgloom Executable, Eidolon Maximum, Executive Order.
 */
export type TeBreakthrough = DecisionBase<"te.breakthrough", TeStepFields & { breakthrough: string }>;

/** Breaches: flip on activation (Incursion), remove (Incursion / status phase), place (Resonance Generator, Exile). */
export type TeBreach = DecisionBase<"te.breach", TeStepFields & { source: "incursion" | "crimsonbt" | string }>;

/**
 * Plot cards (Firmament / Obsidian). panel = the cards-info bookkeeping panel (background: nobody waits on it); the
 * faction picker after a press, and the Obsidian reveals (Seethe → planet, Extract) are real steps.
 */
export type TePlot = DecisionBase<
  "te.plot",
  TeStepFields & { ability: "plotsplots" | "marionettes" | string; plot?: string; panel: boolean; puppets?: string[]; page?: string }
>;

export type ThundersEdgeDecision =
  | TeFractureRoll
  | TeFractureIngress
  | TeGalvanize
  | TeExpedition
  | TePlaceThundersEdge
  | TeVisionaria
  | TeBreakthrough
  | TeBreach
  | TePlot;

// ---- state (GameState.thundersEdge)

export interface BreakthroughState {
  id: BreakthroughId;
  unlocked: boolean;
  exhausted: boolean;
  active: boolean;
  tradeGoods: number;
}

export interface ThundersEdgeState {
  fractureInPlay: boolean;
  thundersEdgeInPlay: boolean;
  /** Expedition key → faction that completed it, null while open. */
  expeditions: Partial<Record<ExpeditionKey, FactionId | null>>;
  /** Faction → its breakthroughs. */
  breakthroughs: Partial<Record<FactionId, BreakthroughState[]>>;
}

/** Ingress token id on a system's space area (TileState holder "space" tokens). */
export const INGRESS_TOKEN = "token_ingress.png";
