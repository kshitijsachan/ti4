/** Sanity checks for the C7 card-tail policy: `npx tsx src/engine/policy/cards.check.ts` (exits 1 on failure). */
import assert from "node:assert/strict";
import { chooseTyped } from "../autopilot.js";
import type { Decision, GameState, Option } from "../types.js";

const ME = "u1";
const opt = (id: string, value: unknown, handler = id.replace(/^FFCC_[a-z]+_/, "")): Option<any> => ({
  id, label: id, style: "success", emoji: null, disabled: false, needsInput: false, handler, value: value as any,
});
const base = (kind: string, options: Option<any>[], extra: Partial<Decision> = {}): Decision =>
  ({
    id: "d1", game: "g1", kind, seq: 1, stateVersion: 1, revision: 1, window: null, progress: null,
    target: { userId: ME, faction: "sol", color: "blue", resolvedBy: "owner_prefix" },
    scope: "player", visibility: "public", prompt: "", options, createdAt: 0,
    source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false },
    ...extra,
  }) as Decision;
const state = { players: [{ userId: ME, faction: "sol" }, { userId: "u2", faction: "hacan" }] } as unknown as GameState;
const ctx = (history: string[] = []) => ({ history, open: [], all: [] });

// action_card.step: another player's target first, never the same option twice, then finish.
const step = base("action_card.step", [
  opt("FFCC_sol_scuttleOn_sol_dd", { step: "scuttleOn", actionCard: "scuttle", role: "choose", player: "sol", unit: "dd" }),
  opt("FFCC_sol_scuttleOn_hacan_dd", { step: "scuttleOn", actionCard: "scuttle", role: "choose", player: "hacan", unit: "dd" }),
  opt("FFCC_sol_endScuttle_x", { step: "endScuttle", actionCard: "scuttle", role: "done" }),
]);
assert.equal(chooseTyped(step, state, ME, ctx())?.option?.id, "FFCC_sol_scuttleOn_hacan_dd");
assert.equal(chooseTyped(step, state, ME, ctx(["FFCC_sol_scuttleOn_hacan_dd"]))?.option?.id, "FFCC_sol_scuttleOn_sol_dd");
assert.equal(
  chooseTyped(step, state, ME, ctx(["FFCC_sol_scuttleOn_hacan_dd", "FFCC_sol_scuttleOn_sol_dd"]))?.option?.id,
  "FFCC_sol_endScuttle_x",
);
// Not ours: left alone.
assert.equal(chooseTyped({ ...step, target: { ...step.target!, userId: "u2" } } as Decision, state, ME, ctx()), null);

// action_card.when_after: pass for the whole agenda while the window awaits us.
const window = { kind: "when", subject: {}, eligible: [ME, "u2"], responded: [], responses: {} };
const when = base(
  "action_card.when_after",
  [
    opt("play_when", { timing: "when", action: "play" }),
    opt("no_when", { timing: "when", action: "pass" }),
    opt("no_when_persistent", { timing: "when", action: "pass_agenda" }),
  ],
  { scope: "table", target: null, window } as Partial<Decision>,
);
assert.equal(chooseTyped(when, state, ME, ctx())?.option?.id, "no_when_persistent");
assert.equal(chooseTyped({ ...when, window: { ...window, responded: [ME] } } as Decision, state, ME, ctx()), null);

// promissory_note.resolve: Acquiescence offer declined.
const acq = base("promissory_note.resolve", [
  opt("winnuPNPlay_3", { promissoryNote: "acq", step: "acquiescence", strategyCard: 3 }),
  opt("deleteButtons", null),
]);
assert.equal(chooseTyped(acq, state, ME, ctx())?.option?.id, "deleteButtons");

// action_card.resolve still answered (names the card now).
const res = base("action_card.resolve", [opt("FFCC_sol_resolveRally", { step: "resolveRally", actionCard: "rally", automation: "rally" })]);
assert.equal(chooseTyped(res, state, ME, ctx())?.option?.id, "FFCC_sol_resolveRally");
console.log("cards.check: PASS");
