/// <reference types="node" />
/** Run: `node --test src/rollback/__tests__/lineage.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRewindIndex, liveIntervals, isLive, pointAfter } from "../lineage.ts";
import type { Rewind, UndoPoint } from "../types.ts";

const pt = (index: number, savedAt: number, current = false): UndoPoint => ({
  index,
  savedAt,
  fileTime: savedAt,
  command: `a${index}`,
  actor: "",
  label: `action ${index}`,
  round: 1,
  phase: "action",
  current,
});

const rw = (at: number, toSavedAt: number, toIndex = 0): Rewind => ({
  at,
  toSavedAt,
  toIndex,
  fromIndex: 0,
  fromSavedAt: 0,
  kind: "rewind",
  byUserId: "",
  byName: "",
  label: "",
});

void test("no rewinds: everything is live", () => {
  const iv = liveIntervals([]);
  assert.ok(isLive(0, iv) && isLive(1e15, iv));
});

void test("a rewind greys the stretch between the target save and the rewind", () => {
  const iv = liveIntervals([rw(10_000, 2_000)]);
  assert.ok(isLive(1_999, iv));
  assert.ok(isLive(2_300, iv), "late message of the target action stays live");
  assert.ok(!isLive(5_000, iv));
  assert.ok(isLive(10_500, iv));
});

void test("undoing a rewind brings the undone stretch back", () => {
  // rewind at 10s back to save@2s (pre-rewind state saved @9s), then undo at 20s back to save@9s
  const iv = liveIntervals([rw(10_000, 2_000), rw(20_000, 9_000)]);
  assert.ok(isLive(5_000, iv), "originally undone event is live again");
  assert.ok(!isLive(15_000, iv), "the rewind's own aftermath is now undone");
  assert.ok(isLive(21_000, iv));
});

void test("events map to the first save at/after them, with slack for late messages", () => {
  const pts = [pt(1, 1_000), pt(2, 2_000), pt(3, 3_000)];
  assert.equal(pointAfter(1_500, pts)?.index, 2);
  assert.equal(pointAfter(2_000, pts)?.index, 2);
  assert.equal(pointAfter(2_050, pts)?.index, 2, "message arriving 50ms after its save");
  assert.equal(pointAfter(2_900, pts)?.index, 3);
  assert.equal(pointAfter(60_000, pts)?.index, 3, "after the last save: nothing changed since");
  assert.equal(pointAfter(-60_000, [pt(1, 1_000)])?.index, undefined);
});

void test("buildRewindIndex classifies rows", () => {
  const points = [pt(4, 12_000, true), pt(3, 9_000), pt(2, 2_000), pt(1, 1_000)];
  const events = [
    { id: "a", time: new Date(900).toISOString() },
    { id: "b", time: new Date(1_950).toISOString() },
    { id: "c", time: new Date(5_000).toISOString() },
    { id: "d", time: new Date(11_990).toISOString() },
  ];
  const idx = buildRewindIndex(events, points, [rw(10_000, 2_000, 2)]);
  assert.deepEqual(idx.rows.get("a"), { status: "live", point: points[3] });
  assert.equal(idx.rows.get("b")?.status, "live");
  assert.equal(idx.rows.get("c")?.status, "undone");
  assert.equal(idx.rows.get("d")?.status, "current");
  assert.deepEqual(idx.livePoints.map((p) => p.index), [1, 2, 4], "pre-rewind save 3 is not live");
});

void test("events whose save a roll-back deleted are 'lost', not mapped to a neighbour", () => {
  // saves 1@1s, 2@2s; 3@3s and 4@4s were rewound away (to 2) at 10s, the pre-rewind state kept as save 3'@4s,
  // the rewound state saved as 4'@10.1s; then that rewind was undone at 20s (back to 3'@4s).
  const points = [pt(3, 4_000, true), pt(2, 2_000), pt(1, 1_000)];
  const r1 = { ...rw(10_000, 2_000, 2), lostSavedAt: [3_000, 4_000] };
  const r2 = { ...rw(20_000, 4_000, 3), lostSavedAt: [10_100] };
  const events = [
    { id: "e2", time: new Date(1_990).toISOString() },
    { id: "e3", time: new Date(2_990).toISOString() },
    { id: "e4", time: new Date(3_990).toISOString() },
  ];
  const idx = buildRewindIndex(events, points, [r1, r2]);
  assert.equal(idx.rows.get("e2")?.status, "live");
  assert.equal(idx.rows.get("e3")?.status, "lost");
  assert.equal(idx.rows.get("e4")?.status, "current");
});
