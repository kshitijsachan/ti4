/** Sanity checks for the perpetual / preference / select policy: `npx tsx src/engine/policy/ui.check.ts` (exits 1 on failure). */
import assert from "node:assert/strict";
import { chooseTyped } from "../autopilot.js";
import { awaits, type Decision, type Option } from "../types.js";

const ME = "u1";
const opt = (id: string, value: unknown): Option<any> => ({
  id, label: id, style: "success", emoji: null, disabled: false, needsInput: false, handler: id.replace(/#.*$/, ""), value: value as any,
});
const base = (kind: string, options: Option<any>[], extra: Partial<Decision> = {}): Decision =>
  ({
    id: "d1", game: "g1", kind, seq: 1, stateVersion: 1, revision: 1, window: null, progress: null, inputs: null,
    target: { userId: ME, faction: "sol", color: "red", resolvedBy: "cards_thread" },
    scope: "player", visibility: "private", prompt: "", options, createdAt: 0,
    source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false },
    ...extra,
  }) as Decision;
const pick = (d: Decision) => chooseTyped(d, null, ME)?.option?.id ?? null;

// Affordances: never awaited, never pressed.
const undo = base("ui.undo_affordance", [opt("drawSpecificSO_btgk", { action: "undo", undoes: "so_discard", ref: "btgk" }), opt("deleteButtons", null)]);
assert.equal(awaits(undo, ME), false);
assert.equal(pick(undo), null);
assert.equal(pick(base("ui.optional", [opt("editRoundSummary_1~MDL", { action: "round_summary", undoes: null, ref: "1" })])), null);
assert.equal(pick(base("ui.info_menu", [opt("cardsInfo", null), opt("exhaustAgent_nekroagent", { action: "shortcut", undoes: null, ref: "nekroagent", shortcut: "exhaust_agent" })])), null);

// Preferences: the legacy rule table's defaults.
const pref = (p: string, c: string) => opt(`x_${p}_${c}`, { preference: p, question: null, choice: c });
assert.equal(pick(base("player.preference", [pref("sandbag", "manual"), pref("sandbag", "bot")])), "x_sandbag_bot");
assert.equal(pick(base("player.preference", [pref("auto_pass_sabotage", "4"), pref("auto_pass_sabotage", "1")])), "x_auto_pass_sabotage_1");
assert.equal(pick(base("player.preference", [pref("agenda", "true"), pref("agenda", "false")])), "x_agenda_true");
assert.equal(
  pick(base("player.preference", [pref("stats:soloptinwinrate", "yes"), pref("stats", "acceptAll"), pref("stats", "declineAll")])),
  "x_stats_declineAll",
);
assert.equal(pick(base("player.preference", [pref("distance", "false"), pref("distance", "true")])), "x_distance_true");
// Never another seat's preference.
assert.equal(pick(base("player.preference", [pref("sandbag", "bot")], { target: { userId: "u2", faction: null, color: null, resolvedBy: "cards_thread" } })), null);

// Select-only: the preselected value, else the first.
const sel = (selected: boolean) =>
  base("choose.select", [opt("menu_x#a", { menu: "menu_x" }), opt("menu_x#b", { menu: "menu_x" })], {
    inputs: [{ id: "menu_x", kind: "select", title: null, fields: [{ id: "values", label: null, type: "choice", required: true, minLength: null, maxLength: null, minValues: 1, maxValues: 1, multiline: false, placeholder: null, value: null, choices: [{ value: "a", label: "A", description: null, selected: false }, { value: "b", label: "B", description: null, selected }] }] }],
  } as Partial<Decision>);
assert.equal(pick(sel(true)), "menu_x#b");
assert.equal(pick(sel(false)), "menu_x#a");

console.log("policy/ui.check: OK");
