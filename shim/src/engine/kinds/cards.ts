/**
 * G8 — action cards and promissory notes. Mirrors bot ti4/selfhost/engine/kinds/{ActionCard*,PromissoryNote*}Kind.java.
 * Ids only (card ids, numeric hand handles, factions, planet ids, tile positions); never labels.
 */
import type { DecisionBase, FactionId } from "../types.js";

/** Hand tray (cards-info thread) and the action/combat subsets: play the card with this hand handle. */
export type ActionCardPlay = DecisionBase<
  "action_card.play",
  {
    handle: number;
    actionCard: string;
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
    actionCard: string | null;
    cardName: string | null;
    /** Faction that played the card. */
    playedBy: FactionId | null;
  }
>;

export type ActionCardDiscard = DecisionBase<
  "action_card.discard",
  {
    handle: number;
    actionCard: string;
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

/**
 * "Resolve <card>" right after playing it. step = engine handler id naming the card's automation; actionCard = the
 * card being resolved (the most recently discarded card with that automation), automation = its automationID.
 */
export type ActionCardResolve = DecisionBase<
  "action_card.resolve",
  { step: string; actionCard?: string | null; automation?: string | null }
>;

/** Target steps of a card's resolution. Only fields present in the option id are set. */
export type ActionCardTarget = DecisionBase<
  "action_card.target",
  {
    step: string;
    player?: FactionId;
    planet?: string;
    /** Tile position. */
    system?: string;
    holder?: "space";
    strategyCard?: number;
    /** The card being resolved. */
    actionCard?: string | null;
  }
>;

/**
 * Any other follow-up step of a card's resolution (scuttle / lucky shot / counterstroke / Thunder's Edge cards /
 * homebrew decks). Typed from the option id's tokens; args = remaining raw id tokens (ids, not labels).
 */
export type ActionCardStep = DecisionBase<
  "action_card.step",
  {
    step: string;
    /** The card being resolved (null when the engine cannot tell). */
    actionCard: string | null;
    /** "done" = finish / cancel / decline this step; "choose" = a choice that moves the card on. */
    role: "choose" | "done";
    player?: FactionId;
    players?: FactionId[];
    planet?: string;
    system?: string;
    holder?: "space";
    unit?: string;
    damaged?: boolean;
    tech?: string;
    /** An action card id named by the option (e.g. the card to take from the discard). */
    actionCardRef?: string;
    promissoryNote?: string;
    count?: number;
    args?: string[];
  }
>;

/**
 * Non-queued agenda "when" / "after" windows (actions channel). scope "table", window kind "when" | "after"
 * (responded = reacted on the message or passed for the whole agenda).
 */
export type ActionCardWhenAfter = DecisionBase<
  "action_card.when_after",
  { timing: "when" | "after"; action: "play" | "pass" | "pass_agenda"; rider?: string }
>;

/** Promissory-note steps outside the hand tray (Acquiescence follow, Malevolency pass, ...). */
export type PromissoryNoteResolve = DecisionBase<
  "promissory_note.resolve",
  { promissoryNote: string; step: string; strategyCard?: number; player?: FactionId; planet?: string }
>;

/** Play a promissory note (hand tray, or "this is the window to play X" offers with a Decline). */
export type PromissoryNotePlay = DecisionBase<
  "promissory_note.play",
  {
    promissoryNote: string;
    /** Faction owning the note. */
    owner: FactionId | null;
    /** Goes to the player's play area (Alliance, Support for the Throne, ...) instead of back to the owner. */
    playArea: boolean;
    /** false for Black Market Forgery played as a component action. */
    fromHand: boolean;
    /** Research Agreement: the technology gained. */
    tech?: string;
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
  | ActionCardStep
  | ActionCardWhenAfter
  | PromissoryNotePlay
  | PromissoryNoteResolve;

/** Pre-play an action card for a later window (resolvePreassignment_<what>[_<target>]); agenda ones are agenda.preassign. */
export type ActionCardPreassign = DecisionBase<"action_card.preassign", { preassignment: string; target: string | null }>;
