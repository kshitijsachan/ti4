/// <reference types="node" />
/** Run: `../shim/node_modules/.bin/tsx --test src/engine/__tests__/unavailable.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLive, unavailableReason } from "../renderers/explore/types";

const opt = (value: unknown, disabled = false) =>
  ({ id: "resolveLocalFab_mr", label: "Spend 1 Commodity or Trade Good for a Mech", disabled, needsInput: false, value }) as never;

void test("costed option the player cannot pay: visible, disabled with the engine's reason", () => {
  const o = opt({ card: "localfabricators", effect: "place_mech", cost: "commodity_or_tg", unavailable: "Need 1 trade good or commodity" });
  assert.equal(unavailableReason(o), "Need 1 trade good or commodity");
  assert.equal(isLive(o), true); // the option itself is still there (not removed), only greyed out by the reason
});

void test("re-enables when the engine re-reads it as payable (unavailable: null)", () => {
  assert.equal(unavailableReason(opt({ card: "localfabricators", unavailable: null })), null);
  assert.equal(unavailableReason(opt({ effect: "decline" })), null);
  assert.equal(unavailableReason(opt(null)), null);
});

void test("no-mech reason passes through", () => {
  assert.equal(unavailableReason(opt({ unavailable: "No mechs in reinforcements" })), "No mechs in reinforcements");
});
