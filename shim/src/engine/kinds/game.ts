/**
 * Game-level prompts. Java GameEndKind.
 *
 * `game.end`: the victory prompt the bot posts in the actions channel when someone reaches the victory points ("it
 * appears as though X has won the game!", Helper.checkEndGame): End Game (`gameEnd`), Rematch (`rematch`), and in fog
 * of war "End and Delete Game" (`gameEndConfirmation`, which asks for a confirmation carrying `gameEnd` again). The
 * "Mistake, delete these" dismiss has value null. Table scope, no target: any seated player may press. It closes
 * once the game has ended (GameState.ended with no game.end open = ended for good). Bots never answer it.
 */
import type { DecisionBase } from "../types.js";

export interface GameEndValue {
  /** end: end the game now; end_confirm: ask for the "End and Delete" confirmation (fog); rematch: new game, same seats. */
  action: "end" | "rematch" | "end_confirm";
  /** Fog of war: ending deletes the game's channels. */
  deletesChannels: boolean;
}

export type GameEnd = DecisionBase<"game.end", GameEndValue>;

export type GameDecision = GameEnd;
