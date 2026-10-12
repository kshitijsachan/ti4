/** Sanity checks for the Thunder's Edge policy: `npx tsx src/engine/policy-te.check.ts` (exits 1 on failure). */
import assert from "node:assert/strict";
import { chooseTyped } from "./autopilot.js";
import type { Decision, GameState, Option } from "./types.js";

const ME = "u1";
const opt = (id: string, value: unknown, handler = id.replace(/^FFCC_[a-z]+_/, "")): Option<any> => ({
  id, label: id, style: "success", emoji: null, disabled: false, needsInput: false, handler, value: value as any,
});
const base = (kind: string, options: Option<any>[], extra: Partial<Decision> = {}): Decision =>
  ({
    id: "d1", game: "g1", kind, seq: 1, stateVersion: 1, revision: 1, window: null, progress: null,
    target: { userId: ME, faction: "crimson", color: "red", resolvedBy: "owner_prefix" },
    scope: "player", visibility: "public", prompt: "", options, createdAt: 0,
    source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false },
    ...extra,
  }) as Decision;
const state = {
  players: [{ userId: ME, faction: "crimson", tg: 4, planets: ["olergodt"], techs: [] }],
  tiles: [
    { position: "305", tileId: "x", holders: [{ name: "space", units: [], tokens: [], control: [] }, { name: "olergodt", units: [], tokens: [], control: [] }] },
    { position: "308", tileId: "y", holders: [{ name: "space", units: [], tokens: ["token_ingress.png"], control: [] }] },
    { position: "310", tileId: "z", holders: [{ name: "space", units: [], tokens: [], control: [] }] },
  ],
} as unknown as GameState;

// Fracture roll: own button pressed; another faction's never.
const roll = base("te.fracture.roll", [opt("FFCC_crimson_rollFracture_crimsonbt", { breakthrough: "crimsonbt", spawn: false, canEnterPlay: true })]);
assert.equal(chooseTyped(roll, state, ME)?.option.id, "FFCC_crimson_rollFracture_crimsonbt");
const otherRoll = base("te.fracture.roll", [opt("FFCC_jolnar_rollFracture_jolnarbt", { breakthrough: "jolnarbt", spawn: false, canEnterPlay: true })], {
  target: { userId: "u2", faction: "jolnar", color: "blue", resolvedBy: "owner_prefix" },
});
assert.equal(chooseTyped(otherRoll, state, ME), null);
// Even if mis-targeted at us, an option locked to jolnar is never chosen.
assert.equal(chooseTyped({ ...otherRoll, target: roll.target } as Decision, state, ME), null);
// Weakly resolved (mention) prompts are left alone.
assert.equal(chooseTyped({ ...roll, target: { ...roll.target!, resolvedBy: "mention" } } as Decision, state, ME), null);

// Ingress: skip a tile that already has a token, prefer my planet's system; Done when this prompt's quota is placed.
const ing = (remaining: number) =>
  base(
    "te.fracture.ingress",
    [
      opt("FFCC_crimson_addIngressToken_308_1", { position: "308", tileId: "y", skips: ["warfare"], hasIngress: false, perType: 1 }),
      opt("FFCC_crimson_addIngressToken_310_1", { position: "310", tileId: "z", skips: ["warfare"], hasIngress: false, perType: 1 }),
      opt("FFCC_crimson_addIngressToken_305_1", { position: "305", tileId: "x", skips: ["warfare"], hasIngress: false, perType: 1 }),
      opt("deleteButtons", null),
    ],
    { progress: { flow: "fracture.ingress", step: "place", accumulated: { placed: 1 - remaining }, required: { perType: 1, remaining }, canCommit: true } },
  );
assert.equal(chooseTyped(ing(1), state, ME)?.option.id, "FFCC_crimson_addIngressToken_305_1");
assert.equal(chooseTyped(ing(0), state, ME)?.option.id, "deleteButtons");

// Galvanize: optional menu untouched; forced (Bastion agent): one galvanize of the biggest ship, then Done; never ungalvanize.
const gal = (mandatory: boolean, galvanized: number) =>
  base(
    "te.galvanize",
    [
      opt("FFCC_crimson_ungalvanize_305_dn_space", { action: "ungalvanize", position: "305", unit: "dn", holder: "space" }),
      opt("FFCC_crimson_galvanize_305_ff_space", { action: "galvanize", position: "305", unit: "ff", holder: "space" }),
      opt("FFCC_crimson_galvanize_305_cv_space", { action: "galvanize", position: "305", unit: "cv", holder: "space" }),
      opt("deleteButtons", null),
    ],
    { progress: { flow: "galvanize", step: "select_unit", accumulated: { galvanized }, required: { units: mandatory ? 1 - galvanized : 0, mandatory }, canCommit: !mandatory || galvanized > 0 } },
  );
assert.equal(chooseTyped(gal(false, 0), state, ME), null);
assert.equal(chooseTyped(gal(true, 0), state, ME)?.option.id, "FFCC_crimson_galvanize_305_cv_space");
assert.equal(chooseTyped(gal(true, 1), state, ME)?.option.id, "deleteButtons");

// Expedition: 3 trade goods when we have them, else dismiss.
const exp = base("te.expedition", [
  opt("FFCC_crimson_TEexpedition_secret", { expedition: "secret", affordable: true, unlocksBreakthrough: true, remaining: 6 }),
  opt("FFCC_crimson_TEexpedition_tradeGoods", { expedition: "tradeGoods", affordable: true, unlocksBreakthrough: true, remaining: 6 }),
  opt("deleteButtons", null),
]);
assert.equal(chooseTyped(exp, state, ME)?.option.id, "FFCC_crimson_TEexpedition_tradeGoods");

// Visionaria: a non-owner declines once; nothing after responding.
const vis = (responded: string[]) =>
  base(
    "te.visionaria.respond",
    [
      opt("acquireATechWithDwsBt", { choice: "research", respondent: true }),
      opt("declineVisionaria", { choice: "decline", respondent: true }),
      opt("FFCC_deepwrought_endTurnAfterVisionaria", { choice: "end_turn_after_all", respondent: false }),
    ],
    {
      scope: "table",
      target: { userId: null, faction: null, color: null, resolvedBy: "none" },
      window: { kind: "visionaria", subject: { owner: "u9" }, eligible: [ME, "u9"], responded, responses: {} },
    },
  );
assert.equal(chooseTyped(vis([]), state, ME)?.option.id, "declineVisionaria");
assert.equal(chooseTyped(vis([ME]), state, ME), null);

// Mecatol Rex swap.
const swap = base("secret_objective.discard", [opt("discardSecret_12redraw", { handle: 12, redraw: true }), opt("discardSecret_40redraw", { handle: 40, redraw: true })], {
  target: { userId: ME, faction: "crimson", color: "red", resolvedBy: "cards_thread" },
});
assert.equal(chooseTyped(swap, { ...state, round: 3 } as GameState, ME)?.option.id, "discardSecret_40redraw");

// c5 table kinds. Deorbit Barrage: hit the points leader, then the most dice.
const vpState = {
  ...state,
  players: [
    { userId: ME, faction: "crimson", tg: 4, planets: [], techs: [], victoryPoints: 3 },
    { userId: "u2", faction: "hacan", tg: 0, planets: [], techs: [], victoryPoints: 5 },
    { userId: "u3", faction: "sol", tg: 0, planets: [], techs: [], victoryPoints: 2 },
  ],
} as unknown as GameState;
const bt = (step: string, fields: Record<string, unknown>) => ({ breakthrough: "saarbt", faction: "saar", step, action: "target", optional: false, ...fields });
const deorbit = base("te.breakthrough", [opt("deorbitBarrageTarget_sol", bt("deorbitBarrageTarget", { target: "sol" })), opt("deorbitBarrageTarget_hacan", bt("deorbitBarrageTarget", { target: "hacan" }))], {
  target: { userId: ME, faction: "crimson", color: "red", resolvedBy: "faction_component" },
});
assert.equal(chooseTyped(deorbit, vpState, ME)?.option.id, "deorbitBarrageTarget_hacan");
const dice = base("te.breakthrough", [opt("deorbitBarrageResource_mr_1", bt("deorbitBarrageResource", { planet: "mr", amount: 1 })), opt("deorbitBarrageResource_mr_3", bt("deorbitBarrageResource", { planet: "mr", amount: 3 }))]);
assert.equal(chooseTyped(dice, vpState, ME)?.option.id, "deorbitBarrageResource_mr_3");
// Optional breakthrough offer with a Decline: declined. Another faction's locked button: never.
const offer = base("te.breakthrough", [opt("FFCC_crimson_useTheIcon", { breakthrough: "bastionbt", faction: "bastion", step: "useTheIcon", action: "use", optional: true }), opt("FFCC_crimson_deleteButtons", null)]);
assert.equal(chooseTyped(offer, vpState, ME)?.option.id, "FFCC_crimson_deleteButtons");
// Breach: Crimson keeps its breach; the others remove it.
const breach = (faction: string) =>
  base("te.breach", [opt(`FFCC_${faction}_removeBreach_305`, { source: "incursion", faction: "crimson", step: "removeBreach", action: "target", optional: true, tile: "305" }), opt(`FFCC_${faction}_deleteButtons`, null)], {
    target: { userId: ME, faction, color: "red", resolvedBy: "owner_prefix" },
  });
assert.equal(chooseTyped(breach("crimson"), vpState, ME)?.option.id, "FFCC_crimson_deleteButtons");
const hacanState = { ...vpState, players: [{ ...vpState.players[0], faction: "hacan" }] } as unknown as GameState;
assert.equal(chooseTyped(breach("hacan"), hacanState, ME)?.option.id, "FFCC_hacan_removeBreach_305");
// Plot panel: background, never pressed; the faction picker: the points leader.
const plotStep = (step: string, extra: Record<string, unknown>) => ({ ability: "plotsplots", faction: "firmament", step, action: "use", optional: true, ...extra });
const panel = base("te.plot", [opt("addFactionTokenToPlot_assail", plotStep("addFactionTokenToPlot", { plot: "assail", panel: true })), opt("scoreOtherPlayersSecrets", plotStep("scoreOtherPlayersSecrets", { panel: true }))], {
  target: { userId: ME, faction: "crimson", color: "red", resolvedBy: "cards_thread" },
});
assert.equal(chooseTyped(panel, vpState, ME), null);
const picker = base("te.plot", [opt("addFactionTokenToPlot_assail_sol", plotStep("addFactionTokenToPlot", { plot: "assail", target: "sol", panel: false })), opt("addFactionTokenToPlot_assail_hacan", plotStep("addFactionTokenToPlot", { plot: "assail", target: "hacan", panel: false }))], {
  target: { userId: ME, faction: "crimson", color: "red", resolvedBy: "cards_thread" },
});
assert.equal(chooseTyped(picker, vpState, ME)?.option.id, "addFactionTokenToPlot_assail_hacan");

console.log("policy-te: all checks passed");
