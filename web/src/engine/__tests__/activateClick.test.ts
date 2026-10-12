/// <reference types="node" />
/** Run: `node --test src/engine/__tests__/activateClick.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activateClick } from "../../mapactions/activateClick.ts";

void test("first click on an activatable system offers its inline confirm, with the token cost", () => {
  assert.deepEqual(activateClick("312", true, null, "Tarmann"), { kind: "offer", position: "312", label: "Activate Tarmann (−1 tactic token)" });
});

void test("a second click on the same system activates it (two clicks, same spot)", () => {
  assert.deepEqual(activateClick("312", true, { kind: "activate", position: "312" }, "Tarmann"), { kind: "confirm", position: "312" });
});

void test("a click on another system moves the confirm there instead of activating", () => {
  assert.equal(activateClick("209", true, { kind: "activate", position: "312" }, "Mehar Xull").kind, "offer");
});

void test("a system I can't activate does nothing (the map's own click still works)", () => {
  assert.deepEqual(activateClick("313", false, null, "Home"), { kind: "ignore" });
  assert.deepEqual(activateClick("313", false, { kind: "activate", position: "313" }, "Home"), { kind: "ignore" });
});
