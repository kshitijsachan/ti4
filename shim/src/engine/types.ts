/**
 * Engine contract (v1). Mirrors bot ti4.selfhost.engine.EngineModels 1:1 — change both together and bump
 * CONTRACT_VERSION. Dependency-free so the web client can import it (web: `import type … from
 * "../../../shim/src/engine/types"` or a path alias).
 */

import type { TradeForceReplenish, TradeOffer, TradeOfferSent, TradeState } from "./kinds/trade.js";

export type * from "./kinds/trade.js";

export const CONTRACT_VERSION = 1;

// ---------------------------------------------------------------- state

export type UserId = string;
export type FactionId = string;

export interface GameState {
  contract: number;
  game: string;
  /** Changes on every save and on undo (Game.lastModifiedDate). */
  stateVersion: number;
  /** Engine event seq at snapshot time; resume the stream with after=seq. */
  seq: number;
  phase: string;
  round: number;
  activePlayer: UserId | null;
  speaker: UserId | null;
  players: PlayerState[];
  strategyCards: StrategyCardState[];
  tiles: TileState[];
  /** Revealed public objective id → user ids... (today: factions/user ids as the engine stores them) that scored it. */
  publicObjectives: Record<string, string[]>;
  laws: string[];
  draft: DraftState | null;
  /** The viewer's trade view (null without a viewer). See kinds/trade.ts. */
  trade: TradeState | null;
}

export interface PlayerState {
  userId: UserId;
  userName: string;
  /** Authoritative. null until drafted. */
  faction: FactionId | null;
  color: string | null;
  /** This is the viewer (only then is `hand` filled). */
  self: boolean;
  real: boolean;
  passed: boolean;
  eliminated: boolean;
  speaker: boolean;
  active: boolean;
  victoryPoints: number;
  tg: number;
  commodities: number;
  commoditiesMax: number;
  commandTokens: { tactic: number; fleet: number; strategy: number };
  strategyCards: number[];
  techs: string[];
  exhaustedTechs: string[];
  planets: string[];
  exhaustedPlanets: string[];
  relics: string[];
  fragments: string[];
  /** "<leaderId>" or "<leaderId>:locked" / ":exhausted". */
  leaders: string[];
  promissoryNotesInPlayArea: string[];
  secretsScored: Record<string, number>;
  actionCardCount: number;
  secretObjectiveCount: number;
  promissoryNoteCount: number;
  hand: Hand | null;
}

/** Card id → the per-player numeric handle the engine uses in its option ids. */
export interface Hand {
  actionCards: Record<string, number>;
  secretObjectives: Record<string, number>;
  promissoryNotes: Record<string, number>;
}

export interface StrategyCardState {
  number: number;
  holder: UserId | null;
  tradeGoods: number;
  played: boolean;
}

export interface TileState {
  position: string;
  tileId: string;
  holders: HolderState[];
}

/** name: "space" or a planet id. */
export interface HolderState {
  name: string;
  units: UnitStack[];
  tokens: string[];
  control: string[];
}

export interface UnitStack {
  owner: FactionId | null;
  color: string;
  /** async unit id: inf, ff, mf, pd, sd, dd, ca, cv, dn, fs, ws, ... */
  unit: string;
  count: number;
  damaged: number;
  galvanized: number;
}

export interface DraftState {
  type: "milty";
  currentPlayer: UserId | null;
  order: UserId[];
}

// ---------------------------------------------------------------- decisions

export type ResolvedBy =
  | "owner_prefix" // FFCC_<faction>_ on the options
  | "spoof_prefix"
  | "cards_thread" // posted in the player's cards-info thread
  | "private_channel"
  | "interaction_user" // reply/followup/ephemeral to that player's interaction
  | "draft_turn"
  | "sc_holder" // the player holding the strategy card the prompt is about
  | "mention" // weak: exactly one seated player mentioned
  | "mixed_owners"
  | "none";

export interface Target {
  userId: UserId | null;
  faction: FactionId | null;
  color: string | null;
  resolvedBy: ResolvedBy;
}

export interface Option<V = Record<string, unknown> | null> {
  /** Opaque; pass back in an Answer. */
  id: string;
  label: string;
  style: "primary" | "secondary" | "success" | "danger" | "link" | "premium" | "select" | string;
  /** Emoji name or custom emoji id. */
  emoji: string | null;
  disabled: boolean;
  /** Needs free text (a modal): not answerable through the engine yet; fall back to legacy press. */
  needsInput: boolean;
  /** Engine handler id (custom id without owner prefix): debugging aid, do not parse in new code. */
  handler: string;
  /** Typed meaning for the decision's kind; null for options outside its vocabulary ("Done", "Cancel"). */
  value: V | null;
}

export interface DecisionBase<K extends string, V> {
  id: string;
  game: string;
  kind: K;
  seq: number;
  stateVersion: number;
  target: Target | null;
  /** player: only target may answer. table: any seated player, each answering for themself. */
  scope: "player" | "table";
  /** private: only the target can see it. */
  visibility: "public" | "private";
  /** The engine's prompt text (markdown-ish, Discord flavoured). Display only. */
  prompt: string;
  options: Option<V>[];
  source: { channelId: string; messageId: string; customIdPrefix: string | null; ephemeral: boolean };
  createdAt: number;
}

// ---- typed kinds (add one member per KindSpec; keep alphabetical within an area) ----

export type StrategyCardPick = DecisionBase<"strategy_card.pick", { strategyCard: number; tradeGoods: number }>;
export type TechGain = DecisionBase<"tech.gain", { tech: string; free: boolean; starting: boolean; flags: string[] }>;
export type SecretObjectiveDiscard = DecisionBase<
  "secret_objective.discard",
  { handle: number; secretObjective?: string; redraw: boolean }
>;
export type MiltyDraftPick = DecisionBase<
  "draft.milty.pick",
  { category: "slice" | "faction" | "order" | string; pick: string }
>;
/** Everything not yet typed: options carry label/style/handler only. */
export type LegacyDecision = DecisionBase<"legacy", null>;

export type Decision =
  | StrategyCardPick
  | TechGain
  | SecretObjectiveDiscard
  | MiltyDraftPick
  | TradeOffer
  | TradeOfferSent
  | TradeForceReplenish
  | LegacyDecision;
export type DecisionKind = Decision["kind"];
export type DecisionOf<K extends DecisionKind> = Extract<Decision, { kind: K }>;

// ---------------------------------------------------------------- actions

export interface AnswerRequest {
  optionId: string;
  /** The decision seq you saw; a mismatch answers 409 stale instead of acting on a changed prompt. */
  expectedSeq?: number;
  /** Idempotency key: retries with the same key return the first result. */
  requestId?: string;
  /** Trusted (bot-token) route only: the seat answering. */
  userId?: UserId;
}

export type AnswerStatus =
  | "done"
  | "stale"
  | "busy"
  | "forbidden"
  | "not_found"
  | "bad_option"
  | "needs_input"
  | "unsupported"
  | "refused"
  | "error";

export interface AnswerResult {
  ok: boolean;
  status: AnswerStatus;
  error: string | null;
  decisionId: string;
  seq: number;
  stateVersion: number;
  /** Decisions the answer opened (any player), in seq order. */
  opened: Decision[];
}

// ---------------------------------------------------------------- events (SSE: event name = type, id = seq)

export type EngineEvent =
  | { seq: number; type: "decision.opened" | "decision.updated"; game: string; stateVersion: number; decision: Decision; reason: null }
  | { seq: number; type: "decision.closed"; game: string; stateVersion: number; decision: Decision; reason: "deleted" | "no_options" | "replaced" | string }
  | { seq: number; type: "state.changed"; game: string; stateVersion: number; decision: null; reason: null };

/** Sent instead of a backlog when `after` is older than the server's buffer: re-snapshot, continue from seq. */
export interface ResetEvent {
  seq: number;
}

export interface DecisionsSnapshot {
  seq: number;
  decisions: Decision[];
}

/** Narrow helpers. */
export function isKind<K extends DecisionKind>(d: Decision, kind: K): d is DecisionOf<K> {
  return d.kind === kind;
}
