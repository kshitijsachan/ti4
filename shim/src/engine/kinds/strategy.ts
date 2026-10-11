/**
 * G2 strategy-card decision kinds (mirror of the bot's ti4.selfhost.engine.kinds.*: StrategyCardResolveKind,
 * StrategyCardQueuePickKind, StrategicActionKind, DiplomacySystemKind, PlanetReadyKind, PoliticsSpeakerKind,
 * PoliticsAgendaKind, ConstructionPlaceKind). Values carry ids
 * (card numbers, faction ids, planet ids, tile positions, amounts), never labels.
 */
import type { DecisionBaseOf } from "../types.js";

/** Card automation id as the engine resolves it: "pok1leadership" … "pok8imperial", "te4construction", … */
export type CardId = string;

/** Who may press an option of a played card's message. */
export type ScWho = "holder" | "others" | "anyone";

/** The holder's primary checklist entries (StrategyCardResolveKind.primaryParts). */
export type PrimaryPart =
  | "tokens"
  | "system"
  | "ready_planets"
  | "speaker"
  | "action_cards"
  | "agendas"
  | "structure"
  | "produce"
  | "warfare_primary"
  | "research"
  | "score_public"
  | "imperial";

export type ScAction =
  | "follow"
  | "decline"
  | "request_all"
  | "leadership_tokens"
  | "diplomacy_system"
  | "ready_planets"
  | "draw_action_cards"
  | "construction_structure"
  | "construction_produce"
  | "replenish_free"
  | "replenish_and_wash_free"
  | "warfare_primary"
  | "warfare_produce"
  | "research"
  | "draw_secret"
  | "score_imperial"
  | "score_public";

/**
 * A played strategy card: one table message with the holder's primary buttons and everyone else's follow /
 * secondary / decline buttons. window.kind = "strategy_card", window.subject = {strategyCard, name, card, holder},
 * window.responses: userId → "holder" | "pending" | "followed" | "declined". copy = the same buttons re-posted in
 * the card's thread (answer one of the two).
 */
export type StrategyCardResolve = DecisionBaseOf<
  "strategy_card.resolve",
  {
    strategyCard: number;
    name: string;
    card: CardId | null;
    /** Holder's faction. */
    holder: string | null;
    action: ScAction;
    who: ScWho;
    /** A non-holder pays a strategy token for it (the first such press follows the card). */
    spendsToken: boolean;
    /** The holder's primary part this option resolves (null: not part of the primary). */
    part: PrimaryPart | null;
    /** The whole primary checklist of the card; "structure" twice = two structures (Construction). */
    primaryParts: PrimaryPart[];
    /** construction_structure: "spacedock" | "pds" | "facility" | "monument" | "agesmonument". */
    unit?: string;
    /** research: resources a follower pays (the holder's first technology is free). */
    followCost?: number;
    copy: boolean;
  }
>;

export type StrategyCardQueuePick = DecisionBaseOf<
  "strategy_card.queue_pick",
  | { strategyCard: number; name: string; card: CardId | null; tradeGoods: number; queued: number[]; restart?: undefined }
  | { restart: true; queued: number[]; strategyCard?: undefined }
>;

export type StrategicAction = DecisionBaseOf<
  "strategy_card.strategic_action",
  { action: "strategic"; strategyCard: number; name: string; card: CardId | null }
>;

export type DiplomacySystem = DecisionBaseOf<
  "strategy_card.diplomacy_system",
  { tile: string | null; planet: string | null; mahact: boolean; planets: string[]; resources: number; influence: number; home: boolean }
>;

export type PlanetReady = DecisionBaseOf<
  "planet.ready",
  | { planet: string; resources: number; influence: number; done?: undefined }
  | { done: true; source: "diplomacy" | string; limit: number; planet?: undefined }
>;

export type PoliticsSpeaker = DecisionBaseOf<"strategy_card.politics_speaker", { faction: string; color: string | null; self: boolean }>;

export type PoliticsAgenda = DecisionBaseOf<
  "strategy_card.politics_agenda",
  | { action: "draw"; count: number }
  | { action: "top" | "bottom" | "discard"; handle: number; agenda: string | null; placedThisRound: number }
>;

export type ConstructionPlace = DecisionBaseOf<
  "strategy_card.construction_place",
  {
    unit: "pds" | "spacedock";
    planet: string;
    tile: string | null;
    home: boolean;
    resources: number;
    influence: number;
    /** Already on that planet (yours). */
    pds: number;
    spaceDock: number;
  }
>;

export type StrategyDecision =
  | StrategyCardResolve
  | StrategyCardQueuePick
  | StrategicAction
  | DiplomacySystem
  | PlanetReady
  | PoliticsSpeaker
  | PoliticsAgenda
  | ConstructionPlace;

export const STRATEGY_KINDS = [
  "strategy_card.resolve",
  "strategy_card.queue_pick",
  "strategy_card.strategic_action",
  "strategy_card.diplomacy_system",
  "planet.ready",
  "strategy_card.politics_speaker",
  "strategy_card.politics_agenda",
  "strategy_card.construction_place",
] as const;
