/**
 * Engine contract (v1). Mirrors bot ti4.selfhost.engine.EngineModels 1:1 — change both together and bump
 * CONTRACT_VERSION. Dependency-free so the web client can import it (web: `import type … from
 * "../../../shim/src/engine/types"` or a path alias).
 */

import type { AgendaDecision, AgendaState } from "./kinds/agenda.js";
import type { CardsDecision } from "./kinds/cards.js";
import type { CombatDecision, CombatState } from "./kinds/combat.js";
import type { ExplorationState, ExploreDecision } from "./kinds/explore.js";
import type { InputFormDecision } from "./kinds/input.js";
import type { ProductionDecision } from "./kinds/production.js";
import type { SetupDecision } from "./kinds/setup.js";
import type { StatusDecision, StatusState } from "./kinds/status.js";
import type { StrategyDecision } from "./kinds/strategy.js";
import type { TacticalDecision } from "./kinds/tactical.js";
import type { ThundersEdgeDecision, ThundersEdgeState } from "./kinds/te.js";
import type { TradeForceReplenish, TradeOffer, TradeOfferSent, TradeState } from "./kinds/trade.js";

export type * from "./kinds/agenda.js";
export type * from "./kinds/cards.js";
export type * from "./kinds/explore.js";
export type * from "./kinds/input.js";
export type * from "./kinds/production.js";
export type * from "./kinds/setup.js";
export type * from "./kinds/status.js";
export type * from "./kinds/tactical.js";
export type * from "./kinds/te.js";
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
  /** Exploration decks, relic deck, recent explore results / relic draws (G9). Older engines: absent. */
  exploration?: ExplorationState | null;
  /** The agenda in play (agenda phase); null otherwise. See kinds/agenda.ts. */
  agenda?: AgendaState | null;
  /** Status phase facts (scoring declarations, token gain, readiness); null outside the status phase. */
  status?: StatusState | null;
  /** Thunder's Edge state; null for games without it (G10, kinds/te.ts). */
  thundersEdge?: ThundersEdgeState | null;
  /** Setup progress (game creation → first strategy phase); null once the game is under way. */
  setup?: SetupState | null;
  /** The viewer's trade view (null without a viewer). See kinds/trade.ts. */
  trade?: TradeState | null;
  /** Combat in the active system (G4); null when there is none. */
  combat?: CombatState | null;
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
  name: string;
  /** Automation id the engine resolves the card as ("pok4construction", …). */
  card: string | null;
  holderFaction: FactionId | null;
  /** Once played: every seated player's answer to it. */
  reactions: ScReaction[];
}

/** A player's answer to a played strategy card. */
export interface ScReaction {
  faction: FactionId;
  /** holder: played it (never follows it). */
  status: "holder" | "pending" | "followed" | "declined";
  /** Pending players only. */
  canFollow: boolean;
  cantFollowReason: "no_strategy_token" | "no_home_space_dock" | "all_secrets_scored" | null;
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
  status: "drafting" | "finished";
  /** null once the draft is finished. */
  currentPlayer: UserId | null;
  /** The snake: one entry per pick. */
  order: UserId[];
  /** Each drafter's picks so far (null = not picked yet). */
  players: DraftPlayer[];
  /** Still on the board. */
  available: { slices: string[]; factions: FactionId[]; speakerOrders: number[] };
}

export interface DraftPlayer {
  userId: UserId;
  /** Draft id: Keleres is drafted as "keleresm" whatever flavour it plays. */
  faction: FactionId | null;
  slice: string | null;
  speakerOrder: number | null;
}

/**
 * settings: game created, no draft yet · draft · player_setup: factions, Keleres flavour, starting technologies ·
 * deal_secrets: everyone set up, secret objectives not dealt · keep_secrets · reveal_objectives: reveal and start the
 * strategy phase.
 */
export type SetupStage = "settings" | "draft" | "player_setup" | "deal_secrets" | "keep_secrets" | "reveal_objectives";

export interface SetupState {
  stage: SetupStage;
  /** Who the stage waits on (empty for the table-wide steps). */
  waitingOn: UserId[];
  players: SetupPlayer[];
}

export interface SetupPlayer {
  userId: UserId;
  faction: FactionId | null;
  startingTechsNeeded: number;
  secretObjectivesToDiscard: number;
  /** Drafted Keleres and has not chosen a flavour yet (faction is null until then). */
  keleresFlavorPending: boolean;
}

// ---------------------------------------------------------------- decisions

export type ResolvedBy =
  | "owner_prefix" // FFCC_<faction>_ on the options
  | "spoof_prefix"
  | "cards_thread" // posted in the player's cards-info thread
  | "private_channel"
  | "interaction_user" // reply/followup/ephemeral to that player's interaction
  | "draft_turn"
  | "speaker" // the speaker acts: agenda tie-break / resolution, reveal the next public objective
  | "agenda_voter" // a vote step: the current voter
  | "sc_holder" // the player holding the strategy card the prompt is about
  | "prompt_text" // tech.gain: the one player the prompt text names (faction emoji / colour)
  | "setup_state" // tech.gain during setup: the one player still owing starting technologies
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
  /**
   * Answering asks for input: a button that opens a form (the answer returns status "needs_input" and opens an
   * "input.form" decision for you), or a form's "submit" (send `inputs`).
   */
  needsInput: boolean;
  /** Engine handler id (custom id without owner prefix): debugging aid, do not parse in new code. */
  handler: string;
  /** Typed meaning for the decision's kind; null for options outside its vocabulary ("Done", "Cancel"). */
  value: V | null;
  /**
   * Who may press this option, set only on menus whose options belong to different players
   * (decision.target.resolvedBy === "mixed_owners"); the answer endpoint refuses anyone else. null otherwise.
   */
  owner?: Target | null;
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

/**
 * A typed input: a select menu on the prompt (kind "select", id = menu id, one "choice" field "values") or a form a
 * button opened (kind "form", "input.form" decisions). Answer a select with `{ optionId: id, values }` (or a single
 * option `"<id>#<value>"`); a form with `{ optionId: "submit", inputs: { fieldId: value } }` (multi-values "\n"-joined).
 */
export interface InputSchema {
  id: string;
  kind: "select" | "form";
  title: string | null;
  fields: InputField[];
}

export interface InputField {
  id: string;
  label: string | null;
  /** choice: pick minValues..maxValues of choices; text: minLength..maxLength chars; number: integer text. */
  type: "choice" | "text" | "number";
  required: boolean;
  minLength: number | null;
  maxLength: number | null;
  minValues: number | null;
  maxValues: number | null;
  multiline: boolean;
  placeholder: string | null;
  /** Prefilled value. */
  value: string | null;
  choices: InputChoice[] | null;
}

export interface InputChoice {
  value: string;
  label: string;
  description: string | null;
  selected: boolean;
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
  /** Select menus / form fields this decision accepts (see InputSchema); null when none. */
  inputs: InputSchema[] | null;
}

/** For area kind files (shim/src/engine/kinds/*.ts). */
export type DecisionBaseOf<K extends string, V> = DecisionBase<K, V>;

// ---- typed kinds (add one member per KindSpec; keep alphabetical within an area) ----

export type StrategyCardPick = DecisionBase<
  "strategy_card.pick",
  { strategyCard: number; tradeGoods: number; name?: string; card?: string | null }
>;
export type TechGain = DecisionBase<
  "tech.gain",
  {
    tech: string;
    free: boolean;
    starting: boolean;
    flags: string[];
    /** PROPULSION | BIOTIC | CYBERNETIC | WARFARE | UNITUPGRADE | … */
    type?: string | null;
    /** Prerequisite letters, e.g. "GG". */
    requirements?: string | null;
    factionTech?: boolean;
  }
>;
export type SecretObjectiveDiscard = DecisionBase<
  "secret_objective.discard",
  { handle: number; secretObjective?: string; redraw: boolean }
>;

/** Everything not yet typed: options carry label/style/handler only. */
export type LegacyDecision = DecisionBase<"legacy", null>;

export type Decision =
  | StrategyCardPick
  | TechGain
  | SecretObjectiveDiscard
  | SetupDecision
  | CardsDecision
  | ExploreDecision
  | AgendaDecision
  | StatusDecision
  | TacticalDecision
  | ThundersEdgeDecision
  | StrategyDecision
  | TradeOffer
  | TradeOfferSent
  | TradeForceReplenish
  | CombatDecision
  | ProductionDecision
  | InputFormDecision
  | LegacyDecision;
export type DecisionKind = Decision["kind"];
export type DecisionOf<K extends DecisionKind> = Extract<Decision, { kind: K }>;

// ---------------------------------------------------------------- actions

export interface AnswerRequest {
  /** The option to press. Omit when sending a structured `payload` instead. */
  optionId?: string;
  /**
   * Structured answer the kind executes as one or more engine steps under the game lock (KindSpec.acceptsPayload):
   * agenda.vote VotePayload, payment.spend, production.produce, final command token pools (options whose value says
   * payload: true). Validated whole by the kind, then pressed: e.g. payment.spend {planets, tg, commodities,
   * sarween}, production.produce {units}.
   */
  payload?: Record<string, unknown>;
  /** The decision seq you saw; a mismatch answers 409 stale instead of acting on a changed prompt. */
  expectedSeq?: number;
  /** Idempotency key: retries with the same key return the first result. */
  requestId?: string;
  /** Trusted (bot-token) route only: the seat answering. */
  userId?: UserId;
  /** Select menu values (optionId = the select's InputSchema id). */
  values?: string[];
  /** Form field values (input.form decisions, optionId "submit"). */
  inputs?: Record<string, string>;
}

export type AnswerStatus =
  | "done"
  | "stale"
  | "busy"
  | "forbidden"
  | "not_found"
  | "bad_option"
  | "needs_input"
  | "bad_input"
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
  /** Decisions the answer opened (any player), in seq order. With status "needs_input": includes the form. */
  opened: Decision[];
  /**
   * How the engine ran it: "engine" (direct Interaction), "synthetic" (simulated click) or "payload" (a structured
   * answer, whose presses each took one of the two); null on failure.
   */
  path: "engine" | "synthetic" | "payload" | null;
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
  // Mixed-owner menu: only the options owned by this user (or by nobody) are theirs.
  if (d.target?.resolvedBy === "mixed_owners") return optionsFor(d, userId).length > 0;
  return true;
}

/**
 * The player may answer although the window does not await them (KindSpec.answersOutsideWindow): the holder of a
 * played strategy card resolves its primary on the card's message (strategy_card.resolve windows list followers only);
 * the player who played an action card may press "Pause Timer" on its sabotage window.
 */
export function answersOutsideWindow(d: Decision, userId: UserId, state: GameState | null): boolean {
  if (!d.window) return false;
  const me = state?.players.find((p) => p.userId === userId);
  if (d.kind === "action_card.sabotage") return !!me?.faction && d.window.subject?.faction === me.faction;
  if (d.kind !== "strategy_card.resolve") return false;
  const holder = d.window.subject?.holder;
  return !!holder && !!me?.faction && me.faction === holder;
}

/** The options of `d` this user may press (per-option owner on mixed-owner menus; all options otherwise). */
export function optionsFor<D extends Decision>(d: D, userId: UserId): D["options"] {
  return d.options.filter((o) => !o.owner?.userId || o.owner.userId === userId) as D["options"];
}

/** Narrow helpers. */
export function isKind<K extends DecisionKind>(d: Decision, kind: K): d is DecisionOf<K> {
  return d.kind === kind;
}
