// Run: cd shim && npx tsx --test src/engine/policy/units.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseTyped } from "../autopilot.js";
import type { Decision, Option } from "../types.js";

const ME = "u1";
const opt = <V>(id: string, value: V | null, handler = id): Option<V> => ({ id, label: id, style: "danger", emoji: null, disabled: false, needsInput: false, handler, value });

function decision(kind: string, options: Option<unknown>[], target: string | null, extra: Record<string, unknown> = {}): Decision {
  return {
    id: "d1", game: "g", kind, seq: 1, stateVersion: 1, revision: 1, createdAt: 0, prompt: "", visibility: "public", inputs: null,
    target: target ? { userId: target, faction: "sol", color: "red", resolvedBy: "owner_prefix" } : null,
    scope: target ? "player" : "table",
    options, source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false }, window: null, progress: null, ...extra,
  } as unknown as Decision;
}

test("units.modify: the bot closes the menu at every step", () => {
  const tiles = decision("units.modify", [
    opt("FFCC_sol_genericModify_101", { action: "tile", tile: "101", allTiles: false, units: 3 }),
    opt("modifyUnitsAllTilesdeleteThisMessage", { action: "all_tiles", tile: null }),
    opt("FFCC_sol_deleteButtons", { action: "done", tile: null }, "deleteButtons"),
  ], ME);
  assert.equal(chooseTyped(tiles, null, ME)?.option?.id, "FFCC_sol_deleteButtons");
  const step = decision("units.modify", [
    opt("FFCC_sol_genericBuild_101", { action: "build", tile: "101", units: 3 }),
    opt("FFCC_sol_getDamageButtons_101_remove", { action: "remove", tile: "101", units: 3 }),
    opt("FFCC_sol_deleteButtons", { action: "done", tile: null }, "deleteButtons"),
  ], ME);
  assert.equal(chooseTyped(step, null, ME)?.option?.id, "FFCC_sol_deleteButtons");
  assert.equal(chooseTyped(step, null, "u2"), null);
});

test("production.produce from Modify Units: build nothing; other contexts stay the planner's", () => {
  const prod = (context: string) =>
    decision("production.produce", [opt("place_cv_101", { unit: "cv", count: 1, holder: "space", tile: "101", cost: 3 }), opt("deleteButtons_x", { action: "done", context })], ME, {
      progress: { flow: "production", step: "select_units", accumulated: {}, required: { context, tile: "101", productionLimit: null }, canCommit: true },
    });
  assert.deepEqual(chooseTyped(prod("genericBuild"), null, ME)?.payload, { units: [] });
  assert.deepEqual(chooseTyped(prod("genericModifyAllTiles"), null, ME)?.payload, { units: [] });
  assert.equal(chooseTyped(prod("tacticalAction"), null, ME), null);
});

test("combat.automate: confirm the opponent's request; leave the optional vote", () => {
  const confirm = decision("combat.automate", [opt("FFCC_sol_automateGroundCombat_sol_hacan_mr_confirmed", { planet: "mr", factions: ["sol", "hacan"], confirmed: true })], ME);
  assert.equal(chooseTyped(confirm, null, ME)?.option?.id, "FFCC_sol_automateGroundCombat_sol_hacan_mr_confirmed");
  const vote = decision("combat.automate", [opt("automateGroundCombat_sol_hacan_mr_unconfirmed", { planet: "mr", factions: ["sol", "hacan"], confirmed: false })], null);
  assert.equal(chooseTyped(vote, null, ME), null);
});

test("combat.modifier: apply the action card we just played", () => {
  const mod = decision("combat.modifier", [opt("FFCC_sol_applytempcombatmod__action_cards__mb1", { source: "action_cards", card: "mb1" })], ME);
  assert.equal(chooseTyped(mod, null, ME)?.option?.id, "FFCC_sol_applytempcombatmod__action_cards__mb1");
  assert.equal(chooseTyped(mod, null, "u2"), null);
});

test("strategy_card.construction_build: the dock with the most PRODUCTION", () => {
  const d = decision("strategy_card.construction_build", [
    opt("FFCC_sol_constructionBuild_101", { tile: "101", home: true, productionLimit: 5, spaceDocks: 1 }),
    opt("FFCC_sol_constructionBuild_202", { tile: "202", home: false, productionLimit: 3, spaceDocks: 1 }),
  ], ME);
  assert.equal(chooseTyped(d, null, ME)?.option?.id, "FFCC_sol_constructionBuild_101");
});
