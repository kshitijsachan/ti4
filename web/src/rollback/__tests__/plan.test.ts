/// <reference types="node" />
/** Run: `node --test src/rollback/__tests__/plan.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { asMine, planUndo } from "../plan.ts";
import { humanActionLabel } from "../../decisions/model/phrasing.ts";
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

const press = (index: number, savedAt: number, words: string, id: string, actor = "Undo Tester"): UndoPoint => ({
  index, savedAt, fileTime: savedAt, command: `undotester pressed button: ${words} (${id})`, actor,
  label: `${actor} pressed “${words}”`, round: 1, phase: "action", current: false,
});
/* The Diplomacy readying seen in pbd90: the panel pressed the planet, then Done, 0.5 s apart. */
const diplo = () =>
  newestFirst(
    press(109, 100_000, "Ready 2 Planets", "diploRefresh2"),
    press(110, 160_000, "Nestphar (3/2)", "FFCC_arborec_refresh_nestphar"),
    press(111, 160_546, "Done Readying Planets", "deleteButtons_diplomacy"),
  );

void test("a recorded web flow is undone as one action, back to before its first press", () => {
  const flows = [{ ids: ["refresh_nestphar", "deleteButtons_diplomacy"], summary: "Readied Nestphar", at: 160_600 }];
  const plan = planUndo(diplo(), me, flows);
  assert.equal(plan.kind, "flow");
  if (plan.kind !== "flow") return;
  assert.equal(plan.target.index, 109);
  assert.equal(asMine(plan.first.label, plan.first, plan.summary), "you readied Nestphar");
});

void test("a Done pressed on the heels of my press undoes that press too, even with no flow on record", () => {
  const plan = planUndo(diplo(), me);
  assert.equal(plan.kind, "flow");
  if (plan.kind === "flow") assert.equal(plan.target.index, 109);
});

void test("a lone press is still one plain step", () => {
  const plan = planUndo(newestFirst(press(1, 0, "x", "a"), press(2, 10_000, "Nestphar (3/2)", "refresh_nestphar")), me);
  assert.equal(plan.kind, "latest");
});

void test("undo labels are plain words", () => {
  const p = (words: string, id: string) => asMine(`Undo Tester pressed “${words}”`, press(1, 0, words, id));
  assert.equal(p("Nestphar (3/2)", "FFCC_arborec_refresh_nestphar"), "you readied Nestphar");
  assert.equal(p("Diplo A System", "FFCC_arborec_diploSystem"), "you started choosing a system to protect");
  assert.equal(p("[Primary] Use Production", "constructionPrimary_produce"), "you used Production");
  assert.equal(p("(2) Lead From the Front", "po_scoring_2"), "you scored Lead From the Front");
  // A spend objective: picking it opens its payment; it is scored once paid (pt8).
  assert.equal(p("(3) Sway the Council", "po_scoring_3"), "you started scoring Sway the Council");
  assert.equal(p("Score Sway the Council, paying 8 influence", "deleteButtons_spend"), "you scored Sway the Council, paying 8 influence");
  assert.equal(p("Done Landing Troops", "FFCC_arborec_doneLanding_312"), "you finished landing troops");
  assert.equal(p("Dismiss These Buttons", "deleteButtons"), "you dismissed a prompt");
  assert.equal(p("Build in This System (4 PRODUCTION value)", "FFCC_arborec_tacticalActionBuild_312"), "you started producing units");
  assert.equal(p("command_tokens.adjust", "command_tokens.adjust"), "you placed command tokens");
  assert.equal(p("Skip moving", "x"), "you skipped moving");
  assert.equal(p("+", "FFCC_arborec_increase_tactic_cc"), "you added 1 tactic token");
  assert.equal(p("End Turn (+1 ability)", "FFCC_arborec_endOfTurnAbilities"), "you opened the end-of-turn abilities");
  assert.equal(p("Pass (+1 ability)", "FFCC_arborec_passingAbilities"), "you opened the abilities before passing");
  assert.equal(p("Done Exhausting Planets", "deleteButtons_spend"), "you finished paying");
  assert.equal(p("307 (Nestphar - Arborec)", "FFCC_arborec_diplo_nestphar_diploP"), "you protected system 307 (Nestphar)");
  assert.equal(p("Ready For Strategy Phase", "pass_on_abilities"), "you marked ready for the strategy phase");
  assert.equal(p("Trade", "FFCC_arborec_scPick_5"), "you picked Trade");
  assert.equal(p("Place 1 infantry", "mitosisInf"), "you started Mitosis (infantry)");
});

void test("a map activation (Tactical Action, ring, system) is undone as one action, back to the turn menu", () => {
  const points = newestFirst(
    press(40, 10_000, "End Turn", "turnEnd", "Bot Beta"),
    press(41, 60_000, "Tactical Action", "tacticalAction"),
    press(42, 61_000, "Ring #2", "ring_2"),
    press(43, 62_000, "Lodor (209)", "FFCC_sol_ringTile_209"),
  );
  const plan = planUndo(points, me);
  assert.equal(plan.kind, "flow");
  if (plan.kind !== "flow") return;
  assert.equal(plan.target.index, 40);
  assert.equal(asMine(plan.first.label, plan.first, plan.summary), "you activated Lodor (209)");
});

void test("an activation whose Tactical Action was pressed long before still folds in the ring step only when close", () => {
  const points = newestFirst(
    press(40, 0, "x", "a", "Bot Beta"),
    press(41, 1_000, "Tactical Action", "tacticalAction"),
    press(42, 1_000_000, "Lodor (209)", "ringTile_209"),
  );
  assert.equal(planUndo(points, me).kind, "latest");
});

void test("saved action labels read as words (game log, undo)", () => {
  assert.equal(humanActionLabel("Alice pressed “command_tokens.adjust”"), "Alice placed command tokens");
  assert.equal(humanActionLabel("Bot Theta 9 proposed a transaction (engine)"), "Bot Theta 9 proposed a transaction");
  assert.equal(humanActionLabel("Alice pressed “strategy_card.construction_place”"), "Alice placed a structure");
  assert.equal(humanActionLabel("Alice pressed “units.something_new”"), "Alice answered something new");
});
