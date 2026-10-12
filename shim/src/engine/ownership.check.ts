/**
 * Who answers a message while the engine stream is live (engineOwnership): the typed engine path, or the legacy rule
 * table / planner / last resort. `npx tsx src/engine/ownership.check.ts` (exits 1 on failure).
 *
 * Live shape (shim.log, 01:29–01:59): 41% of bot presses still went through the legacy autopilot — "Not Following"
 * pressed after the engine had declined the card, "Pass" pressed while the turn policy held the menu for the planner,
 * status scoring / homework re-answered by the planner, "Done Removing" / "Done Resolving" as the last resort while
 * the watchdog's fallback was due — and the rule table / planner won the race against a decision not yet mirrored.
 */
import assert from "node:assert/strict";
import { chooseTyped, ENGINE_GRACE_MS, engineOwnership } from "./autopilot.js";
import type { Decision, GameState, Option } from "./types.js";

const ME = "u1";
const OTHER = "u2";
const NOW = 1_800_000_000_000;
const snow = (at: number) => ((BigInt(at) - 1420070400000n) << 22n).toString();

const opt = (id: string, value: unknown, label = id): Option<any> => ({
  id, label, style: "secondary", emoji: null, disabled: false, needsInput: false, handler: id.replace(/^FFCC_[^_]+_/, ""), value: value as any,
});
const dec = (kind: string, options: Option<any>[], extra: Partial<Decision> = {}): Decision =>
  ({
    id: "d1", game: "g1", kind, seq: 1, stateVersion: 1, revision: 1, window: null, progress: null, inputs: null,
    target: { userId: ME, faction: "hacan", color: "spring", resolvedBy: "owner_prefix" },
    scope: "player", visibility: "public", prompt: "", options, createdAt: NOW - 2_000,
    source: { channelId: "c", messageId: "m1", customIdPrefix: null, ephemeral: false },
    ...extra,
  }) as Decision;
const player = (userId: string, faction: string, extra: Record<string, unknown> = {}) => ({
  userId, userName: userId, faction, color: "spring", real: true, passed: false, planets: [], techs: [], strategyCards: [],
  commandTokens: { tactic: 3, fleet: 3, strategy: 2 }, commodities: 0, commoditiesMax: 4, secretObjectiveCount: 1, secretsScored: {},
  ...extra,
});
const state = (extra: Partial<GameState> = {}): GameState =>
  ({
    contract: 1, game: "g1", stateVersion: 1, seq: 1, phase: "action", round: 2, activePlayer: ME, speaker: ME,
    players: [player(ME, "hacan"), player(OTHER, "sol")], strategyCards: [], tiles: [], publicObjectives: {}, laws: [], draft: null,
    ...extra,
  }) as unknown as GameState;
const owns = (d: Decision | undefined, st: GameState | null = state(), messageId = "m1", open: Decision[] = d ? [d] : []) =>
  engineOwnership(d, messageId, ME, st, open, NOW);

// ---- a message the mirror has not captured (yet)
assert.equal(owns(undefined, null, snow(NOW - 2_000)).owned, true, "fresh message: its decision may be on the way");
assert.equal(owns(undefined, null, snow(NOW - 3_600_000)).owned, true, "closed decision, buttons left over (old card's Not Following)");
assert.equal(owns(dec("legacy", [opt("x", null)])).owned, false, "untyped decision: legacy");

// ---- "Not Following" (live pbd161: engine declined at 01:29:43, legacy pressed again at 01:29:51)
const scWindow = (responded: string[], eligible = [ME, OTHER]) => ({ kind: "strategy_card", eligible, responded, subject: { strategyCard: 7, holder: "sol" }, responses: {} }) as any;
const scValue = (action: string) => ({ strategyCard: 7, name: "Technology", card: "pok7technology", holder: "sol", action, who: action === "decline" ? "others" : "anyone", spendsToken: false, part: null, primaryParts: ["research"], copy: false });
const sc = (responded: string[], eligible?: string[]) =>
  dec("strategy_card.resolve", [opt("sc_follow_7", scValue("follow"), "Spend A Strategy Token"), opt("sc_no_follow_7", scValue("decline"), "Not Following")], {
    scope: "table", target: null, window: scWindow(responded, eligible),
  });
assert.equal(owns(sc([ME])).owned, true, "answered by the engine: nothing left to press");
assert.equal(owns(sc([])).owned, true, "awaiting us: the strategy policy declines it");
assert.equal(chooseTyped(sc([]), state(), ME)?.option?.id, "sc_no_follow_7");
assert.equal(owns(sc([], [OTHER])).owned, true, "not asked (pre-declined): nobody waits on us");
assert.equal(owns(sc([]), state(), "m1").why.includes("not following"), true);

// ---- the holder's own card, primary resolved (live pbd158: the planner pressed "Get a Technology" again after the
// engine had researched): not awaited by the followers' window, nothing left for the engine → still not legacy's
const holderSt = state({ players: [player(ME, "sol", { strategyCards: [7] }), player(OTHER, "hacan")] } as Partial<GameState>);
const held = dec("strategy_card.resolve", [opt("acquireATechWithSC_first", { ...scValue("research"), holder: "sol", who: "holder", part: "research" }, "Get a Technology")], {
  scope: "table", target: null, window: { ...scWindow([], [OTHER]), subject: { strategyCard: 7, holder: "sol", primaryDone: ["research"] } },
});
assert.equal(chooseTyped(held, holderSt, ME, { history: [], open: [], all: [held], force: true }), null);
assert.equal(owns(held, holderSt).owned, true);

// ---- "Pass": the start-of-turn menu while the turn policy holds it for the planner (TURN_PLANNER_GRACE_MS)
const turn = (createdAt = NOW - 2_000) =>
  dec("turn.action", [
    opt("FFCC_hacan_tacticalAction", { action: "tactical", tacticTokens: 3 }, "Tactical Action (3)"),
    opt("FFCC_hacan_passForRound", { action: "pass", abilities: false }, "Pass"),
  ], { createdAt });
assert.equal(chooseTyped(turn(), state(), ME, { history: [], open: [], all: [], waitedMs: 2_000 }), null, "the planner's grace: the policy holds it");
assert.equal(owns(turn()).owned, true, "held on purpose is still the engine's (it passes after the grace)");
assert.equal(owns(turn(), state({ activePlayer: OTHER } as Partial<GameState>)).owned, true, "a stale menu: nobody presses it");
assert.equal(owns(turn(NOW - ENGINE_GRACE_MS - 1)).owned, false, "outlived the grace: the legacy rules may help");

// ---- "End Turn" on the end-of-turn menu (turnEnd, typed turn.action end_turn): the turn policy holds it on purpose
const wait = [{ strategyCard: 4, name: "Construction", factions: ["sol"], userIds: [OTHER] }];
const endMenu = (createdAt = NOW - 2_000, waitingFor: unknown[] = []) =>
  dec("turn.action", [
    opt("FFCC_hacan_turnEnd", { action: "end_turn", abilities: false, waitingFor }, "End Turn"),
    opt("FFCC_hacan_endTurnWhenAllReactedTo_4", { action: "end_turn_when_followed", strategyCard: 4, waitingFor }, "End Turn When All Have Reacted"),
  ], { createdAt });
assert.equal(chooseTyped(endMenu(), state(), ME)?.option?.id, "FFCC_hacan_turnEnd", "End Turn is answerable as a typed decision");
assert.equal(owns(endMenu()).owned, true);
// follows pending (ScFollowGate): live pbd266 20:08, legacy "End Turn" pressed 3x past the grace, refused each time
assert.equal(owns(endMenu(NOW - 2_000, wait)).owned, true, "follows pending: the engine refuses the end; nobody presses");
assert.equal(owns(endMenu(NOW - ENGINE_GRACE_MS - 1, wait)).owned, true, "follows pending past the grace: still not the legacy rule's");
// our action under way: live pbd41 20:17, legacy "End Turn" 3 s after Warfare's redistribute ended the turn mid-action
const redistribute = dec("command_tokens.adjust", [opt("FFCC_hacan_deleteButtons~ccredist", { action: "done" }, "Done Redistributing Command Tokens")], { id: "d2", source: { channelId: "c", messageId: "m2", customIdPrefix: null, ephemeral: false } });
assert.equal(owns(endMenu(), state(), "m1", [endMenu(), redistribute]).owned, true, "mid-action: the policy waits; not freed for the rule table");
assert.equal(owns(endMenu(NOW - ENGINE_GRACE_MS - 1), state(), "m1", [endMenu(), redistribute]).owned, true, "mid-action past the grace");
assert.equal(owns(turn(NOW - ENGINE_GRACE_MS - 1), state(), "m1", [turn(), redistribute]).owned, true, "no legacy Pass mid-action either");
assert.equal(owns(endMenu(NOW - ENGINE_GRACE_MS - 1), state({ activePlayer: OTHER } as Partial<GameState>)).owned, true, "past the grace, not our turn");
assert.equal(owns(endMenu(NOW - ENGINE_GRACE_MS - 1)).owned, false, "nothing holds it, the engine failed to end the turn: legacy may help");
assert.equal(owns(endMenu(NOW - ENGINE_GRACE_MS - 1, wait), null).owned, false, "no state (engine unreadable): the usual grace");

// ---- another player's prompt (e.g. the speaker's Reveal Stage 1): the engine's, until the grace runs out
const theirs = (createdAt = NOW - 2_000) => dec("status.reveal_objective", [opt("reveal_stage_1", { action: "reveal", stage: 1 }, "Reveal Stage 1")], { createdAt, target: { userId: OTHER, faction: "sol", color: "red", resolvedBy: "speaker" } as any });
assert.equal(owns(theirs()).owned, true);
assert.equal(owns(theirs(NOW - ENGINE_GRACE_MS - 1)).owned, false, "a person who never reveals: the rule table may help");

// ---- status scoring / homework the planner re-answered
const homework = (responded: string[]) =>
  dec("status.homework", [opt("pass_on_abilities", { action: "ready", next: "strategy" }, "Ready For Strategy Phase")], {
    scope: "table", target: null, window: { kind: "status_homework", eligible: [ME, OTHER], responded, subject: {} } as any,
  });
assert.equal(owns(homework([ME])).owned, true, "ready already: no second \"Ready For Strategy Phase\"");
assert.equal(owns({ ...homework([]), window: null }).owned, true, "window closed (pbd184): a leftover, not the rule table's");

// ---- "Done Removing": a removal menu the specific policy leaves (no progress); the watchdog's fallback closes it
const removal = dec("combat.assign_units", [
  opt("FFCC_firmament_assignHits_315_1_gf_bereg_blue", { action: "destroy", tile: "315", count: 1, unit: "gf", holder: "bereg", damaged: false, state: "none", assignType: "bombardment" }, "Remove 1 Infantry from Bereg"),
  opt("deleteButtons", { action: "done", tile: null, assignType: "bombardment" }, "Done Removing/Sustaining Units"),
]);
assert.equal(chooseTyped(removal, state(), ME, { history: [], open: [], all: [], waitedMs: 10_000 }), null);
assert.equal(owns(removal).owned, true, "the fallback is due (forced): not the legacy last resort");

// ---- "Done Resolving": the plastic-limit warning, typed as choose.unit source remove_unit_type
const plastic = dec("choose.unit", [
  opt("removeThisTypeOfUnit_Space Dock_103_arnor_spring", { source: "remove_unit_type", unit: "Space Dock", tile: "103", holder: "arnor", color: "spring" }, "Space Dock from 103 (Arnor/Lor) On Arnor"),
  opt("deleteButtons", null, "Done Resolving"),
  opt("ultimateUndo_715", null, "UNDO"),
], { target: { userId: ME, faction: "hacan", color: "spring", resolvedBy: "mention" } });
assert.equal(chooseTyped(plastic, state(), ME)?.option?.id, "deleteButtons", "keep the units, like the rule table did");
assert.equal(owns(plastic).owned, true);

// ---- an optional offer no policy answers: the legacy rules keep it
assert.equal(owns(dec("action_card.play", [opt("ac_play_from_hand_1", { card: "x" }, "(1) Sabotage")])).owned, false);
// ---- affordances: never pressed by a bot (live: "Edit Summaries" pressed as the rule table's "only option")
assert.equal(owns(dec("ui.optional", [opt("editRoundSummary_1~MDL", { action: "round_summary", undoes: null, ref: "1" })], { createdAt: NOW - 3_600_000 })).owned, true);

console.log("ownership.check: ok");
