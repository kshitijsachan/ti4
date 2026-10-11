/**
 * G11 trade / transactions. Mirrors bot ti4.selfhost.engine.TradeEngine (state + trade.propose action),
 * kinds/TradeOfferKind, TradeOfferSentKind, TradeForceReplenishKind and spring/api/selfhost/TradeModels.
 */
import type { DecisionBase, FactionId, UserId } from "../types.js";
import type { FragmentCounts } from "./explore.js";

// ---------------------------------------------------------------- shared shapes (TradeModels.java)

/** A promissory note (ownerFaction set), action card or relic. */
export type CardRef = { id: string; name: string; text?: string | null; ownerFaction?: string | null; ownerColor?: string | null };

export type FragmentTrait = "cultural" | "industrial" | "hazardous" | "frontier";

export type TradeSelf = {
  userId: UserId;
  userName: string;
  faction: FactionId;
  color: string;
  tg: number;
  commodities: number;
  commoditiesTotal: number;
  /** False with Military Industrial Complex. */
  canSendCommodities: boolean;
  promissoryNotes: CardRef[];
  actionCards: CardRef[];
  fragments: FragmentCounts;
  relics: CardRef[];
  icon?: string | null;
};

export type TradeCounterparty = {
  userId: UserId;
  userName: string;
  faction: FactionId;
  color: string;
  /** The bot's own check (Censure, Policy - The People: Control; anyone outside the action phase). */
  canTrade: boolean;
  neighbor: boolean;
  reason?: string | null;
  tg: number;
  commodities: number;
  commoditiesTotal: number;
  canSendCommodities: boolean;
  pnCount: number;
  acCount: number;
  fragments: FragmentCounts;
  requestablePromissoryNotes: CardRef[];
  relics: CardRef[];
  /** One of you has Arbiters (Hacan) or Guild Ships breakthrough. */
  canTradeActionCards: boolean;
  debtIHold: number;
  debtTheyHold: number;
  excludedGivePromissoryNotes: string[];
  icon?: string | null;
};

export type TradeItemKind = "tg" | "commodities" | "pn" | "pnAny" | "ac" | "acAny" | "fragment" | "relic" | "sendDebt" | "clearDebt" | "note" | "other";

/** One line of an offer. from/to are factions; id = card id / fragment trait / relic id. label is display only. */
export type TradeItem = { from: FactionId; to: FactionId; kind: TradeItemKind; amount: number; id?: string | null; label: string; raw: string };

// ---------------------------------------------------------------- state: GameState.trade

export type OpenOffer = {
  from: FactionId;
  to: FactionId;
  offerNumber: number;
  items: TradeItem[];
  /** The receiver's trade.offer decision (private to them). */
  decisionId: string;
};

/** The viewer's trade view. */
export type TradeState = {
  phase: string;
  /** Non-null: the viewer cannot propose anything now (fog of war, Hidden Agenda, …). */
  blockedReason: string | null;
  newTransactionModel: boolean;
  me: TradeSelf;
  partners: TradeCounterparty[];
  /** Factions the viewer may transact with now: neighbours, anyone in the agenda phase, or an ability that allows it. */
  mayTransactWith: FactionId[];
  /** Open, current offers to the viewer. */
  incoming: OpenOffer[];
  /** Open, current offers from the viewer. */
  outgoing: OpenOffer[];
};

// ---------------------------------------------------------------- decisions

/**
 * An offer to the target. Options: accept / reject (typed), "Reject and CounterOffer" (value null: counter = reject +
 * trade.propose). Every typed option carries the whole offer.
 */
export type TradeOfferValue = {
  action: "accept" | "reject";
  from: FactionId;
  fromUserId: UserId;
  to: FactionId | null;
  /** Only on accept. */
  offerNumber: number | null;
  blackMarket: boolean;
  items: TradeItem[];
  /** At capture: newest offer from that sender with items still there. Accepting a stale one is refused. */
  current: boolean;
};
export type TradeOffer = DecisionBase<"trade.offer", TradeOfferValue>;

/** The sender's copy (Rescind). Stays up after accept/reject: whether it is still open is GameState.trade.outgoing. */
export type TradeOfferSent = DecisionBase<"trade.offer_sent", { action: "rescind"; to: FactionId; toUserId: UserId; items: TradeItem[] }>;

/** Trade primary: replenish another player's commodities for free. Target: the Trade holder. "Done" is untyped. */
export type TradeForceReplenish = DecisionBase<
  "trade.force_replenish",
  { faction: FactionId; userId: UserId; commodities: number; commoditiesMax: number; neighbor: boolean }
>;

// ---------------------------------------------------------------- action: trade.propose

/** One side of an offer. */
export type TradeSide = {
  tg?: number;
  commodities?: number;
  /** PN ids (max 1). On the receive side "any" asks for a PN of their choice. */
  promissoryNotes?: string[];
  /** Give side only. */
  actionCards?: string[];
  /** Receive side only: number of action cards they pick. */
  actionCardCount?: number;
  fragments?: Partial<FragmentCounts>;
  relics?: string[];
  sendDebt?: number;
  clearDebt?: number;
};

/**
 * POST /api/public/selfhost/engine/{g}/actions/trade.propose (Bot; userId required) or
 * POST /api/game/{g}/engine/actions/trade.propose (seat Bearer). Replaces an open offer to the same player.
 */
export type TradeProposal = { userId?: UserId; to: FactionId; give: TradeSide; receive: TradeSide; note?: string };

export type TradeProposeResult = {
  ok: boolean;
  status: "done" | "refused" | "forbidden" | "not_found" | "error";
  error: string | null;
  offerNumber: number | null;
  to: FactionId | null;
  items: TradeItem[];
  seq: number;
  stateVersion: number;
};
