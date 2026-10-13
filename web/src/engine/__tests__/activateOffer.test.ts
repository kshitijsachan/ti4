/// <reference types="node" />
/** Run: `node --test src/engine/__tests__/activateOffer.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { engineActivation, isStartMenu, offeredActivation } from "../../mapactions/activateOffer.ts";
import { activateClick } from "../../mapactions/activateClick.ts";

/* pbd436 (playtest 7): Yssaril, 0 tactic tokens, Thunder's Edge Warfare primary → the bot's system menu. */
const warfareMenu = [
  { value: { step: "system", position: "000", tileId: "112", token: false } },
  { value: { step: "system", position: "301", tileId: "57", token: false } },
  { value: { step: "ring", ring: "2", positions: ["201", "202", "211"], token: false } },
  { value: { step: "ring", ring: "3", positions: ["302", "303"], token: false } },
  { value: { step: "ring", ring: "corners", positions: [], token: false } },
  { value: null },
];

void test("the engine's activation menu lists every system it leads to, and that Warfare spends no token", () => {
  const offer = engineActivation(warfareMenu)!;
  assert.deepEqual([...offer.positions].sort(), ["000", "201", "202", "211", "301", "302", "303"]);
  assert.equal(offer.token, false);
});

void test("Warfare: offered systems are activatable with 0 tactic tokens and my own token there", () => {
  const offer = engineActivation(warfareMenu)!;
  assert.deepEqual(offeredActivation("302", offer, { hasMyToken: false, tacticTokens: 0 }), { ok: true });
  assert.deepEqual(offeredActivation("211", offer, { hasMyToken: true, tacticTokens: 0 }), { ok: true });
  assert.equal(offeredActivation("104", offer, { hasMyToken: false, tacticTokens: 0 }).ok, false);
});

void test("a normal activation keeps the telling reasons for systems the menu leaves out", () => {
  const offer = engineActivation([{ value: { step: "ring", ring: "1", positions: ["101"] } }])!;
  assert.equal(offer.token, true);
  assert.deepEqual(offeredActivation("102", offer, { hasMyToken: true, tacticTokens: 2 }), { ok: false, reason: "Your command token is already here" });
  assert.deepEqual(offeredActivation("101", offer, { hasMyToken: false, tacticTokens: 2 }), { ok: true });
});

void test("disabled options and an empty menu offer nothing (the usual rules apply)", () => {
  assert.equal(engineActivation([{ disabled: true, value: { step: "system", position: "000" } }]), null);
  assert.equal(engineActivation(undefined), null);
});

void test("the inline confirm says Warfare places no token", () => {
  assert.deepEqual(activateClick("302", true, null, "Mehar Xull", false), {
    kind: "offer",
    position: "302",
    label: "Activate Mehar Xull (no command token placed)",
  });
});

/* Playtest 8, pbd469 round 3: Mentak's 2nd turn (Leadership done on the 1st). The engine's start-of-turn menu is what
   lets the map start a tactical action, even when a bot's leftover prompt hides the turn message from the scan. */
const opt = (value: unknown, disabled = false) => ({ disabled, value });
void test("pbd469: the start-of-turn menu with a live Tactical action is a start menu", () => {
  const menu = {
    kind: "turn.action",
    options: [
      opt({ action: "tactical", tacticTokens: 9 }),
      opt({ action: "component" }),
      opt({ action: "strategic", strategyCard: 6 }),
      opt(null),
      opt(null),
    ],
  };
  assert.equal(isStartMenu(menu), true);
});

void test("the post-action menu (End turn / another action) and a disabled Tactical action are not start menus", () => {
  assert.equal(isStartMenu({ kind: "turn.action", options: [opt({ action: "end_turn", abilities: false }), opt({ action: "another_action" })] }), false);
  assert.equal(isStartMenu({ kind: "turn.action", options: [opt({ action: "tactical", tacticTokens: 0 }, true), opt({ action: "component" })] }), false);
  assert.equal(isStartMenu({ kind: "tactical.activate", options: [opt({ action: "tactical", tacticTokens: 3 })] }), false);
});
