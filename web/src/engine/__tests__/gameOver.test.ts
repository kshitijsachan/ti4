/// <reference types="node" />
/** Run: `../shim/node_modules/.bin/tsx --test src/engine/__tests__/gameOver.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision, GameState } from "../contract";
import { endPromptOf, gameOverHeadline, gameOverView, isGameOver } from "../gameOver";

const player = (userId: string, faction: string, color: string, vp: number, self = false) =>
  ({ userId, userName: userId.toUpperCase(), faction, color, victoryPoints: vp, self, real: true }) as unknown as GameState["players"][number];

const state = (extra: Partial<GameState> = {}): GameState =>
  ({
    contract: 1, game: "pbd1", stateVersion: 1, seq: 1, phase: "action", ended: false, round: 5, activePlayer: "u1", speaker: null,
    players: [player("u1", "sol", "red", 8, true), player("u2", "xxcha", "navy", 10), player("u3", "hacan", "blue", 8)],
    strategyCards: [], tiles: [], publicObjectives: {}, laws: [], draft: null,
    ...extra,
  }) as GameState;

const gameEnd = (createdAt: number, actions: string[]): Decision =>
  ({
    id: `d${createdAt}`, game: "pbd1", kind: "game.end", seq: createdAt, stateVersion: 1, target: null, scope: "table", visibility: "public",
    prompt: "won", createdAt, revision: 1, window: null, progress: null, inputs: null,
    source: { channelId: "c", messageId: `m${createdAt}`, customIdPrefix: null, ephemeral: false },
    options: actions.map((a) => ({ id: a, label: a, style: "success", emoji: null, disabled: false, needsInput: false, handler: a, value: a === "deleteButtons" ? null : { action: a === "gameEnd" ? "end" : "rematch", deletesChannels: false } })),
  }) as unknown as Decision;

void test("a game in play is not over", () => {
  assert.equal(isGameOver(state()), false);
  assert.equal(gameOverView(state(), []), null);
});

void test("won: winner first, shared ranks, the open End Game prompt", () => {
  const s = state({ phase: "finished" as GameState["phase"], ended: true, finish: "won", winners: ["u2"], victoryPointsToWin: 10 });
  const v = gameOverView(s, [gameEnd(1, ["gameEnd", "rematch", "deleteButtons"]), gameEnd(2, ["gameEnd", "rematch"])])!;
  assert.equal(v.finish, "won");
  assert.deepEqual(v.standings.map((r) => [r.userId, r.rank, r.winner]), [["u2", 1, true], ["u1", 2, false], ["u3", 2, false]]);
  assert.equal(v.endPrompt?.id, "d2");
  assert.equal(v.victoryPointsToWin, 10);
  assert.equal(gameOverHeadline(v), "U2 wins");
});

void test("engine standings are used as given; the viewer is marked", () => {
  const s = state({
    ended: true, finish: "won", winners: ["u1"],
    standings: [
      { userId: "u1", userName: "Me", faction: "sol", color: "red", victoryPoints: 10, rank: 1, winner: true },
      { userId: "u2", userName: "Two", faction: "xxcha", color: "navy", victoryPoints: 7, rank: 2, winner: false },
    ],
  });
  const v = gameOverView(s, [])!;
  assert.equal(v.standings[0].self, true);
  assert.equal(gameOverHeadline(v), "You win!");
  assert.equal(v.endPrompt, null);
});

void test("ended: no actions offered, even if a stale prompt is still listed", () => {
  const v = gameOverView(state({ ended: true, finish: "ended", winners: ["u2"] }), [gameEnd(1, ["gameEnd"])])!;
  assert.equal(v.finish, "ended");
  assert.equal(v.endPrompt, null);
});

void test("older engines (ended, no winners field): game over without a winner", () => {
  const v = gameOverView(state({ ended: true }), [])!;
  assert.equal(v.finish, "ended");
  assert.equal(gameOverHeadline(v), "Game over");
  assert.equal(v.standings[0].userId, "u2");
});

void test("endPromptOf ignores other kinds", () => {
  assert.equal(endPromptOf([{ ...gameEnd(1, ["gameEnd"]), kind: "legacy" } as Decision]), null);
});
