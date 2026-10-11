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

export type ThundersEdgeDecision = TeFractureRoll | TeFractureIngress | TeGalvanize | TeExpedition | TePlaceThundersEdge | TeVisionaria;

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
