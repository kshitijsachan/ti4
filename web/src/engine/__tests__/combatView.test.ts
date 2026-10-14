/// <reference types="node" />
/** Run: `../shim/node_modules/.bin/tsx --test src/engine/__tests__/combatView.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision, GameState } from "../contract";
import type { HittableUnit } from "../../../../shim/src/engine/kinds/combat";
import { combatView, decisionTile, hitRefusal, ineligibleUnits, lossesBetween } from "../renderers/combat/combatView";

const ME = "u1";
const BOT = "u2";
const names = (who: string) => (who === "letnev" || who === BOT ? "Bot" : who === "sol" || who === ME ? "Me" : who);

const unit = (u: string, count: number, damaged = 0, holder = "space") => ({ holder, unit: u, count, damaged, sustain: u === "dn" }) as HittableUnit;

function state(over: Record<string, unknown> = {}): GameState {
  return {
    players: [
      { userId: ME, userName: "Me", faction: "sol", self: true },
      { userId: BOT, userName: "Bot", faction: "letnev", self: false },
    ],
    tiles: [
      {
        position: "305",
        tileId: "26",
        holders: [
          {
            name: "space",
            units: [
              { owner: "sol", unit: "cv", count: 1, damaged: 0 },
              { owner: "sol", unit: "gf", count: 2, damaged: 0 },
              { owner: "letnev", unit: "dn", count: 1, damaged: 0 },
            ],
          },
          { name: "lodor", units: [{ owner: "sol", unit: "pd", count: 1, damaged: 0 }, { owner: "sol", unit: "gf", count: 1, damaged: 0 }] },
        ],
      },
    ],
    combat: {
      tile: "305",
      tileId: "26",
      factions: ["letnev", "sol"],
      attacker: "letnev",
      fronts: [
        {
          holder: "space",
          sides: [
            { faction: "sol", userId: ME, roundsRolled: 1, units: [unit("cv", 1)], abilities: [] },
            { faction: "letnev", userId: BOT, roundsRolled: 1, units: [unit("dn", 1, 1)], abilities: [] },
          ],
        },
      ],
      spaceCannonOffence: [],
      owed: [],
      rolls: [
        { at: 10, faction: "letnev", opponent: "sol", tile: "305", holder: "space", rollType: "combat", round: 1, hits: 1, units: [unit("dn", 1)], dice: [{ unit: "dn", threshold: 5, results: [3, 8] }] },
        { at: 11, faction: "sol", opponent: "letnev", tile: "305", holder: "space", rollType: "combat", round: 1, hits: 1, units: [unit("cv", 1), unit("dd", 1)], dice: [{ unit: "cv", threshold: 9, results: [9] }, { unit: "dd", threshold: 9, results: [2] }] },
      ],
      ...over,
    },
  } as unknown as GameState;
}

const rollPrompt = (responded: string[], waitingFor?: string): Decision =>
  ({
    id: "r1",
    kind: "combat.round",
    scope: "table",
    target: null,
    window: { kind: "combat_roll", subject: { tile: "305", holder: "space", rollType: "combat", ...(waitingFor ? { waitingFor } : {}) }, eligible: [ME, BOT], responded, responses: {} },
    options: [{ id: "combatRoll_305_space", label: "Roll", disabled: false, needsInput: false, value: { action: "roll", tile: "305", holder: "space", rollType: "combat" } }],
  }) as unknown as Decision;

const controls = (blocked: string | null): Decision =>
  ({
    id: "c1",
    kind: "combat.round",
    scope: "table",
    target: null,
    window: null,
    options: [
      { id: "FFCC_sol_getAgentSelection_solagent", label: "Use Sol Agent", disabled: false, needsInput: false, value: { action: "ability", tile: "305", ability: "solagent", source: "agent", owner: "sol", name: "Evelyn Delouis", window: "At the start of a ground combat round", blocked } },
      { id: "FFCC_letnev_getAgentSelection_letnevagent", label: "Use Letnev Agent", disabled: false, needsInput: false, value: { action: "ability", tile: "305", ability: "letnevagent", source: "agent", owner: "letnev", name: "Viscount", window: null, blocked: null } },
      { id: "announceARetreat", label: "Announce retreat", disabled: false, needsInput: false, value: { action: "announce_retreat", tile: "305" } },
    ],
  }) as unknown as Decision;

void test("rounds: both sides' dice, hits lit, losses from the next snapshot", () => {
  const v = combatView(state(), [rollPrompt([])], ME, names)!;
  const f = v.current!;
  assert.equal(f.holder, "space");
  assert.equal(f.round, 2);
  assert.equal(f.sides[0].faction, "letnev", "attacker first");
  const r1 = f.rounds[0];
  assert.equal(r1.rolls.length, 2);
  const mine = r1.rolls.find((r) => r.faction === "sol")!;
  assert.deepEqual(mine.dice.map((d) => d.hit), [true, false]);
  assert.deepEqual(mine.losses, [{ unit: "dd", destroyed: 1, sustained: 0 }]);
  const theirs = r1.rolls.find((r) => r.faction === "letnev")!;
  assert.deepEqual(theirs.losses, [{ unit: "dn", destroyed: 0, sustained: 1 }]);
  assert.match(v.log.join("\n"), /Space R1 · Bot 1 hit · You 1 hit — Bot lost 1 dn sustained; You lost 1 dd/);
});

void test("step: my roll, their roll, blocked, assign, wait for their assignment, over", () => {
  assert.equal(combatView(state(), [rollPrompt([])], ME, names)!.step.text, "Roll for round 2");
  assert.equal(combatView(state(), [rollPrompt([ME])], ME, names)!.step.text, "Waiting for Bot to roll round 2");
  assert.equal(combatView(state(), [rollPrompt([], "letnev must assign 1 hit(s) first")], ME, names)!.step.kind, "blocked");
  const owedMe = state({ owed: [{ faction: "sol", userId: ME, tile: "305", holder: "space", source: "space", hits: 2, assigned: 0, decisionId: "h1" }] });
  const hits = { id: "h1", kind: "combat.hits", target: { userId: ME }, window: null, options: [] } as unknown as Decision;
  const a = combatView(owedMe, [rollPrompt([]), hits], ME, names)!;
  assert.equal(a.step.text, "Your turn: assign 2 hits to your ships (space combat)");
  assert.equal(a.step.decision?.id, "h1");
  const owedBot = state({ owed: [{ faction: "letnev", userId: BOT, tile: "305", holder: "space", source: "afb", hits: 1, assigned: 0, decisionId: "h2" }] });
  assert.equal(combatView(owedBot, [], ME, names)!.step.text, "Waiting for Bot to assign 1 hit (anti-fighter barrage)");
  const over = state();
  over.combat!.fronts[0].sides[1].units = [];
  const o = combatView(over, [], ME, names)!;
  assert.equal(o.step.kind, "over");
  assert.equal(o.step.text, "You win the space combat (round 1)");
});

void test("both roll, then both assign: behind on rounds, the roll comes before the hits", () => {
  const behindState = state({ owed: [{ faction: "sol", userId: ME, tile: "305", holder: "space", source: "space", hits: 1, assigned: 0, decisionId: "h1" }] });
  behindState.combat!.fronts[0].sides[0].roundsRolled = 0;
  const hits = { id: "h1", kind: "combat.hits", target: { userId: ME }, window: null, options: [] } as unknown as Decision;
  const v = combatView(behindState, [rollPrompt([BOT]), hits], ME, names)!;
  assert.equal(v.step.kind, "roll");
  assert.equal(v.step.text, "Roll for round 1, then assign 1 hit");
});

void test("abilities: mine (greyed reason kept), never another faction's; roll offered only for the step", () => {
  const v = combatView(state(), [rollPrompt([]), controls("the agent is exhausted")], ME, names)!;
  assert.deepEqual(v.abilities.map((a) => a.option.value), [
    { action: "ability", tile: "305", ability: "solagent", source: "agent", owner: "sol", name: "Evelyn Delouis", window: "At the start of a ground combat round", blocked: "the agent is exhausted" },
  ]);
  assert.deepEqual(v.controls.map((c) => c.option.id), ["announceARetreat"]);
  assert.deepEqual(v.rolls.map((r) => r.option.id), ["combatRoll_305_space"]);
});

void test("hit rules mirror: transported infantry and planet units never take space hits; AFB fighters only; ground no structures", () => {
  assert.equal(hitRefusal("cv", "space", "space"), null);
  assert.match(hitRefusal("gf", "space", "space")!, /transported/);
  assert.match(hitRefusal("gf", "lodor", "space")!, /planet/);
  assert.equal(hitRefusal("ff", "space", "afb"), null);
  assert.match(hitRefusal("dd", "space", "afb")!, /fighters only/);
  assert.equal(hitRefusal("gf", "lodor", "ground"), null);
  assert.match(hitRefusal("pd", "lodor", "ground")!, /structures/);
  const off = ineligibleUnits(state(), "305", "space", "space", ME);
  assert.deepEqual(off.map((u) => `${u.holder}/${u.unit}`), ["space/gf", "lodor/pd", "lodor/gf"]);
  assert.deepEqual(ineligibleUnits(state(), "305", "lodor", "ground", ME).map((u) => u.unit), ["pd"]);
});

void test("a combat outside the active system: picked by the prompt's system, or as the one I fight in", () => {
  const st = state();
  const other = { ...st.combat!, tile: "201", tileId: "25", rolls: [], owed: [], attacker: null };
  st.combat = { ...st.combat!, tile: "101", fronts: [], rolls: [], elsewhere: [other] } as typeof st.combat;
  assert.equal(combatView(st, [], ME, names, "201")?.tile, "201");
  assert.equal(combatView(st, [], ME, names)?.tile, "201", "the combat I am in");
  assert.equal(combatView(st, [], ME, names, "999"), null);
  const prompt = { ...rollPrompt([]), window: { ...rollPrompt([]).window!, subject: { tile: "201", holder: "space", rollType: "combat" } } } as unknown as Decision;
  assert.equal(decisionTile(prompt), "201");
  assert.equal(decisionTile(controls(null)), null, "ability / announce tiles come from the active system: no tile");
});

void test("lossesBetween counts destroyed and newly damaged", () => {
  assert.deepEqual(lossesBetween([unit("dn", 2), unit("ff", 3)], [unit("dn", 2, 1), unit("ff", 1)]), [
    { unit: "dn", destroyed: 0, sustained: 1 },
    { unit: "ff", destroyed: 2, sustained: 0 },
  ]);
});
