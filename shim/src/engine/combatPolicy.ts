/**
 * Autopilot policy for combat decisions (G4). Pure: (decision, state, my other open decisions) → option or null.
 *
 * Safety rules: a bot never destroys or sustains its own units except through the engine's auto-assignment of hits
 * it is owed (combat.hits targeted at it); it rolls each combat round once (the engine's window says who still has
 * to roll, from the round trackers), never ahead of its opponent and never while it still owes hits; barrage and
 * space cannon once per prompt; it never bombards, retreats or cancels hits.
 */
import type { CombatDecision, CombatHits, CombatRound, CombatAssignUnits, CombatControlValue, CombatBombard, CombatRetreat, UnitsRemove } from "./kinds/combat.js";
import type { Decision, GameState, Option } from "./types.js";

export type CombatChoice = { option: Option<any>; why: string };

const isCombat = (d: Decision): d is CombatDecision => d.kind.startsWith("combat.");

/** Dummy / NPC seats' copies of a button act as that seat (dummyPlayerSpoof<faction>_): never ours. */
const forDummy = (o: Option<any>) => o.id.includes("dummyPlayerSpoof");

export function chooseCombat(d: Decision, state: GameState | null, me: string, open: Decision[] = []): CombatChoice | null {
  if (!isCombat(d)) return null;
  switch (d.kind) {
    case "combat.round":
      return roll(d, state, me, open);
    case "combat.hits":
      return autoAssign(d, me);
    case "combat.assign_units":
      return finishMenu(d, me) ?? pickUnit(d, me);
    case "combat.bombard":
      return bombardDone(d, me);
    case "combat.retreat":
      return noRetreat(d, me);
    default:
      return null;
  }
}

/** The engine auto-assigned every bombardment unit to a planet when the step opened: roll as assigned. */
function bombardDone(d: CombatBombard, me: string): CombatChoice | null {
  if (d.target?.userId !== me) return null;
  const done = d.options.find((o) => !o.disabled && !forDummy(o) && o.value?.op === "done");
  return done ? { option: done, why: "bombardment: roll with the engine's assignment" } : null;
}

/** A bot never retreats; a retreat prompt addressed to it (someone announced one for it) is closed. */
function noRetreat(d: CombatRetreat, me: string): CombatChoice | null {
  if (d.target?.userId !== me) return null;
  const done = d.options.find((o) => !o.disabled && !forDummy(o) && o.value?.action === "done");
  return done ? { option: done, why: "combat: bots do not retreat" } : null;
}

/** Cheapest first: what a hit should take when no sustain is left. */
const UNIT_COST = ["ff", "gf", "inf", "dd", "ca", "mf", "cv", "pd", "sd", "dn", "fs", "ws"];
const cost = (unit: string) => (UNIT_COST.indexOf(unit) < 0 ? 50 : UNIT_COST.indexOf(unit));

/**
 * The manual menu while hits are still owed (opened by a units.remove / assign-manual press): sustain an undamaged
 * unit that can, else destroy the cheapest unit. Without engine progress (removal menus), close it.
 */
function pickUnit(d: CombatAssignUnits, me: string): CombatChoice | null {
  if (d.target?.userId !== me) return null;
  const live = d.options.filter((o) => !o.disabled && !forDummy(o) && o.value);
  const left = Number((d.progress?.required as Record<string, unknown> | undefined)?.hits ?? 0);
  const done = live.find((o) => o.value!.action === "done");
  if (!d.progress || left <= 0) return done ? { option: done, why: "combat: nothing owed; close the menu" } : null;
  const units = live.filter((o) => o.value!.action === "sustain" || o.value!.action === "destroy") as Option<Extract<CombatAssignUnits["options"][number]["value"], { unit: string }>>[];
  const sustain = units.find((o) => o.value!.action === "sustain" && !o.value!.damaged);
  if (sustain) return { option: sustain, why: `combat: sustain damage on ${sustain.value!.unit} (${left} hit(s) left)` };
  const destroy = units.filter((o) => o.value!.action === "destroy").sort((a, b) => cost(a.value!.unit) - cost(b.value!.unit))[0];
  if (destroy) return { option: destroy, why: `combat: destroy ${destroy.value!.unit} (${left} hit(s) left)` };
  return done ? { option: done, why: "combat: no unit left to assign" } : null;
}

/**
 * Stand-alone removal opener (units.remove): hits from bombardment / barrage / space cannon are owed, so open the
 * menu once (its per-unit policy is pickUnit) and close the opener afterwards; a "remove" prompt (fleet pool /
 * capacity / rift) is optional for a bot: close it.
 */
export function chooseUnitsRemove(d: UnitsRemove, me: string, history: string[], open: Decision[]): CombatChoice | null {
  if (d.target?.userId !== me) return null;
  if (open.some((x) => x.kind === "combat.assign_units" && x.target?.userId === me)) return null;
  const live = d.options.filter((o) => !o.disabled && !forDummy(o) && o.value);
  const done = live.find((o) => o.value!.action === "done");
  const opener = live.find((o) => o.value!.action === "open" && o.value!.assignType !== "remove");
  if (opener && !history.includes(opener.id)) return { option: opener, why: `units: assign ${opener.value!.assignType} hits` };
  const anyOpen = live.find((o) => o.value!.action === "open");
  if (done) return { option: done, why: "units: nothing left to remove" };
  if (anyOpen && !history.includes(anyOpen.id)) return { option: anyOpen, why: "units: open the removal menu" };
  return null;
}

function autoAssign(d: CombatHits, me: string): CombatChoice | null {
  if (d.scope !== "player" || d.target?.userId !== me) return null;
  const auto = d.options.find((o) => !o.disabled && !forDummy(o) && o.value?.action === "auto");
  if (!auto || auto.value?.action !== "auto" || auto.value.hits <= 0) return null;
  return { option: auto, why: `combat: auto-assign ${auto.value.hits} ${auto.value.source} hit(s) owed` };
}

/** A manual menu addressed to us (only if someone opened it): close it once the engine says the hits are assigned. */
function finishMenu(d: CombatAssignUnits, me: string): CombatChoice | null {
  if (d.target?.userId !== me || !d.progress?.canCommit) return null;
  const done = d.options.find((o) => !o.disabled && o.value?.action === "done");
  return done ? { option: done, why: "combat: hits assigned; close the menu" } : null;
}

function roll(d: CombatRound, state: GameState | null, me: string, open: Decision[]): CombatChoice | null {
  const w = d.window;
  if (!w || w.kind !== "combat_roll" || !w.eligible.includes(me) || w.responded.includes(me)) return null;
  const combat = state?.combat;
  const self = state?.players.find((p) => p.userId === me);
  if (!combat || !self?.faction) return null;
  const rollType = String(w.subject.rollType ?? "");
  const holder = String(w.subject.holder ?? "");
  const rolls = (o: Option<any>): o is Option<CombatControlValue & { action: "roll" }> =>
    !o.disabled && !forDummy(o) && o.value?.action === "roll";
  const options = d.options.filter(rolls);
  const pick = (type: string, h?: string) => options.find((o) => o.value!.rollType === type && (!h || o.value!.holder === h));
  const rolledSincePrompt = (type: string) =>
    combat.rolls.some((r) => r.faction === self.faction && r.rollType === type && r.at >= d.createdAt);

  if (rollType === "afb" || rollType === "spacecannonoffence") {
    if (rolledSincePrompt(rollType)) return null;
    const o = pick(rollType);
    return o ? { option: o, why: `combat: roll ${rollType === "afb" ? "anti-fighter barrage" : "space cannon offence"}` } : null;
  }
  if (rollType !== "combat") return null;
  // Only while this fight is on: both sides still have units where it is fought.
  const front = combat.fronts.find((f) => f.holder === holder);
  const mine = front?.sides.find((s) => s.userId === me);
  const theirs = front?.sides.find((s) => s.userId !== me);
  if (!front || !mine || !theirs || !mine.units.length || !theirs.units.length) return null;
  if (mine.roundsRolled > theirs.roundsRolled) return null;
  // Hits we owe come first (the next round is rolled after assigning).
  if (open.some((x) => x.kind === "combat.hits" && x.target?.userId === me)) return null;
  // Space cannon defence before the first ground round, once.
  if (mine.roundsRolled === 0 && mine.abilities.includes("spacecannondefence") && !rolledSincePrompt("spacecannondefence")) {
    const scd = pick("spacecannondefence", holder);
    if (scd) return { option: scd, why: "combat: space cannon defence before ground combat" };
  }
  const o = pick("combat", holder);
  return o ? { option: o, why: `combat: roll round ${mine.roundsRolled + 1}` } : null;
}
