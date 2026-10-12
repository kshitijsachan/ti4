/// <reference types="node" />
/** Run: `node --test src/engine/__tests__/stepIds.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepKindOf } from "../../mapactions/stepIds.ts";

void test("after Undo of an activation the re-posted repick prompt is the choose step (pbd283)", () => {
  assert.deepEqual(stepKindOf(["ChooseDifferentDestination_ring", "resetTacticalMovement"], null), { kind: "choose" });
  assert.deepEqual(stepKindOf(["tacticalMoveFrom_313", "ChooseDifferentDestination", "resetTacticalMovement"], null), { kind: "choose" });
});

void test("a move prompt with no system active is a leftover (pbd273)", () => {
  assert.equal(stepKindOf(["tacticalMoveFrom_313", "concludeMove_312"], null), null);
});

void test("with a system active the same prompt is the move step", () => {
  assert.deepEqual(stepKindOf(["tacticalMoveFrom_313", "ChooseDifferentDestination", "concludeMove_312"], "312"), { kind: "move", target: "312" });
});

void test("ring menu is choose, the turn menu is turn", () => {
  assert.deepEqual(stepKindOf(["ring_3", "ring_2"], null), { kind: "choose" });
  assert.deepEqual(stepKindOf(["tacticalAction", "componentAction"], null), { kind: "turn" });
});
