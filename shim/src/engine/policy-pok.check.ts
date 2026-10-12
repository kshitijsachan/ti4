/** Sanity checks for the PoK faction step policy: `npx tsx src/engine/policy-pok.check.ts` (exits 1 on failure). */
import assert from "node:assert/strict";
import { chooseTyped } from "./autopilot.js";
import type { Decision, GameState, Option } from "./types.js";

const ME = "u1";
const opt = (id: string, value: unknown, handler = id.replace(/^FFCC_[a-z]+_/, "")): Option<any> => ({
  id, label: id, style: "success", emoji: null, disabled: false, needsInput: false, handler, value: value as any,
});
const dec = (kind: string, options: Option<any>[], userId = ME): Decision =>
  ({
    id: "d1", game: "g1", kind, seq: 1, stateVersion: 1, revision: 1, window: null, progress: null,
    target: { userId, faction: "titans", color: "pink", resolvedBy: "owner_prefix" },
    scope: "player", visibility: "public", prompt: "", options, createdAt: 0,
    source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false },
  }) as Decision;
const st = (faction: string, color: string, tiles: unknown[] = [], combat: unknown = null) =>
  ({ players: [{ userId: ME, faction, color, tg: 3, planets: [], techs: [] }], tiles, combat, strategyCards: [] }) as unknown as GameState;
const ab = (step: string, id: string, extra: Record<string, unknown> = {}) => ({ source: "ability", id, faction: "x", step, action: "target", optional: false, ...extra });
const decline = opt("deleteButtons", null);
const pick = (d: Decision, s: GameState) => chooseTyped(d, s, ME, { history: [], open: [], all: [d] })?.option?.id;

// Awaken prefers mech + infantry.
assert.equal(pick(dec("faction.ability", [opt("FFCC_titans_replaceSleeperWith_pds_p", ab("replaceSleeperWith", "awaken", { unit: "pds", optional: true })), opt("FFCC_titans_replaceSleeperWith_mech_p", ab("replaceSleeperWith", "awaken", { unit: "mech", optional: true })), decline]), st("titans", "pink")), "FFCC_titans_replaceSleeperWith_mech_p");
// Terragenesis: place the sleeper (not decline).
assert.equal(pick(dec("faction.ability", [opt("putSleeperOnPlanet_p", ab("putSleeperOnPlanet", "terragenesis", { optional: true, action: "use" })), decline]), st("titans", "pink")), "putSleeperOnPlanet_p");
// Imperia: lose another player's token before our own.
assert.equal(pick(dec("faction.ability", [opt("loseMahactCC_pink", ab("loseMahactCC", "imperia", { color: "pink" })), opt("loseMahactCC_red", ab("loseMahactCC", "imperia", { color: "red" }))]), st("mahact", "pink")), "loseMahactCC_red");
// Edict: wait during combat; take the token once we hold the space and they have nothing there.
const steal = dec("faction.ability", [opt("mahactStealCC_red", ab("mahactStealCC", "edict", { color: "red", action: "use", optional: true }))]);
assert.equal(chooseTyped(steal, st("mahact", "pink", [], { active: true }), ME, { history: [], open: [], all: [] }), null);
const won = [{ position: "101", tileId: "1", holders: [{ name: "space", tokens: [], control: [], units: [{ owner: "mahact", color: "pink", unit: "dn", count: 1, damaged: 0 }] }] }];
assert.equal(pick(steal, st("mahact", "pink", won)), "mahactStealCC_red");
// Cabal agent: capture the most expensive unit.
const cap = (u: string) => opt(`cabalAgentCapture_${u}_xxcha`, { leader: "cabalagent", leaderType: "agent", faction: "cabal", step: "cabalAgentCapture", action: "target", optional: false, unit: u, target: "xxcha" });
assert.equal(pick(dec("leader.use", [cap("fighter"), cap("dreadnought"), cap("cruiser")]), st("cabal", "black")), "cabalAgentCapture_dreadnought_xxcha");
// Cabal agent offer: use it.
assert.equal(pick(dec("leader.use", [opt("exhaustAgent_cabalagent_startCabalAgent_xxcha", { leader: "cabalagent", leaderType: "agent", faction: "cabal", step: "exhaustAgent", action: "target", optional: true }), decline]), st("cabal", "black")), "exhaustAgent_cabalagent_startCabalAgent_xxcha");
// TCS: decline readying another faction's agent; never spend a token for it.
assert.equal(pick(dec("faction.ability", [opt("exhaustTCS_hacanagent_hacan", ab("exhaustTCS", "tcs", { leader: "hacanagent", action: "use", optional: true })), decline]), st("nomad", "blue")), "deleteButtons");
// Never another seat's decision.
assert.equal(chooseTyped(dec("faction.ability", [opt("putSleeperOnPlanet_p", ab("putSleeperOnPlanet", "terragenesis")), decline], "u2"), st("titans", "pink"), ME, { history: [], open: [], all: [] }), null);
console.log("policy-pok.check: PASS");
