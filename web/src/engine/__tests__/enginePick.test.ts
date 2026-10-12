/// <reference types="node" />
/** Run: `../shim/node_modules/.bin/tsx --test src/engine/__tests__/enginePick.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision, GameState } from "../contract";
import { mapTargets } from "../../mapactions/enginePick";
import { buttonOutcome } from "../../decisions/model/phrasing";

const opt = (id: string, value: unknown, disabled = false) => ({ id, label: id, style: "primary", emoji: null, disabled, needsInput: false, handler: id, value });
const dec = (kind: string, options: unknown[]) => ({ id: "d1", kind, options }) as unknown as Decision;
const state = {
  tiles: [
    { position: "313", tileId: "x", holders: [{ name: "space" }, { name: "muaat" }] },
    { position: "205", tileId: "y", holders: [{ name: "space" }, { name: "a" }, { name: "b" }] },
  ],
} as unknown as GameState;
const name = (p: string) => p.toUpperCase();

void test("Umbat's system answers from the map (one option is enough)", () => {
  const t = mapTargets(dec("leader.use", [opt("exhaustAgent_umbat_313", { tile: "313", leader: "muaatagent" }), opt("undo", null)]), state, name);
  assert.deepEqual(t, { "313": [{ optionId: "exhaustAgent_umbat_313", label: "Choose system 313" }] });
});

void test("Construction: a planet maps to its system; two planets of one system are two choices there", () => {
  const t = mapTargets(
    dec("strategy_card.construction_place", [
      opt("pds_muaat", { unit: "pds", planet: "muaat", tile: null }),
      opt("pds_a", { unit: "pds", planet: "a", tile: null }),
      opt("pds_b", { unit: "pds", planet: "b", tile: "205" }),
      opt("pds_gone", { unit: "pds", planet: "zz", tile: null }),
      opt("pds_off", { unit: "pds", planet: "muaat", tile: null }, true),
    ]),
    state,
    name,
  );
  assert.deepEqual(t, {
    "313": [{ optionId: "pds_muaat", label: "Place a PDS on MUAAT" }],
    "205": [
      { optionId: "pds_a", label: "Place a PDS on A" },
      { optionId: "pds_b", label: "Place a PDS on B" },
    ],
  });
});

void test("kinds that are not picked on the map publish nothing", () => {
  assert.equal(mapTargets(dec("tech.gain", [opt("t", { tile: "313" })]), state, name), null);
});

void test("Imperial's 'Score A Public' only opens the list: no 'Scored' toast", () => {
  assert.equal(buttonOutcome("scoreAnObjective", "Score A Public"), "Choosing a public objective to score…");
});
