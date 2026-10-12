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

process.exit(failed ? 1 : 0);
