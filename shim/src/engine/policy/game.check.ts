/** Bots and the victory prompt (game.end): `npx tsx src/engine/policy/game.check.ts` (exits 1 on failure). */
import assert from "node:assert/strict";
import { chooseTyped } from "../autopilot.js";
import { fallbackDue, staleForBot } from "./fallback.js";
import type { Decision, GameState, Option } from "../types.js";

const ME = "u1";
const opt = (id: string, value: unknown): Option<any> => ({
  id, label: id, style: "success", emoji: null, disabled: false, needsInput: false, handler: id, value: value as any,
});
const gameEnd = {
  id: "d1", game: "g1", kind: "game.end", seq: 1, stateVersion: 1, revision: 1, window: null, progress: null, inputs: null,
  target: null, scope: "table", visibility: "public", prompt: "it appears as though X has won the game!", createdAt: 0,
  source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false },
  options: [
    opt("gameEnd", { action: "end", deletesChannels: false }),
    opt("rematch", { action: "rematch", deletesChannels: false }),
    opt("deleteButtons", null),
  ],
} as unknown as Decision;
const state = { phase: "finished", ended: true, winners: ["u2"], players: [] } as unknown as GameState;

// Never answered by a bot: no specific policy, no fallback (even forced by the watchdog), never counted as a stall.
assert.equal(chooseTyped(gameEnd, state, ME), null);
assert.equal(chooseTyped(gameEnd, state, ME, { history: [], open: [], all: [], force: true, waitedMs: 10 * 60_000 } as any), null);
assert.equal(chooseTyped(gameEnd, null, ME, { history: [], open: [], all: [], force: true, waitedMs: 10 * 60_000 } as any), null);
assert.equal(fallbackDue(gameEnd, ME, { waitedMs: 10 * 60_000, force: true }), false);
assert.equal(staleForBot(gameEnd, state, ME), true);
assert.equal(staleForBot(gameEnd, null, ME), true);

// The objectives-ran-out prompt's Rematch is never the status policy's pick.
const reveal = {
  ...gameEnd, kind: "status.reveal_objective", scope: "player",
  target: { userId: ME, faction: "sol", color: "red", resolvedBy: "speaker" },
  options: [opt("rematch", { action: "rematch" }), opt("endGameMostPoints", { action: "end_game" })],
} as unknown as Decision;
const statusState = { phase: "statusScoring", ended: false, players: [{ userId: ME, faction: "sol", speaker: true }] } as unknown as GameState;
assert.notEqual(chooseTyped(reveal, statusState, ME)?.option?.id, "rematch");

console.log("game.check: OK");
