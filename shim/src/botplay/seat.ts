import type { Board } from "./board.js";
import type { Control, Prompt } from "./prompts.js";

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
}
