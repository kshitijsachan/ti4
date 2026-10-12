/// <reference types="node" />
/** Run: `node --test src/engine/__tests__/unitModel.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickUnitModel } from "../renderers/tactical/unitModel.ts";

// The real data order: a homebrew "Infantry II" without upgradesFromUnitId comes before the base Infantry I.
const UNITS = [
  { id: "absol_infantry2", asyncId: "gf", name: "Infantry II", source: "absol", upgradesFromUnitId: "infantry", requiredTechId: "absol_inf2" },
  { id: "baldrick_infantry2", asyncId: "gf", name: "Infantry II", source: "ignis_aurora" },
  { id: "infantry", asyncId: "gf", name: "Infantry I", source: "base" },
  { id: "infantry2", asyncId: "gf", name: "Infantry II", source: "base", upgradesFromUnitId: "infantry", requiredTechId: "inf2" },
  { id: "sol_infantry", asyncId: "gf", name: "Spec Ops I", source: "base", faction: "sol" },
  { id: "sol_infantry2", asyncId: "gf", name: "Spec Ops II", source: "base", faction: "sol", upgradesFromUnitId: "sol_infantry", requiredTechId: "so2" },
];
const name = (owner?: Parameters<typeof pickUnitModel>[2]) => pickUnitModel(UNITS, "gf", owner)?.name;

test("Xxcha without Infantry II research lands Infantry I (playtest 3, pbd203)", () => {
  assert.equal(name({ faction: "xxcha", techs: ["gd", "amd"] }), "Infantry I");
});
test("Infantry II only with inf2", () => {
  assert.equal(name({ faction: "xxcha", techs: ["inf2"] }), "Infantry II");
});
test("faction unit, upgraded by its own tech", () => {
  assert.equal(name({ faction: "sol", techs: [] }), "Spec Ops I");
  assert.equal(name({ faction: "sol", techs: ["so2"] }), "Spec Ops II");
});
test("no owner: base generic unit", () => {
  assert.equal(name(undefined), "Infantry I");
});
