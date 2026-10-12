/**
 * Status phase + scoring decision kinds (G7). Mirrors bot ti4.selfhost.engine.kinds.Status*Kind,
 * CommandTokensAdjustKind, ImperialScoreKind (action_card.discard is typed in kinds/cards.ts) and EngineModels.StatusState.
 */
import type { DecisionBaseOf, PublicObjectiveId, SecretObjectiveId, UserId } from "../types.js";

export interface CommandTokenPools {
  tactic: number;
  fleet: number;
  strategy: number;
}

/** GameState.status: present only during the status phase. */
export interface StatusState {
  round: number;
  /** "scoring" (statusScoring) or "homework" (statusHomework). */
  step: "scoring" | "homework" | string;
  /** This round's public objective has been revealed. */
  objectiveRevealed: boolean;
  custodiansTaken: boolean;
  /** The phase after this status phase. */
  next: "strategy" | "agenda" | "edict" | string;
  players: Record<UserId, PlayerStatus>;
}

export interface PlayerStatus {
  /** Objective id scored this round, "none" when declined, null while undecided. */
  publicScored: PublicObjectiveId | "none" | null;
  secretScored: SecretObjectiveId | "none" | null;
  /** Pools before this round's gain. */
  tokensBase: CommandTokenPools;
  /** Tokens this status phase gives (2 + Versatile / Hyper Metabolism / … − Malevolency). */
  tokenGain: number;
  /** Most the three pools may hold after the gain (base + gain, capped by reinforcements). */
  tokenMaxTotal: number;
  /** Deliberate Action: no pool may go below its base. */
  noTokenLoss: boolean;
  /** Final pools confirmed this round (null until set). */
  tokensConfirmed: CommandTokenPools | null;
  /** Pressed Ready on the homework prompt. */
  ready: boolean;
  actionCardLimit: number;
  /** Only for the viewer (null for others): status-phase secrets in hand the engine knows are met now. */
  scorableSecrets: SecretObjectiveId[] | null;
}

/**
 * The shared "score objectives" prompt (window kind "status.score": responded = declared both; responses[uid] =
 * "<public>/<secret>", each an objective id, "none" or "pending"). Also Imperial's own "score a public" list (scope
 * player, no window).
 */
export type StatusScore = DecisionBaseOf<
  "status.score",
  | {
      action: "score_public";
      objective: PublicObjectiveId;
      number: number;
      stage: 1 | 2 | null;
      points: number;
      /** 0 = the engine cannot judge this objective. */
      threshold: number;
      progress: Record<UserId, number>;
      /** Players who meet it now and have not scored it. */
      eligible: UserId[];
    }
  | { action: "no_public" }
  /** Opens the private list (status.score_secret). */
  | { action: "score_secret" }
  | { action: "no_secret" }
>;

/** Private list of secret objectives in hand (opened by status.score "score_secret"). */
export type StatusScoreSecret = DecisionBaseOf<
  "status.score_secret",
  {
    handle: number;
    secretObjective: SecretObjectiveId | null;
    phase: "status" | "action" | "agenda" | string | null;
    points: number;
    progress?: number;
    threshold?: number;
    /** null: the engine cannot judge it. */
    met?: boolean | null;
  }
>;

/** Reveal the next public objective (target: speaker). */
export type StatusRevealObjective = DecisionBaseOf<
  "status.reveal_objective",
  | { action: "reveal"; stage: 1 | 2; count: 1 | 2; position: number | null }
  | { action: "continue" }
  | { action: "end_game" }
  /** "Rematch" next to End Game when the objectives ran out (bots never press it). */
  | { action: "rematch" }
>;

/**
 * Status homework (window kind "status.ready"). "command_tokens" with payload: true is answered with
 * `payload: CommandTokenPools` = the final pools (checked against GameState.status.players[uid]); "ready" ends the
 * player's status phase.
 */
export type StatusHomework = DecisionBaseOf<
  "status.homework",
  { action: "command_tokens"; payload: boolean } | { action: "ready"; next: "strategy" | "agenda" | "edict" | string }
>;

/** "Start Strategy Phase": the engine presses it itself once nobody is mid-way through tokens. */
export type StatusAdvance = DecisionBaseOf<"status.advance", { action: "start"; next: "strategy" }>;

/** Imperial primary scoring options (when no strategy-card kind claims the Imperial prompt). */
export type StatusImperial = DecisionBaseOf<
  "status.imperial",
  { action: "score_imperial"; controlsMecatol: UserId[] } | { action: "score_public_list" }
>;

/**
 * Step-by-step token prompt (progress flow "command_tokens": accumulated = current pools, required = {status, base?,
 * gain?, maxTotal?}). In the status phase an "adjust" option also takes a payload (final pools), like
 * status.homework.
 */
export type CommandTokensAdjust = DecisionBaseOf<
  "command_tokens.adjust",
  { action: "adjust"; pool: "tactic" | "fleet" | "strategy"; delta: 1 | -1; payload: boolean } | { action: "reset" }
>;

export type StatusDecision =
  | StatusScore
  | StatusScoreSecret
  | StatusRevealObjective
  | StatusHomework
  | StatusAdvance
  | StatusImperial
  | CommandTokensAdjust;
