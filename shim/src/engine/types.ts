/**
 * Engine contract (v1). Mirrors bot ti4.selfhost.engine.EngineModels 1:1 — change both together and bump
 * CONTRACT_VERSION. Dependency-free so the web client can import it (web: `import type … from
 * "../../../shim/src/engine/types"` or a path alias).
 */

import type { AgendaDecision, AgendaState } from "./kinds/agenda.js";
import type { ExplorationState, ExploreDecision } from "./kinds/explore.js";

export type * from "./kinds/agenda.js";
export type * from "./kinds/explore.js";

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
  /** Exploration decks, relic deck, recent explore results / relic draws (G9). Older engines: absent. */
  exploration?: ExplorationState | null;
  /** The agenda in play (agenda phase); null otherwise. See kinds/agenda.ts. */
  agenda?: AgendaState | null;
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
  | "speaker" // agenda tie-break / resolution: the speaker
  | "agenda_voter" // a vote step: the current voter
  | "mention" // weak: exactly one seated player mentioned
  | "mixed_owners"
  | "recent_press" // weak: whoever pressed a button in that channel just before (kind fallback)
  | "active_player" // weak: the active player (kind fallback)
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

/**
 * Everyone-answers-in-parallel prompt (strategy card follow, whens/afters, sabotage, agenda votes...). The decision
 * has scope "table"; each eligible player answers once; the engine closes it when all eligible have responded.
 */
export interface ReactionWindow {
  /** "follow" | "when" | "after" | "sabotage" | "vote" | "pre_vote" | "trade_follow" | ... (area-defined). */
  kind: string;
  /** What it is about, e.g. { strategyCard: 5 } or { actionCard: "sabo", player: "<uid>" }. */
  subject: Record<string, unknown>;
  eligible: UserId[];
  responded: UserId[];
  /** Optional per-player answer summaries, e.g. uid → "followed" / "passed" / "7 for Against". */
  responses: Record<UserId, string>;
}

/**
 * Sub-step state of a multi-step decision edited in place (movement, landing, hit assignment, payment, agenda
 * voting, when/after queues). Derived by the engine from game state (never message text): reload-safe.
 */
export interface Progress<A = Record<string, unknown>> {
  /** Groups consecutive prompts of one flow, e.g. "tactical:<uid>:r3:t2". */
  flow: string | null;
  /** Current sub-step: "select_units", "select_planets", "confirm", ... */
  step: string;
  /** Typed running selection, e.g. { units: [...], spent: { planets: [...], tg: 2 }, votes: 7 }. */
  accumulated: A;
  /** Still needed, e.g. { hits: 2 } or { resources: 3 }. */
  required: Record<string, unknown>;
  /** The commit option ("Done", "Confirm") is meaningful now. */
  canCommit: boolean;
}

export interface DecisionBase<K extends string, V> {
  /** Stable for the life of the prompt message; edits in place keep it and bump `revision`. */
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
  /** 1 on open; +1 on every change (edit in place, target / window / progress change). */
  revision: number;
  window: ReactionWindow | null;
  progress: Progress | null;
}

// ---- typed kinds (add one member per KindSpec; keep alphabetical within an area) ----

import type { CardsDecision } from "./kinds/cards.js";
export type * from "./kinds/cards.js";

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
  | CardsDecision
  | ExploreDecision
  | AgendaDecision
  | LegacyDecision;
export type DecisionKind = Decision["kind"];
export type DecisionOf<K extends DecisionKind> = Extract<Decision, { kind: K }>;

// ---------------------------------------------------------------- actions

export interface AnswerRequest {
  /** The option to press. Omit when sending a structured `payload` instead. */
  optionId?: string;
  /** Structured answer the kind executes as several engine steps (e.g. agenda.vote: VotePayload). */
  payload?: Record<string, unknown>;
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

/** Is this decision waiting on `userId`? (player scope: target; table scope: eligible and not yet responded.) */
export function awaits(d: Decision, userId: UserId): boolean {
  if (d.window) return d.window.eligible.includes(userId) && !d.window.responded.includes(userId);
  if (d.scope === "player") return d.target?.userId === userId;
  return true;
}

/** Narrow helpers. */
export function isKind<K extends DecisionKind>(d: Decision, kind: K): d is DecisionOf<K> {
  return d.kind === kind;
}
