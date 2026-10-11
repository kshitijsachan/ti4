/** Sanity checks for the components policy (C6): `npx tsx src/engine/policy/components.check.ts` (exits 1 on failure). */
import assert from "node:assert/strict";
import { chooseTyped } from "../autopilot.js";
import type { Decision, GameState, Option } from "../types.js";

const ME = "u1";
const opt = (id: string, value: unknown): Option<any> => ({
  id, label: id, style: "success", emoji: null, disabled: false, needsInput: false, handler: id, value: value as any, owner: null,
});
const base = (kind: string, options: Option<any>[], extra: Partial<Decision> = {}): Decision =>
  ({
    id: "d1", game: "g1", kind, seq: 1, stateVersion: 1, revision: 1, window: null, progress: null, inputs: null,
    target: { userId: ME, faction: "hacan", color: "yellow", resolvedBy: "owner_prefix" },
    scope: "player", visibility: "public", prompt: "", options, createdAt: 0,
    source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false },
    ...extra,
  }) as Decision;
const state = {
  players: [
    { userId: ME, faction: "hacan", tg: 2, commodities: 3, commoditiesMax: 6, planets: ["arretze"], techs: [], relics: [] },
    { userId: "u2", faction: "sol", tg: 0, commodities: 0, commoditiesMax: 4, planets: ["jord"], techs: [], relics: [] },
  ],
} as unknown as GameState;
const pick = (d: Decision) => chooseTyped(d, state, ME)?.option?.id;

// Component menu: fragments → relic, else cancel.
assert.equal(pick(base("component.action", [opt("a", { component: "tech", id: "sar" }), opt("b", { component: "getRelic", id: null }), opt("x", null)])), "b");
assert.equal(pick(base("component.action", [opt("a", { component: "leader", id: "hacanagent" }), opt("x", null)])), "x");
// Agent: optional offer → decline; "who uses it" → ourselves.
assert.equal(pick(base("leader.agent", [opt("a", { leader: "saaragent", faction: null, args: [] }), opt("no", null)])), "no");
assert.equal(
  pick(base("leader.agent", [opt("s", { leader: "saaragent", faction: "sol", args: ["sol"] }), opt("h", { leader: "saaragent", faction: "hacan", args: ["hacan"] })])),
  "h",
);
// Relics.
assert.equal(pick(base("relic.use", [opt("ac", { relic: "prophetstears", effect: "draw_action_card" }), opt("ts", { relic: "prophetstears", effect: "tech_skip" })])), "ac");
assert.equal(pick(base("relic.use", [opt("l", { relic: null, effect: "look_relic_deck" }), opt("no", null)])), "no");
// Choose kinds.
assert.equal(pick(base("choose.amount", [opt("c", { source: "commodities", effect: "convert_commodities", amount: 2 }), opt("g", { source: "commodities", effect: "gain_commodities", amount: 2 })])), "c");
assert.equal(pick(base("choose.planet", [opt("mine", { source: "stellarconverter", planet: "arretze" }), opt("theirs", { source: "stellarconverter", planet: "jord" })])), "theirs");
assert.equal(pick(base("choose.planet", [opt("theirs", { source: "nanoforge", planet: "jord" }), opt("mine", { source: "nanoforge", planet: "arretze" })])), "mine");
assert.equal(pick(base("choose.player", [opt("h", { source: "quantum_entangler", faction: "hacan" }), opt("s", { source: "quantum_entangler", faction: "sol" })])), "s");
assert.equal(pick(base("choose.confirm", [opt("p", { source: "thesilverflame", confirm: true, choice: "Purge" }), opt("q", { source: "thesilverflame", confirm: true, choice: "Point" })])), "q");
assert.equal(pick(base("choose.card", [opt("one", { source: "codex", cardType: "action_card", position: 1 }), opt("x", null)])), "one");
// Always answers when only untyped options remain; never answers someone else's prompt.
assert.equal(pick(base("choose.system", [opt("x", null)])), "x");
assert.equal(pick(base("choose.card", [opt("one", { source: "codex", cardType: "action_card" })], { target: { userId: "u2", faction: "sol", color: "red", resolvedBy: "owner_prefix" } })), undefined);
console.log("components policy: ok");
