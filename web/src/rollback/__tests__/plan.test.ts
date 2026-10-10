/// <reference types="node" />
/** Run: `node --test src/rollback/__tests__/plan.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planUndo } from "../plan.ts";
import type { UndoPoint } from "../types.ts";

const pt = (index: number, actor: string, label = `${actor} pressed “x${index}”`, command = `${actor} pressed button`): UndoPoint => ({
  index, savedAt: index * 1000, fileTime: index * 1000, command, actor, label, round: 1, phase: "strategy", current: false,
});
const me = { names: ["Undo Tester", "undotester"] };
const newestFirst = (...ps: UndoPoint[]) => { const out = [...ps].reverse(); out[0] = { ...out[0], current: true }; return out; };

void test("my latest action on top: a plain undo", () => {
  const plan = planUndo(newestFirst(pt(1, "Bot Beta"), pt(2, "Undo Tester")), me);
  assert.equal(plan.kind, "latest");
});

void test("bots picked after my pick: rewind to just before mine, naming what else goes", () => {
  const plan = planUndo(newestFirst(pt(24, "someone"), pt(25, "Undo Tester"), pt(26, "Bot Beta"), pt(27, "Bot Alpha")), me);
  assert.equal(plan.kind, "mine");
  if (plan.kind !== "mine") return;
  assert.equal(plan.point.index, 25);
  assert.equal(plan.target.index, 24);
  assert.deepEqual(plan.after.map((p) => p.index), [27, 26]);
});

void test("older saves name me by user name", () => {
  const plan = planUndo(newestFirst(pt(1, "x"), pt(2, "undotester"), pt(3, "botalpha")), me);
  assert.equal(plan.kind, "mine");
});

void test("nothing of mine: others", () => {
  assert.equal(planUndo(newestFirst(pt(1, "Bot Beta"), pt(2, "Bot Alpha")), me).kind, "others");
});

void test("never reaches back across a roll-back", () => {
  const plan = planUndo(newestFirst(pt(1, "x"), pt(2, "Undo Tester"), pt(3, "", "⏪ rewound", "⏪ Bob rewound"), pt(4, "Bot Alpha")), me);
  assert.equal(plan.kind, "others");
});

void test("the latest save is a roll-back: undoing it is mine", () => {
  assert.equal(planUndo(newestFirst(pt(1, "x"), pt(2, "", "⏪ r", "⏪ Bob rewound")), me).kind, "latest");
});
