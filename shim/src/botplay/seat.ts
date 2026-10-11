import type { Board } from "./board.js";
import type { Control, Prompt } from "./prompts.js";
import type { AnswerResult, Decision } from "../engine/types.js";
import type { LandRequest, MoveRequest } from "../engine/kinds/tactical.js";

/** What the planner needs from the seat it plays (the autopilot's virtual client, or a remote test harness). */
export interface Seat {
  readonly userId: string;
  readonly name: string;
  /** This seat's faction in a game (lower case, as in the bot's ids), once known. */
  faction(game: string): Promise<string | undefined>;
  /** Bot messages with enabled controls in the game's channels that this seat may see, oldest first. */
  prompts(game: string): Prompt[];
  /** Every message (with or without controls) in the game's channels this seat may see, oldest first. */
  messages(game: string): Prompt[];
  /** Presses a control (through the same path as the rule table); resolves with an error text if it failed. */
  press(p: Prompt, c: Control, why: string): Promise<string | undefined>;
  /** The board from the bot's web data (fresh = bypass the short cache). */
  board(game: string, fresh?: boolean): Promise<Board | null>;
  /** POST /api/game/{g}/movement as this seat; resolves with an error text on failure. */
  movement(game: string, target: string, displacement: Record<string, { unitType: string; colorID: string; counts: number[] }[]>): Promise<string | undefined>;
  log(text: string): void;
  /** The typed engine API for this seat (docs/ENGINE.md); absent when the engine is off or unreachable. */
  engine?: SeatEngine;
  /**
   * The typed engine path owns this prompt (engine reachable, typed decision waiting on this seat, within its grace
   * period): legacy jobs must not press it. False whenever the engine is off/down, so the legacy jobs keep working.
   */
  engineOwns?(game: string, messageId: string): Promise<boolean>;
  /**
   * Produce this build list (unit ids, one per unit) on the engine's typed production decision for this message in
   * one atomic answer. undefined = done; null = no typed decision (use the buttons); string = the engine's refusal.
   */
  engineProduce?(game: string, messageId: string, build: string[]): Promise<string | null | undefined>;
}

/** Typed decisions and actions as this seat. Every method resolves null when the engine is unavailable. */
export interface SeatEngine {
  /** Open decisions waiting on this seat in a game. */
  decisions(game: string): Promise<Decision[] | null>;
  answer(game: string, d: Decision, optionId: string, why: string): Promise<AnswerResult | null>;
  /** tactical.move direct action (stage these units, finish movement unless conclude=false). */
  move(game: string, d: Decision, req: Omit<MoveRequest, "userId">, why: string): Promise<AnswerResult | null>;
  /** tactical.land direct action. */
  land(game: string, d: Decision, req: Omit<LandRequest, "userId">, why: string): Promise<AnswerResult | null>;
}
