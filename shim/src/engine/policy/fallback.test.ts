// Run: cd shim && npx tsx --test src/engine/policy/fallback.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseTyped } from "../autopilot.js";
import { chooseFallback, fallbackDue, FALLBACK_FORCE_MS, FALLBACK_GRACE_MS, KIND_CLASS } from "./fallback.js";
import type { Decision, DecisionKind, GameState, Option, ReactionWindow } from "../types.js";

const ME = "bot";
const OTHER = "human";

const opt = (id: string, label: string, value: Record<string, unknown> | null = null, extra: Partial<Option<any>> = {}): Option<any> => ({
  id,
  label,
  style: "secondary",
  emoji: null,
  disabled: false,
  needsInput: false,
  handler: id.replace(/^FFCC_[^_]+_/, ""),
  value,
  ...extra,
});

function decision(kind: DecisionKind, options: Option<any>[], extra: Partial<Decision> = {}): Decision {
  return {
    id: `d-${kind}`,
    game: "g",
    kind,
    seq: 1,
    stateVersion: 1,
    target: { userId: ME, faction: "sol", color: "blue", resolvedBy: "owner_prefix" },
    scope: "player",
    visibility: "public",
    prompt: "",
    options,
    source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false },
    createdAt: 0,
    revision: 1,
    window: null,
    progress: null,
    inputs: null,
    ...extra,
  } as Decision;
}

const state = {
  phase: "action",
  round: 2,
  activePlayer: ME,
  players: [
    { userId: ME, faction: "sol", color: "blue", self: true, real: true, techs: [], planets: [], exhaustedPlanets: [], strategyCards: [], commandTokens: { tactic: 3, fleet: 3, strategy: 2 }, tg: 0, commodities: 0, commoditiesMax: 4, secretObjectiveCount: 1, secretsScored: {}, hand: null, relics: [], fragments: [], leaders: [], promissoryNotesInPlayArea: [] },
    { userId: OTHER, faction: "xxcha", color: "green", self: false, real: true, techs: [], planets: [], exhaustedPlanets: [], strategyCards: [], commandTokens: { tactic: 3, fleet: 3, strategy: 2 }, tg: 0, commodities: 0, commoditiesMax: 4, secretObjectiveCount: 1, secretsScored: {}, hand: null, relics: [], fragments: [], leaders: [], promissoryNotesInPlayArea: [] },
  ],
  strategyCards: [],
  tiles: [],
  publicObjectives: {},
  laws: [],
  draft: null,
} as unknown as GameState;

const window = (kind: string): ReactionWindow => ({ kind, subject: {}, eligible: [ME, OTHER], responded: [OTHER], responses: {} });

/** Every kind's sample: a destructive / foreign / info option around one legal answer. */
function sample(kind: DecisionKind): Decision {
  const options = [
    opt("ultimateUndo_12", "UNDO"),
    opt("FFCC_xxcha_doSomething", "Xxcha's button", { action: "resolve" }),
    opt("getModifyTiles", "Modify Units"),
    opt("FFCC_sol_proceed", "Proceed", { action: "resolve" }),
    opt("resetSpend_res", "Reset Spent Planets", { action: "reset" }),
  ];
  // Optional offers are only the bot's business when the table waits on them (a reaction window).
  const extra = KIND_CLASS[kind] === "optional" ? { scope: "table" as const, window: window("generic") } : {};
  return decision(kind, options, extra);
}

for (const kind of Object.keys(KIND_CLASS) as DecisionKind[]) {
  test(`fallback answers ${kind} for a bot (forced by the watchdog)`, () => {
    if (kind === "input.form") {
      // Forms: the specific policy closes them (bots never fill free-form input).
      const d = decision(kind, [opt("submit", "Submit", null, { needsInput: true }), opt("cancel", "Cancel")]);
      const pick = chooseTyped(d, state, ME, { history: [], open: [], all: [d], force: true });
      assert.equal(pick?.option?.id, "cancel");
      return;
    }
    const d = sample(kind);
    const pick = chooseTyped(d, state, ME, { history: [], open: [], all: [d], waitedMs: FALLBACK_FORCE_MS, force: true });
    assert.ok(pick, `${kind}: no answer`);
    if (pick.option) {
      assert.ok(!/undo|reset|getModifyTiles|xxcha/i.test(pick.option.id), `${kind}: pressed ${pick.option.id}`);
    }
  });
}

test("passive answers come first: Decline over the agent", () => {
  const d = decision("action_card.resolve", [opt("FFCC_sol_exhaustAgent_solagent", "Use Sol Agent"), opt("deleteButtons", "Decline")]);
  assert.equal(chooseFallback(d, state, ME)?.option.id, "deleteButtons");
});

test("never undo / cancel / delete / rescind / another faction's / another player's", () => {
  const d = decision("action_card.target", [
    opt("ultimateUndo_3", "UNDO"),
    opt("cancelThing", "Cancel"),
    opt("deleteMessage", "Delete"),
    opt("rescindOffer_x", "Rescind Offer", { action: "rescind" }),
    opt("FFCC_xxcha_pick", "Xxcha", { action: "resolve" }),
    opt("pick_other", "Theirs", { action: "resolve" }, { owner: { userId: OTHER, faction: "xxcha", color: "green", resolvedBy: "mixed_owners" } }),
    opt("needs_form", "Type it", null, { needsInput: true }),
  ]);
  assert.equal(chooseFallback(d, state, ME), null);
});

test("deleteButtons labelled Done is a legal commit; labelled Delete is not", () => {
  assert.equal(chooseFallback(decision("combat.assign_units", [opt("FFCC_sol_assignHits_1_ff", "Remove 1 Fighter", { action: "destroy" }), opt("deleteButtons", "Done Removing/Sustaining Units", { action: "done" })]), state, ME)?.option.id, "deleteButtons");
  assert.equal(chooseFallback(decision("combat.assign_units", [opt("deleteButtons", "Delete These Buttons")]), state, ME), null);
});

test("optional offers without a window are left alone", () => {
  const d = decision("action_card.play", [opt("ac_play_from_hand_5", "(5) Sabotage", { card: "sabo" })]);
  assert.equal(fallbackDue(d, ME, { force: true }), false);
  assert.equal(chooseTyped(d, state, ME, { history: [], open: [], all: [d], force: true }), null);
});

test("timing: blocking kinds after the grace period, planner kinds only when forced / after the watchdog delay", () => {
  const blocking = decision("explore.outcome", [opt("x", "Proceed", { action: "resolve" })]);
  assert.equal(fallbackDue(blocking, ME, { waitedMs: 0 }), false);
  assert.equal(fallbackDue(blocking, ME, { waitedMs: FALLBACK_GRACE_MS }), true);
  const planner = decision("turn.action", [opt("FFCC_sol_passForRound", "Pass", { action: "pass", abilities: false })]);
  assert.equal(fallbackDue(planner, ME, { waitedMs: FALLBACK_GRACE_MS }), false);
  assert.equal(fallbackDue(planner, ME, { waitedMs: FALLBACK_FORCE_MS }), true);
  assert.equal(chooseTyped(planner, state, ME, { history: [], open: [], all: [planner], force: true })?.option?.id, "FFCC_sol_passForRound");
});

test("not ours: another player's prompt, or a window we already answered", () => {
  const theirs = decision("explore.outcome", [opt("x", "Proceed", { action: "resolve" })], { target: { userId: OTHER, faction: "xxcha", color: "green", resolvedBy: "owner_prefix" } });
  assert.equal(chooseTyped(theirs, state, ME, { history: [], open: [], all: [theirs], force: true }), null);
  const answered = decision("action_card.sabotage", [opt("pass", "No Sabotage", { action: "pass" })], { scope: "table", target: null, window: { ...window("sabotage"), responded: [ME] } });
  assert.equal(chooseTyped(answered, state, ME, { history: [], open: [], all: [answered], force: true }), null);
});

test("a sabotage window: pass, never Sabotage (cancel)", () => {
  const d = decision("action_card.sabotage", [opt("sabotage_x", "Sabotage", { action: "cancel" }), opt("noSabo", "No Sabotage", { action: "pass" })], { scope: "table", target: null, window: window("sabotage") });
  assert.equal(chooseFallback(d, state, ME)?.option.id, "noSabo");
});

test("specific policies keep precedence: strategy card pick takes the preferred card, not the first", () => {
  const d = decision("strategy_card.pick", [opt("FFCC_sol_scPick_2", "Diplomacy", { strategyCard: 2, tradeGoods: 0 }), opt("FFCC_sol_scPick_1", "Leadership", { strategyCard: 1, tradeGoods: 0 })]);
  const pick = chooseTyped(d, state, ME, { history: [], open: [], all: [d], force: true });
  assert.equal(pick?.option?.id, "FFCC_sol_scPick_1");
  assert.equal(pick?.why, "strategy phase: preferred card");
});

test("command token panel outside the status phase (no specific policy): Done, gaining nothing", () => {
  const d = decision("command_tokens.adjust", [
    opt("FFCC_sol_increase_tactic_cc", "Gain 1 Tactic Token", { action: "adjust", pool: "tactic", delta: 1, payload: false }),
    opt("FFCC_sol_deleteButtons", "Done Gaining Command Tokens"),
    opt("FFCC_sol_resetCCs", "Reset Tokens", { action: "reset" }),
    opt("ultimateUndo_27", "UNDO"),
  ]);
  assert.equal(chooseTyped(d, state, ME, { history: [], open: [], all: [d], force: true })?.option?.id, "FFCC_sol_deleteButtons");
});

test("claims the engine says we cannot make are never pressed (objective not met)", () => {
  const d = decision("status.imperial", [opt("FFCC_sol_po_scoring_1", "(1) Improve Infrastructure", { action: "score_public", eligible: [OTHER] }), opt("FFCC_sol_po_scoring_3", "(3) Lead", { action: "score_public", eligible: [ME] })]);
  assert.equal(chooseFallback(d, state, ME)?.option.id, "FFCC_sol_po_scoring_3");
});

test("Imperial's own scoring list (no window) is an offer: left alone", () => {
  const d = decision("status.score", [opt("FFCC_sol_po_scoring_1", "(1) Improve Infrastructure", { action: "score_public", eligible: [] }), opt("deleteButtons", "Delete These Buttons")]);
  assert.equal(chooseTyped(d, state, ME, { history: [], open: [], all: [d], force: true }), null);
});

test("a discard prompt may discard; elsewhere discards are never pressed", () => {
  const discard = opt("ac_discard_from_hand_894", "(894) Fighter Conscription", null);
  assert.equal(chooseFallback(decision("action_card.discard", [discard]), state, ME)?.option.id, discard.id);
  assert.equal(chooseFallback(decision("action_card.resolve", [discard]), state, ME), null);
});

test("turn menu: play the owed strategy card rather than start an unplanned tactical action", () => {
  const d = decision("turn.action", [
    opt("FFCC_sol_tacticalAction", "Tactical Action (3)", { action: "tactical", tacticTokens: 3 }),
    opt("FFCC_sol_componentAction", "Component Action (0)", { action: "component" }),
    opt("FFCC_sol_strategicAction_6", "Play Warfare", { action: "strategic", strategyCard: 6 }),
    opt("transaction", "Transaction"),
    opt("ultimateUndo_174", "UNDO"),
  ]);
  assert.equal(chooseFallback(d, state, ME)?.option.id, "FFCC_sol_strategicAction_6");
});

test("a weakly resolved target waits for the watchdog", () => {
  const d = decision("explore.outcome", [opt("x", "Proceed", { action: "resolve" })], { target: { userId: ME, faction: "sol", color: "blue", resolvedBy: "mention" } });
  assert.equal(fallbackDue(d, ME, { waitedMs: FALLBACK_GRACE_MS }), false);
  assert.equal(fallbackDue(d, ME, { force: true }), true);
});
