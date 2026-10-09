/** Shapes of the bot's `/api/game/{game}/trade/**` endpoints (see TradeModels.java). */

export type CardRef = {
  id: string;
  name: string;
  text?: string | null;
  ownerFaction?: string | null;
  ownerColor?: string | null;
};

export type FragmentTrait = "cultural" | "industrial" | "hazardous" | "frontier";
export type FragmentCounts = Record<FragmentTrait, number>;

export type TradeSelf = {
  userId: string;
  userName: string;
  faction: string;
  color: string;
  tg: number;
  commodities: number;
  commoditiesTotal: number;
  canSendCommodities: boolean;
  promissoryNotes: CardRef[];
  actionCards: CardRef[];
  fragments: FragmentCounts;
  relics: CardRef[];
  /** Faction emoji image served by the shim (`/emojis/<id>`). */
  icon?: string | null;
};

export type TradeCounterparty = {
  userId: string;
  userName: string;
  faction: string;
  color: string;
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
  canTradeActionCards: boolean;
  /** Their debt tokens in my pool (I can clear these for them). */
  debtIHold: number;
  /** My debt tokens in their pool (they can clear these for me). */
  debtTheyHold: number;
  excludedGivePromissoryNotes: string[];
  icon?: string | null;
};

export type TradeOptions = {
  game: string;
  phase: string;
  round: number;
  newTransactionModel: boolean;
  blockedReason?: string | null;
  version: number;
  me: TradeSelf;
  counterparties: TradeCounterparty[];
};

export type TradeSide = {
  tg?: number;
  commodities?: number;
  /** PN ids. On the receive side, `"any"` asks for a PN of their choice. */
  promissoryNotes?: string[];
  /** Give side only: specific action card ids. */
  actionCards?: string[];
  /** Receive side only: number of action cards they pick. */
  actionCardCount?: number;
  fragments?: Partial<FragmentCounts>;
  relics?: string[];
  sendDebt?: number;
  clearDebt?: number;
};

export type ProposeRequest = {
  /** Faction, color, user id or user name. */
  to: string;
  give: TradeSide;
  receive: TradeSide;
  note?: string;
};

export type TradeItemKind =
  | "tg"
  | "commodities"
  | "pn"
  | "pnAny"
  | "ac"
  | "acAny"
  | "fragment"
  | "relic"
  | "sendDebt"
  | "clearDebt"
  | "note"
  | "other";

export type TradeItem = {
  from: string;
  to: string;
  kind: TradeItemKind;
  amount: number;
  id?: string | null;
  label: string;
  raw: string;
};

export type ProposeResponse = {
  ok: boolean;
  offerNumber: number;
  to: string;
  items: TradeItem[];
  offerText?: string | null;
  warnings: string[];
};

export type ButtonRef = {
  channelId: string;
  messageId: string;
  customId: string;
  label?: string | null;
};

export type PendingOffer = {
  direction: "incoming" | "outgoing";
  otherFaction: string;
  otherUserId: string;
  otherUserName: string;
  otherColor: string;
  offerNumber: number;
  /** False when superseded or rescinded; the bot will refuse to accept it. */
  current: boolean;
  text: string;
  items: TradeItem[];
  accept?: ButtonRef | null;
  reject?: ButtonRef | null;
  counter?: ButtonRef | null;
  rescind?: ButtonRef | null;
  createdAt: string;
  otherIcon?: string | null;
};

export type PendingResponse = {
  incoming: PendingOffer[];
  outgoing: PendingOffer[];
};

/**
 * Presses a bot button through the shim (`/app/ws` click op). Resolve `{ error }` or reject to report a failure.
 */
export type PressButton = (
  channelId: string,
  messageId: string,
  customId: string,
) => Promise<{ error?: string } | void> | void;
