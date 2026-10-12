/**
 * G8 — action cards and promissory notes. Mirrors bot ti4/selfhost/engine/kinds/{ActionCard*,PromissoryNote*}Kind.java.
 * Ids only (card ids, numeric hand handles, factions, planet ids, tile positions); never labels.
 */
import type {
  ActionCardId,
  DecisionBase,
  FactionId,
  PlanetId,
  PromissoryNoteId,
  StrategyCardNumber,
  TechId,
  TilePosition,
} from "../types.js";

/** Hand tray (cards-info thread) and the action/combat subsets: play the card with this hand handle. */
export type ActionCardPlay = DecisionBase<
  "action_card.play",
  {
    handle: number;
    actionCard: ActionCardId;
    /** The card's timing window as the engine words it ("Action", "After you activate a system", ...). */
    window: string | null;
  }
>;

/**
 * The window after a card is played. Public window: scope "table", `decision.window` = { kind: "sabotage",
 * subject: { actionCard, cardName, player, faction }, eligible, responded, responses }. Private offers (Watcher,
 * Triune, Instinct Training) in a cards-info thread: scope "player", no window, plus an untyped "Delete" option.
 */
export type ActionCardSabotage = DecisionBase<
  "action_card.sabotage",
  {
    /** cancel = cancel the card; pass = "No Sabotage"; wait = the player's own "pause timer" (legacy only). */
    action: "cancel" | "pass" | "wait";
    via: "ac" | "empy" | "tf" | "xxcha" | null;
    actionCard: ActionCardId | null;
    cardName: string | null;
    /** Faction that played the card. */
    playedBy: FactionId | null;
  }
>;

export type ActionCardDiscard = DecisionBase<
  "action_card.discard",
  {
    handle: number;
    actionCard: ActionCardId;
    /** "" plain, "stall" = discard as your action, "redraw" = draw a replacement, "retain", "arvaxicommander". */
    mode: string;
    /** As of capture; compare handLimit with the live PlayerState.actionCardCount. */
    overLimit: boolean;
    handLimit: number;
    /** "scheming": the Yssaril Scheming discard (owed regardless of the hand limit). */
    reason: "hand" | "scheming";
  }
>;

export type ActionCardDraw = DecisionBase<"action_card.draw", { count: number; upTo: boolean }>;

/** "Resolve <card>" right after playing it. step = engine handler id naming the card's automation. */
export type ActionCardResolve = DecisionBase<"action_card.resolve", { step: string }>;

/** Target steps of a card's resolution. Only fields present in the option id are set. */
export type ActionCardTarget = DecisionBase<
  "action_card.target",
  {
    step: string;
    player?: FactionId;
    planet?: PlanetId;
    /** Tile position. */
    system?: TilePosition;
    holder?: "space";
    strategyCard?: StrategyCardNumber;
  }
>;

/** Play a promissory note (hand tray, or "this is the window to play X" offers with a Decline). */
export type PromissoryNotePlay = DecisionBase<
  "promissory_note.play",
  {
    promissoryNote: PromissoryNoteId;
    /** Faction owning the note. */
    owner: FactionId | null;
    /** Goes to the player's play area (Alliance, Support for the Throne, ...) instead of back to the owner. */
    playArea: boolean;
    /** false for Black Market Forgery played as a component action. */
    fromHand: boolean;
    /** Research Agreement: the technology gained. */
    tech?: TechId;
  }
>;

export type CardsDecision =
  | ActionCardPlay
  | ActionCardSabotage
  | ActionCardDiscard
  | ActionCardDraw
  | ActionCardResolve
  | ActionCardTarget
  | ActionCardPreassign
  | PromissoryNotePlay;

/** Pre-play an action card for a later window (resolvePreassignment_<what>[_<target>]); agenda ones are agenda.preassign. */
export type ActionCardPreassign = DecisionBase<"action_card.preassign", { preassignment: string; target: string | null }>;
