/**
 * Self-check of the strategy-card autopilot policy (run: npx tsx src/engine/strategyPolicy.check.ts).
 * Regression for the fuzzer's pbd114 finding: after a shim restart (empty in-memory history) the Leadership holder
 * resolved the primary again (+3 tokens each time). The engine's window.subject.primaryDone now says what is done.
 */
import { chooseStrategy, holderPrimaryPending } from "./kinds/strategyPolicy.js";
import { chooseTurnAction } from "./policy/turn.js";
import type { Decision, GameState } from "./types.js";

const ME = "u1";
let failed = 0;
function expect(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const state = {
  players: [{ userId: ME, faction: "mentak", self: true, strategyCards: [1], planets: [], commandTokens: { tactic: 3, fleet: 3, strategy: 2 } }],
  strategyCards: [{ number: 1, card: "pok1leadership", played: true, holder: ME, reactions: [] }],
} as unknown as GameState;

function leadership(primaryDone?: string[]): Decision {
  const v = (id: string, action: string, who: string, part: string | null) => ({
    id,
    label: id,
    disabled: false,
    needsInput: false,
    value: { strategyCard: 1, name: "Leadership", card: "pok1leadership", holder: "mentak", action, who, spendsToken: false, part, primaryParts: ["tokens"], copy: false },
  });
  return {
    id: "d1",
    kind: "strategy_card.resolve",
    revision: 1,
    scope: "table",
    target: null,
    window: { kind: "strategy_card", subject: { strategyCard: 1, primaryDone }, eligible: [], responded: [], responses: {} },
    options: [v("leadershipGenerateCCButtons", "leadership_tokens", "anyone", "tokens"), v("sc_no_follow_1", "decline", "others", null)],
  } as unknown as Decision;
}

const ctx = { history: [], open: [], all: [] };
expect("fresh play: resolve the primary", chooseStrategy(leadership([]), state, ME, ctx)?.option.id, "leadershipGenerateCCButtons");
expect("older bot (no primaryDone): resolve the primary", chooseStrategy(leadership(undefined), state, ME, ctx)?.option.id, "leadershipGenerateCCButtons");
expect("after a restart, primary already done: leave it", chooseStrategy(leadership(["tokens"]), state, ME, ctx), null);

const panel = (reinforcements: number) =>
  ({
    id: "d2",
    kind: "command_tokens.adjust",
    revision: 1,
    scope: "player",
    target: { userId: ME },
    progress: { flow: "command_tokens", step: "adjust", accumulated: { tactic: 3, fleet: 3, strategy: 2 }, required: { status: false, original: { tactic: 3, fleet: 3, strategy: 2 }, reinforcements }, canCommit: true },
    options: [
      { id: "FFCC_mentak_increase_tactic_cc", handler: "increase_tactic_cc", label: "Gain 1 Tactic Token", value: { action: "adjust", pool: "tactic", delta: 1 } },
      { id: "FFCC_mentak_deleteButtons_leadership", handler: "deleteButtons_leadership", label: "Done", value: null },
    ],
  }) as unknown as Decision;
expect("tokens left: gain", chooseStrategy(panel(5), state, ME, ctx)?.option.id, "FFCC_mentak_increase_tactic_cc");
expect("no tokens left in reinforcements: done", chooseStrategy(panel(0), state, ME, ctx)?.option.id, "FFCC_mentak_deleteButtons_leadership");

// pbd171: Construction must never place a 4th space dock (unit supply: 3 space docks, 6 PDS).
const docks = (sd: number, pd = 0) =>
  ({
    players: [{ userId: ME, faction: "hacan", color: "spring", self: true, strategyCards: [4], planets: ["a", "b", "c", "d"], commandTokens: { tactic: 3, fleet: 3, strategy: 2 } }],
    strategyCards: [{ number: 4, card: "pok4construction", played: true, holder: ME, reactions: [] }],
    tiles: [{ position: "103", tileId: "1", holders: [{ name: "arnor", units: [{ owner: "hacan", color: "spring", unit: "sd", count: sd }, { owner: "hacan", color: "spring", unit: "pd", count: pd }], tokens: [], control: [] }] }],
  }) as unknown as GameState;
const construction = () => {
  const v = (id: string, unit: string) => ({
    id,
    label: id,
    disabled: false,
    needsInput: false,
    value: { strategyCard: 4, name: "Construction", card: "pok4construction", holder: "hacan", action: "structure", unit, who: "holder", spendsToken: false, part: "structure", primaryParts: ["structure", "structure"], copy: false },
  });
  return {
    id: "d4",
    kind: "strategy_card.resolve",
    revision: 1,
    scope: "table",
    target: null,
    window: { kind: "strategy_card", subject: { strategyCard: 4, primaryDone: [] }, eligible: [], responded: [], responses: {} },
    options: [v("construction_spacedock", "spacedock"), v("construction_pds", "pds")],
  } as unknown as Decision;
};
expect("construction: room for a dock: dock first", chooseStrategy(construction(), docks(2), ME, ctx)?.option.id, "construction_spacedock");
expect("construction: 3 docks on the board: PDS", chooseStrategy(construction(), docks(3), ME, ctx)?.option.id, "construction_pds");
expect("construction: 3 docks and 6 PDS: nothing", chooseStrategy(construction(), docks(3, 6), ME, ctx), null);
const place = {
  id: "d5",
  kind: "strategy_card.construction_place",
  revision: 1,
  scope: "player",
  target: { userId: ME },
  options: [{ id: "place_arnor", label: "Arnor", disabled: false, needsInput: false, value: { unit: "spacedock", planet: "arnor", home: false, resources: 2, influence: 1, pds: 0, spaceDock: 0 } }],
} as unknown as Decision;
expect("construction_place: never a 4th space dock", chooseStrategy(place, docks(3), ME, ctx), null);
expect("construction_place: a 3rd one is fine", chooseStrategy(place, docks(2), ME, ctx)?.option.id, "place_arnor");

// Warfare redistribute panel (Done = deleteButtons~ccredist, outside the status phase).
const redist = (acc: { tactic: number; fleet: number; strategy: number }, orig: typeof acc, status = false) =>
  ({
    id: "d3",
    kind: "command_tokens.adjust",
    revision: 1,
    scope: "player",
    target: { userId: ME },
    progress: { flow: "command_tokens", step: "adjust", accumulated: acc, required: { status, original: orig, reinforcements: 4 }, canCommit: true },
    options: [
      ...(["tactic", "fleet", "strategy"] as const).flatMap((pool) => [
        { id: `FFCC_mentak_increase_${pool}_cc`, handler: `increase_${pool}_cc`, label: "+", value: { action: "adjust", pool, delta: 1 } },
        { id: `FFCC_mentak_decrease_${pool}_cc`, handler: `decrease_${pool}_cc`, label: "-", value: { action: "adjust", pool, delta: -1 } },
      ]),
      { id: "FFCC_mentak_resetCCs", handler: "resetCCs", label: "Reset", value: { action: "reset" } },
      { id: "FFCC_mentak_deleteButtons~ccredist", handler: "deleteButtons~ccredist", label: "Done Redistributing Command Tokens", value: null },
    ],
  }) as unknown as Decision;
const warfareState = (card: string) =>
  ({
    activePlayer: ME,
    players: [{ userId: ME, faction: "mentak", self: true, strategyCards: [6], planets: [], commandTokens: { tactic: 1, fleet: 3, strategy: 2 } }],
    strategyCards: [{ number: 6, card, played: true, holder: ME, reactions: [] }],
  }) as unknown as GameState;
const pok = warfareState("pok6warfare");
const te = warfareState("te6warfare");
const T = (tactic: number, fleet: number, strategy: number) => ({ tactic, fleet, strategy });
expect("Warfare: gain back the removed token into tactic", chooseStrategy(redist(T(1, 3, 2), T(1, 3, 2)), pok, ME, ctx)?.option.id, "FFCC_mentak_increase_tactic_cc");
expect("Warfare: token gained back, tactic 2: done", chooseStrategy(redist(T(2, 3, 2), T(1, 3, 2)), pok, ME, ctx)?.option.id, "FFCC_mentak_deleteButtons~ccredist");
expect("TE Warfare: no gain; tactic 1 -> take a strategy token", chooseStrategy(redist(T(1, 3, 2), T(1, 3, 2)), te, ME, ctx)?.option.id, "FFCC_mentak_decrease_strategy_cc");
expect("TE Warfare: the taken token goes into tactic", chooseStrategy(redist(T(1, 3, 1), T(1, 3, 2)), te, ME, ctx)?.option.id, "FFCC_mentak_increase_tactic_cc");
expect("TE Warfare: strategy 1 kept, fleet 3 kept: done", chooseStrategy(redist(T(1, 3, 1), T(1, 3, 1)), te, ME, ctx)?.option.id, "FFCC_mentak_deleteButtons~ccredist");
expect("TE Warfare: fleet 5 -> take a fleet token", chooseStrategy(redist(T(0, 5, 1), T(0, 5, 1)), te, ME, ctx)?.option.id, "FFCC_mentak_decrease_fleet_cc");
expect("press cap: done", chooseStrategy(redist(T(1, 3, 2), T(1, 3, 2)), te, ME, { ...ctx, history: Array(8).fill("x") })?.option.id, "FFCC_mentak_deleteButtons~ccredist");
expect("status-phase panel: not ours", chooseStrategy(redist(T(1, 3, 2), T(1, 3, 2), true), te, ME, ctx), null);
// Warfare primary is resolved now (was skipped), and waits while its follow-ups are open.
const warfareCard = (card: string, primaryDone?: string[]) =>
  ({
    id: "d4",
    kind: "strategy_card.resolve",
    revision: 1,
    scope: "table",
    target: null,
    window: { kind: "strategy_card", subject: { strategyCard: 6, primaryDone }, eligible: [], responded: [], responses: {} },
    options: [
      { id: card === "te6warfare" ? "primaryOfTeWarfare" : "primaryOfWarfare", label: "Primary", disabled: false, needsInput: false, value: { strategyCard: 6, name: "Warfare", card, holder: "mentak", action: "warfare_primary", who: "holder", spendsToken: false, part: "warfare_primary", primaryParts: ["warfare_primary"], copy: false } },
    ],
  }) as unknown as Decision;
expect("TE Warfare primary pressed", chooseStrategy(warfareCard("te6warfare", []), te, ME, ctx)?.option.id, "primaryOfTeWarfare");
expect("Warfare primary pressed", chooseStrategy(warfareCard("pok6warfare", []), pok, ME, ctx)?.option.id, "primaryOfWarfare");
expect("Warfare primary done: nothing", chooseStrategy(warfareCard("pok6warfare", ["warfare_primary"]), pok, ME, ctx), null);
const offer = { id: "d5", kind: "choose.confirm", target: { userId: ME }, options: [{ id: "beginTacticalTeWarfare", value: { source: "warfare", confirm: true, choice: "tactical" } }] } as unknown as Decision;
expect("Warfare follow-up open: wait", chooseStrategy(warfareCard("te6warfare", []), te, ME, { ...ctx, open: [offer] }), null);

// Playtest 9 pbd539: Imperial's "Score A Public" went stale, End Turn went in between, and the card scored after the
// turn. While a primary part the holder policy would press is open, the turn is not ended.
const imperialState = {
  phase: "action",
  activePlayer: ME,
  players: [{ userId: ME, faction: "mentak", self: true, strategyCards: [8], planets: [], commandTokens: { tactic: 3, fleet: 3, strategy: 2 } }],
  strategyCards: [{ number: 8, card: "pok8imperial", played: true, holder: ME, reactions: [] }],
} as unknown as GameState;
const imperial = (primaryDone: string[]) =>
  ({
    id: "d8",
    kind: "strategy_card.resolve",
    revision: 3,
    scope: "table",
    target: null,
    createdAt: Date.now(),
    window: { kind: "strategy_card", subject: { strategyCard: 8, primaryDone }, eligible: [], responded: [], responses: {} },
    options: [
      { id: "scoreAnObjective", label: "Score A Public", disabled: false, needsInput: false, value: { strategyCard: 8, name: "Imperial", card: "pok8imperial", holder: "mentak", action: "score_public", who: "holder", spendsToken: false, part: "score_public", primaryParts: ["score_public", "imperial"], copy: false } },
      { id: "sc_draw_so", label: "Draw Secret Objective", disabled: false, needsInput: false, value: { strategyCard: 8, name: "Imperial", card: "pok8imperial", holder: "mentak", action: "draw_secret", who: "anyone", spendsToken: true, part: "imperial", primaryParts: ["score_public", "imperial"], copy: false } },
    ],
  }) as unknown as Decision;
expect("Imperial primary not started: pending", !!holderPrimaryPending(imperialState, ME, [imperial([])]), true);
expect("Imperial scored, secret not drawn: pending", !!holderPrimaryPending(imperialState, ME, [imperial(["score_public"])]), true);
expect("Imperial resolved: not pending", holderPrimaryPending(imperialState, ME, [imperial(["score_public", "imperial"])]), null);
const endMenu = {
  id: "t1",
  kind: "turn.action",
  target: { userId: ME },
  options: [{ id: "turnEnd", label: "End Turn", disabled: false, needsInput: false, value: { action: "end_turn", abilities: false, waitingFor: [], overLimits: [] } }],
} as unknown as Decision;
const pending = holderPrimaryPending(imperialState, ME, [imperial([])]);
expect("turn policy waits while the primary is pending", chooseTurnAction(endMenu as never, imperialState, ME, { open: [], primaryPending: pending }), null);
expect("turn policy ends the turn once resolved", chooseTurnAction(endMenu as never, imperialState, ME, { open: [], primaryPending: null })?.option.id, "turnEnd");

process.exit(failed ? 1 : 0);
