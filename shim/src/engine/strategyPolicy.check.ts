/**
 * Self-check of the strategy-card autopilot policy (run: npx tsx src/engine/strategyPolicy.check.ts).
 * Regression for the fuzzer's pbd114 finding: after a shim restart (empty in-memory history) the Leadership holder
 * resolved the primary again (+3 tokens each time). The engine's window.subject.primaryDone now says what is done.
 */
import { chooseStrategy } from "./kinds/strategyPolicy.js";
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

process.exit(failed ? 1 : 0);
