/// <reference types="node" />
/** Run: `node --test src/mapactions/__tests__/step.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision } from "../../engine/contract.ts";
import { systemChoices, tacticalStep } from "../step.ts";

let seq = 0;
const opt = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  style: "primary",
  emoji: null,
  disabled: false,
  needsInput: false,
  handler: id,
  value,
  ...extra,
});
const decision = (kind: string, options: ReturnType<typeof opt>[], extra: Record<string, unknown> = {}) =>
  ({
    id: `d${++seq}`,
    game: "pbd1",
    kind,
    seq,
    stateVersion: 1,
    target: { userId: "u1", faction: "nomad", color: "blue", resolvedBy: "owner_prefix" },
    scope: "player",
    visibility: "public",
    prompt: "",
    options,
    source: { channelId: "c", messageId: `m${seq}`, customIdPrefix: null, ephemeral: false },
    createdAt: seq,
    revision: 1,
    window: null,
    progress: null,
    inputs: null,
    ...extra,
  }) as unknown as Decision;

void test("turn menu with a tactical action → turn; the end-turn menu → none", () => {
  const start = decision("turn.action", [opt("tacticalAction", { action: "tactical", tacticTokens: 3 })]);
  assert.equal(tacticalStep([start]).kind, "turn");
  const after = decision("turn.action", [opt("turnEnd", { action: "end_turn", abilities: false })]);
  assert.equal(tacticalStep([start, after]).kind, "none");
});

void test("the newest tactical decision wins; unrelated decisions are skipped", () => {
  const act = decision("tactical.activate", [opt("ringTile_312", { step: "system", position: "312", tileId: "25" })]);
  const move = decision("tactical.move", [opt("concludeMove_312", { action: "done", position: "312", tileId: "25" })]);
  const card = decision("cards.window", [opt("x", null)]);
  const step = tacticalStep([act, move, card]);
  assert.equal(step.kind, "move");
  assert.equal(step.kind === "move" && step.target, "312");
  assert.equal(tacticalStep([act]).kind, "choose");
});

void test("landing reads its target from the land options; later steps end the map's part", () => {
  const land = decision("tactical.land", [
    opt("landUnits_312_1gf_tarmann_blue", { op: "land", position: "312", planet: "tarmann", unit: "gf", count: 1, damaged: false, color: "blue", owner: "nomad" }),
  ]);
  const step = tacticalStep([land]);
  assert.equal(step.kind === "land" && step.target, "312");
  const conclude = decision("tactical.conclude", [opt("doneWithTacticalAction", { action: "conclude", position: "312", frontierExplore: false })]);
  assert.equal(tacticalStep([land, conclude]).kind, "none");
});

void test("system choices: typed positions, or handler positions the label names", () => {
  const names = { "312": "Tarmann", "313": "Arcturus" };
  const typed = decision("x", [opt("a", { position: "312" }), opt("b", { position: "313" })]);
  assert.deepEqual(Object.keys(systemChoices(typed, names) ?? {}).sort(), ["312", "313"]);
  const legacy = decision("legacy", [
    opt("retreatUnitsFrom_312_313", null, { label: "Retreat to Arcturus" }),
    opt("retreatUnitsFrom_312_201", null, { label: "Retreat to 201" }),
  ]);
  assert.equal(systemChoices(legacy, names), null);
  const one = decision("legacy", [opt("a_312", null, { label: "Tarmann" })]);
  assert.equal(systemChoices(one, names), null);
});
