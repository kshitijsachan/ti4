// Run: cd shim && npx tsx --test src/engine/policy/explore.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseExplore } from "./explore.js";
import type { ExploreOutcome } from "../kinds/explore.js";
import type { GameState, Option } from "../types.js";

const ME = "u1";
const opt = <V>(id: string, value: V | null): Option<V> => ({ id, label: id, style: "success", emoji: null, disabled: false, needsInput: false, handler: id, value });

const outcome = (options: Option<unknown>[]) =>
  ({ id: "d1", game: "g", kind: "explore.outcome", options, target: { userId: ME } }) as unknown as ExploreOutcome;
const state = (tg: number, commodities: number) =>
  ({ players: [{ userId: ME, tg, commodities, commoditiesMax: 3 }] }) as unknown as GameState;

test("Local Fabricators: the mech option marked unavailable is never chosen (falls back to gaining a commodity)", () => {
  const d = outcome([
    opt("resolveLocalFab_mr", { card: "localfabricators", effect: "place_mech", cost: "commodity_or_tg", unavailable: "No mechs in reinforcements" }),
    opt("gain_1_comms", { effect: "gain_commodities", amount: 1 }),
  ]);
  assert.equal(chooseExplore(d, state(2, 1), ME)?.option.id, "gain_1_comms");
});

test("Local Fabricators: payable mech option is chosen", () => {
  const d = outcome([
    opt("resolveLocalFab_mr", { card: "localfabricators", effect: "place_mech", cost: "commodity_or_tg", unavailable: null }),
    opt("gain_1_comms", { effect: "gain_commodities", amount: 1 }),
  ]);
  assert.equal(chooseExplore(d, state(1, 0), ME)?.option.id, "resolveLocalFab_mr");
});
