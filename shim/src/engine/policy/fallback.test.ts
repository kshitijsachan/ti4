// Run: cd shim && npx tsx --test src/engine/policy/fallback.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseTyped } from "../autopilot.js";
import { chooseFallback, draftBoardsMissing, fallbackDue, FALLBACK_FORCE_MS, FALLBACK_GRACE_MS, KIND_CLASS, staleForBot } from "./fallback.js";
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
  tiles: [{ position: "000", tileId: "18", holders: [] }],
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
  // c12: ui.* affordances are never answered; choose.select is answered from its select schema (policy/ui.check.ts).
  if (kind.startsWith("ui.") || kind === "choose.select") continue;
  test(`fallback answers ${kind} for a bot (forced by the watchdog)`, () => {
    if (kind === "input.form") {
      // Forms: the specific policy closes them (bots never fill free-form input).
      const d = decision(kind, [opt("submit", "Submit", null, { needsInput: true }), opt("cancel", "Cancel")]);
      const pick = chooseTyped(d, state, ME, { history: [], open: [], all: [d], force: true });
      assert.equal(pick?.option?.id, "cancel");
      return;
    }
    if (kind === "turn.action") {
      // Turn menus: only turn options (end turn / strategy card / pass), never "Proceed" (policy/turn.ts).
      const d = decision(kind, [opt("ultimateUndo_12", "UNDO"), opt("FFCC_sol_tacticalAction", "Tactical Action (3)", { action: "tactical", tacticTokens: 3 }), opt("FFCC_sol_passingAbilities", "Pass (+1 ability)", { action: "pass", abilities: true })]);
      const pick = chooseTyped(d, state, ME, { history: [], open: [], all: [d], waitedMs: FALLBACK_FORCE_MS, force: true });
      assert.equal(pick?.option?.id, "FFCC_sol_passingAbilities");
      return;
    }
    if (kind === "status.score_secret") {
      // Only a secret the engine says we meet (pbd160 below for the rest).
      const d = decision(kind, [opt("so_score_hand_1", "(1) Become a Martyr", { handle: 1, secretObjective: "bam", phase: "action", points: 1, met: null }), opt("so_score_hand_2", "(2) Control the Region", { handle: 2, secretObjective: "ctr", phase: "status", points: 1, met: true })]);
      const pick = chooseTyped(d, state, ME, { history: [], open: [], all: [d], waitedMs: FALLBACK_FORCE_MS, force: true });
      assert.equal(pick?.option?.id, "so_score_hand_2");
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

// ---- live gaps (shim.log 23:50–00:01)

const combatState = (fronts: { holder: string; mine: number; theirs: number }[], tile = "308") =>
  ({
    ...state,
    combat: {
      tile,
      tileId: "102",
      factions: ["sol", "xxcha"],
      fronts: fronts.map((f) => ({
        holder: f.holder,
        sides: [
          { faction: "sol", userId: ME, roundsRolled: 0, units: f.mine ? [{ holder: f.holder, unit: "gf", count: f.mine, damaged: 0, sustain: false }] : [], abilities: [] },
          { faction: "xxcha", userId: OTHER, roundsRolled: 1, units: f.theirs ? [{ holder: f.holder, unit: "gf", count: f.theirs, damaged: 0, sustain: false }] : [], abilities: [] },
        ],
      })),
      spaceCannonOffence: [],
      rolls: [],
    },
  }) as unknown as GameState;

const combatRound = (tile: string, holder: string) =>
  decision(
    "combat.round",
    [
      opt(`getDamageButtons_${tile}_spacecombat`, "Assign Hits", { action: "assign_manual", tile }),
      opt("checkCombatACs", "Check Combat Action Cards", { action: "action_cards", tile }),
      opt(`getRepairButtons_${tile}`, "Repair Damage", { action: "repair", tile }),
      opt(`combatRoll_${tile}_${holder}_bombardment`, "Roll BOMBARDMENT", { action: "roll", tile, holder, rollType: "bombardment" }),
      opt(`combatRoll_${tile}_${holder}`, "Roll Dice For Combat Round #1", { action: "roll", tile, holder, rollType: "combat" }),
    ],
    {
      scope: "table",
      target: { userId: null, faction: null, color: null, resolvedBy: "none" } as unknown as Decision["target"],
      window: { kind: "combat_roll", subject: { tile, holder, rollType: "combat" }, eligible: [ME, OTHER], responded: [OTHER], responses: {} },
    },
  );

test("pbd60: a finished fight's roll window is stale (no fallback, no watchdog)", () => {
  const d = combatRound("308", "space");
  const st = combatState([{ holder: "space", mine: 0, theirs: 2 }]);
  assert.equal(staleForBot(d, st, ME), true);
  assert.equal(chooseFallback(d, st, ME), null);
  assert.equal(chooseTyped(d, st, ME, { history: [], open: [], all: [d], force: true }), null);
});

test("pbd60: a roll window of another system than the combat on the board is stale", () => {
  assert.equal(staleForBot(combatRound("101", "space"), combatState([{ holder: "space", mine: 1, theirs: 1 }]), ME), true);
});

test("live combat round: the fallback rolls the window's dice, never Check Combat Action Cards / Repair", () => {
  const d = combatRound("308", "space");
  const st = combatState([{ holder: "space", mine: 2, theirs: 2 }]);
  assert.equal(staleForBot(d, st, ME), false);
  assert.equal(chooseFallback(d, st, ME)?.option.id, "combatRoll_308_space");
});

test("pbd86: turn.action targeted at us while another player is active is stale", () => {
  const d = decision("turn.action", [opt("FFCC_sol_passingAbilities", "Pass (+1 ability)", { action: "pass", abilities: true })]);
  const other = { ...state, activePlayer: OTHER } as GameState;
  assert.equal(staleForBot(d, other, ME), true);
  assert.equal(chooseFallback(d, other, ME), null);
  assert.equal(staleForBot(d, state, ME), false);
});

test("pbd105: Leadership's token panel during the status homework goes to the strategy policy", () => {
  const st = {
    ...state,
    phase: "status",
    status: { step: "homework", players: { [ME]: { tokensConfirmed: true } } },
    strategyCards: [{ number: 1, card: "pok1leadership", played: true, holder: ME, reactions: [] }],
  } as unknown as GameState;
  const d = decision(
    "command_tokens.adjust",
    [opt("FFCC_sol_increase_tactic_cc", "Gain 1 Tactic Token", { action: "adjust", pool: "tactic", delta: 1 }), opt("FFCC_sol_deleteButtons_leadership", "Done Gaining Command Tokens")],
    { progress: { flow: "command_tokens", step: "adjust", accumulated: { tactic: 3, fleet: 3, strategy: 2 }, required: { original: { tactic: 3, fleet: 3, strategy: 2 } }, canCommit: true } as unknown as Decision["progress"] },
  );
  const pick = chooseTyped(d, st, ME, { history: [], open: [], all: [d] });
  assert.equal(pick?.option?.id, "FFCC_sol_increase_tactic_cc");
  assert.ok(!pick!.why.startsWith("fallback"));
});

const setupStep = (step: string, values: Record<string, unknown>[]) =>
  decision(
    "setup.player",
    values.map((v, i) => opt(`setupStep_${i}`, String(v.faction ?? v.color ?? v.userId ?? step), { step, userId: null, faction: null, color: null, position: null, speaker: null, page: null, ...v })),
  );
const unseated = {
  ...state,
  tiles: [{ position: "000", tileId: "18", holders: [] }],
  players: state.players.map((p) => (p.userId === ME ? { ...p, faction: null, color: null } : p)),
} as unknown as GameState;

test("pbd147: setup.player — start once, then official free faction / free colour / no speaker", () => {
  const start = setupStep("start", [{}]);
  assert.equal(chooseTyped(start, unseated, ME, { history: [], open: [], all: [start] })?.why, "setup: set ourselves up");
  assert.equal(chooseTyped(start, unseated, ME, { history: ["setupStep_0"], open: [], all: [start] }), null);
  assert.equal(staleForBot(start, state, ME), true);
  const faction = setupStep("faction", [{ userId: ME, faction: "xxcha" }, { userId: ME, faction: "franken20" }, { userId: ME, faction: null, page: "2!" }, { userId: ME, faction: "arborec" }]);
  assert.equal(chooseTyped(faction, unseated, ME, { history: [], open: [], all: [faction] })?.option?.value.faction, "arborec");
  const color = setupStep("color", [{ userId: ME, faction: "arborec", color: "green" }, { userId: ME, faction: "arborec", color: "forest" }]);
  assert.equal(chooseTyped(color, unseated, ME, { history: [], open: [], all: [color] })?.option?.value.color, "forest");
  const speaker = setupStep("speaker", [{ userId: ME, speaker: true }, { userId: ME, speaker: false }]);
  assert.equal(chooseTyped(speaker, unseated, ME, { history: [], open: [], all: [speaker] })?.option?.value.speaker, false);
});

test("pbd182: no manual setup before a map exists (the steward's Milty path), and seats spread their choices", () => {
  const start = setupStep("start", [{}]);
  const fresh = { ...unseated, tiles: [] } as unknown as GameState;
  assert.equal(staleForBot(start, fresh, ME), true);
  assert.equal(chooseTyped(start, fresh, ME, { history: [], open: [], all: [start], force: true }), null);
  const blank = { ...unseated, players: unseated.players.map((p) => ({ ...p, faction: null, color: null })) } as unknown as GameState;
  const offer = (who: string) => setupStep("faction", ["arborec", "argent", "letnev"].map((f) => ({ userId: who, faction: f })));
  const mine = chooseTyped(offer(ME), blank, ME, { history: [], open: [], all: [] })?.option?.value.faction;
  const theirs = chooseTyped(offer(OTHER), blank, OTHER, { history: [], open: [], all: [] })?.option?.value.faction;
  assert.notEqual(mine, theirs);
});

// ---- live gaps 01:28–01:32

test("pbd60: a bombardment opener after its ground combat rolled rounds is stale", () => {
  const d = decision("units.remove", [opt("getDamageButtons_308_bombardment", "Assign Hits", { action: "open", tile: "308", assignType: "bombardment" }), opt("ultimateUndo_143", "UNDO")]);
  const after = combatState([{ holder: "andeara", mine: 2, theirs: 0 }]);
  (after.combat!.fronts[0].sides[1] as { roundsRolled: number }).roundsRolled = 5;
  assert.equal(staleForBot(d, after, ME), true);
  assert.equal(chooseFallback(d, after, ME), null);
  const before = combatState([{ holder: "andeara", mine: 2, theirs: 1 }]);
  before.combat!.fronts[0].sides.forEach((s) => ((s as { roundsRolled: number }).roundsRolled = 0));
  assert.equal(staleForBot(d, before, ME), false, "bombardment before the ground combat is owed");
  const remove = decision("units.remove", [opt("getDamageButtons_308_remove", "Remove Units", { action: "open", tile: "308", assignType: "remove" })]);
  assert.equal(staleForBot(remove, after, ME), false, "fleet-pool reminders are the desk's, never stale");
});

test("pbd175: the Keleres preset once we play a flavour is stale; during the draft we pre-select a free one", () => {
  const preset = (contested: boolean[]) =>
    decision(
      "setup.keleres_flavor",
      ["mentak", "xxcha", "argent"].map((f, i) => opt(`draftPresetKeleres_${f}`, f, { flavor: f, faction: `keleres${f[0]}`, preset: true, contested: contested[i], homePosition: null, speaker: null })),
    );
  const seated = { ...state, players: state.players.map((p) => (p.userId === ME ? { ...p, faction: "keleresa" } : p)) } as unknown as GameState;
  assert.equal(staleForBot(preset([false, false, false]), seated, ME), true);
  const drafting = { ...unseated, setup: { stage: "draft", waitingOn: [], players: [] } } as unknown as GameState;
  assert.equal(staleForBot(preset([true, false, false]), drafting, ME), false);
  assert.equal(chooseTyped(preset([true, false, false]), drafting, ME, { history: [], open: [], all: [] })?.option?.id, "draftPresetKeleres_xxcha");
});

test("pbd181: a tactical action's prompts outside our action-phase turn are stale", () => {
  const conclude = decision("tactical.conclude", [opt("FFCC_sol_doneWithTacticalAction", "Conclude Tactical Action", { action: "conclude" })]);
  const move = decision("tactical.move", [opt("FFCC_sol_concludeMove_210", "Done moving", { op: "done" })]);
  const status = { ...state, phase: "status" } as unknown as GameState;
  const theirTurn = { ...state, activePlayer: OTHER } as unknown as GameState;
  const passed = { ...state, players: state.players.map((p) => (p.userId === ME ? { ...p, passed: true } : p)) } as unknown as GameState;
  for (const [name, st] of [["status phase", status], ["another player's turn", theirTurn], ["we passed", passed]] as const) {
    assert.equal(staleForBot(conclude, st, ME), true, `conclude: ${name}`);
    assert.equal(chooseFallback(move, st, ME), null, `move: ${name}`);
  }
  assert.equal(staleForBot(conclude, state, ME), false, "our own turn");
  assert.equal(chooseFallback(conclude, state, ME)?.option.id, "FFCC_sol_doneWithTacticalAction");
});

test("pbd160: a declared secret objective's list is never re-pressed (stale; action-phase / unjudged secrets never claimed)", () => {
  // The stall dump (shim.log 01:08:00, Bot Beta), target re-pointed at ME.
  const d = decision("status.score_secret", [opt("so_score_hand_326", "(326) Become a Martyr", { handle: 326, secretObjective: "bam", phase: "action", points: 1, progress: 0, threshold: 0, met: null })], {
    id: "d1559008824533319680",
    prompt: "Please choose the secret objective you wish to score.",
    target: { userId: ME, faction: "naalu", color: "watermelon", resolvedBy: "interaction_user" },
    source: { channelId: "1558996814319976448", messageId: "1559008824533319680", customIdPrefix: "so_", ephemeral: true },
  });
  const status = (secretScored: string | null) =>
    ({ ...state, phase: "statusScoring", status: { round: 2, step: "scoring", players: { [ME]: { publicScored: "none", secretScored } } } }) as unknown as GameState;
  assert.equal(staleForBot(d, status("none"), ME), true);
  assert.equal(staleForBot(d, status("bam"), ME), true);
  assert.equal(chooseTyped(d, status("none"), ME, { history: [], open: [], all: [d], force: true }), null);
  // Undeclared: still nothing to press (an action-phase secret, and the engine cannot judge it).
  assert.equal(staleForBot(d, status(null), ME), false);
  assert.equal(chooseFallback(d, status(null), ME), null);
  assert.equal(chooseFallback(d, state, ME), null);
});

test("pbd31: Winnu agent 'use on' buttons once our agent is exhausted are stale (no 783 presses)", () => {
  const agent = (target: string) => opt(`exhaustAgent_winnuagent_${target}`, target, { leader: "winnuagent", leaderType: "agent", faction: "winnu", step: "exhaustAgent", action: "target", optional: true, target, args: [target] });
  const d = decision("leader.use", [agent("hacan"), agent("yin"), agent("crimson")]);
  const withLeader = (status: string) => ({ ...state, players: state.players.map((p) => (p.userId === ME ? { ...p, faction: "winnu", leaders: [status] } : p)) }) as unknown as GameState;
  assert.equal(staleForBot(d, withLeader("winnuagent:exhausted"), ME), true);
  assert.equal(chooseFallback(d, withLeader("winnuagent:exhausted"), ME), null);
  assert.equal(staleForBot(d, withLeader("winnuagent"), ME), false);
});

test("pbd223: our milty turn owing a slice — faction / speaker boards are stale, the missing slice board is reported", () => {
  const draft = {
    type: "milty",
    status: "drafting",
    currentPlayer: ME,
    order: [ME, OTHER],
    players: [
      { userId: ME, faction: "naaz", slice: null, speakerOrder: 1 },
      { userId: OTHER, faction: "titans", slice: "C", speakerOrder: null },
    ],
    available: { slices: ["E", "F"], factions: ["hacan", "nomad"], speakerOrders: [5] },
  };
  const drafting = { ...state, phase: "miltydraft", draft } as unknown as GameState;
  const board = (category: string, picks: string[]) =>
    decision("draft.milty.pick", picks.map((p) => opt(`milty_${category}_${p}`, p, { category, pick: p })), { id: `d-${category}` });
  const factions = board("faction", ["hacan", "nomad"]);
  const orders = board("order", ["5"]);
  const slices = board("slice", ["E", "F"]);
  assert.equal(staleForBot(factions, drafting, ME), true);
  assert.equal(staleForBot(orders, drafting, ME), true);
  assert.equal(staleForBot(slices, drafting, ME), false);
  assert.equal(chooseFallback(factions, drafting, ME), null);
  assert.deepEqual(draftBoardsMissing([factions, orders], drafting, ME), ["slice"]);
  assert.deepEqual(draftBoardsMissing([factions, orders, slices], drafting, ME), []);
  assert.equal(chooseTyped(slices, drafting, ME, { history: [], open: [], all: [] })?.option?.id, "milty_slice_E");
  // Someone else's pick: nothing is missing for us, and their boards are not ours to press.
  const theirs = { ...drafting, draft: { ...draft, currentPlayer: OTHER } } as unknown as GameState;
  assert.deepEqual(draftBoardsMissing([factions, orders], theirs, ME), []);
  assert.equal(staleForBot(slices, theirs, ME), true);
});

test("pbd228: starting technologies during setup — preferred pick, owned ones skipped, even without value.starting", () => {
  const tech = (t: string) => opt(`FFCC_sol_getTech_${t}__noPay__comp`, t, { tech: t, free: true, starting: false, flags: ["noPay", "comp"], type: "PROPULSION" });
  const d = decision("tech.gain", [tech("zzz"), tech("amd"), tech("nm")]);
  const setup = (owing: number, techs: string[] = []) =>
    ({ ...state, round: 1, players: state.players.map((p) => (p.userId === ME ? { ...p, techs } : p)), setup: { stage: "player_setup", waitingOn: [ME], players: [{ userId: ME, faction: "sol", startingTechsNeeded: owing, secretObjectivesToDiscard: 0, keleresFlavorPending: false }] } }) as unknown as GameState;
  const pick = chooseTyped(d, setup(1), ME, { history: [], open: [], all: [d] });
  assert.ok(pick && !pick.why.startsWith("fallback"), pick?.why);
  assert.notEqual(pick!.option!.value.tech, "zzz", "a preferred technology before an unknown one");
  const again = chooseTyped(d, setup(1, [pick!.option!.value.tech]), ME, { history: [], open: [], all: [d] });
  assert.notEqual(again?.option?.value.tech, pick!.option!.value.tech, "never one we own");
  assert.equal(chooseTyped(d, setup(0), ME, { history: [], open: [], all: [d] }), null, "nothing owed: not a starting technology");
});
