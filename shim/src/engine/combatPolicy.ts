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
import { chooseCombatAutomate, chooseCombatModifier } from "./policy/units.js";

export type CombatChoice = { option: Option<any>; why: string; act?: { action: string; body: Record<string, unknown> } };

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
      // pickUnit only where hits are owed (progress): a removal list without progress that is over the limits is the
      // unit-limit desk's; pickUnit's "nothing owed: Done" there closed it before any removal (pbd114 loop).
      return finishMenu(d, me) ?? closeRemovalList(d, state, me) ?? (d.progress ? pickUnit(d, me) : null);
    case "combat.bombard":
      return bombardDone(d, me);
    case "combat.retreat":
      return noRetreat(d, me);
    case "combat.automate":
      return chooseCombatAutomate(d, me);
    case "combat.modifier":
      return chooseCombatModifier(d, me);
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
 * capacity) is closed only when the board shows we are within the limits (else the unit-limit desk's).
 */
export function chooseUnitsRemove(d: UnitsRemove, me: string, history: string[], open: Decision[], state: GameState | null = null): CombatChoice | null {
  if (d.target?.userId !== me) return null;
  if (open.some((x) => x.kind === "combat.assign_units" && x.target?.userId === me)) return null;
  const live = d.options.filter((o) => !o.disabled && !forDummy(o) && o.value);
  const done = live.find((o) => o.value!.action === "done");
  const opener = live.find((o) => o.value!.action === "open" && o.value!.assignType !== "remove");
  if (opener && !history.includes(opener.id)) return { option: opener, why: `units: assign ${opener.value!.assignType} hits` };
  const anyOpen = live.find((o) => o.value!.action === "open");
  // A fleet pool / capacity reminder ("remove"): dismiss it only when the board shows nothing over the limits; over
  // them (or unknown), the unit-limit desk (botplay/violations.ts) opens the list and removes the cheapest units.
  const reminder = live.find((o) => o.value!.action === "open" && o.value!.assignType === "remove");
  if (reminder && reminder.value!.action === "open") {
    const lim = unitLimits(reminder.value!.tile, state, me);
    if (!lim || lim.over) return null;
    return done ? { option: done, why: `units: within limits in ${reminder.value!.tile} (${lim.summary}); dismiss` } : null;
  }
  if (done) return { option: done, why: "units: nothing left to remove" };
  if (anyOpen && !history.includes(anyOpen.id)) return { option: anyOpen, why: "units: open the removal menu" };
  return null;
}

function autoAssign(d: CombatHits, me: string): CombatChoice | null {
  if (d.scope !== "player" || d.target?.userId !== me) return null;
  const auto = d.options.find((o) => !o.disabled && !forDummy(o) && o.value?.action === "auto");
  if (!auto) return bombardmentPlan(d);
  if (auto.value?.action !== "auto" || auto.value.hits <= 0) return null;
  return { option: auto, why: `combat: auto-assign ${auto.value.hits} ${auto.value.source} hit(s) owed` };
}

/**
 * BOMBARDMENT hits (no auto option: the manual option carries hits, planet and units): one combat plan. Mechs (or any
 * unit that can) sustain first, each sustain cancelling `sustainCancels` hits; then the cheapest units are destroyed,
 * already damaged ones first. Unknown hits: left alone.
 */
export function bombardmentPlan(d: CombatHits): CombatChoice | null {
  const manual = d.options.find((o) => !o.disabled && !forDummy(o) && o.value?.action === "assign_manual" && o.value.assignType === "bombardment");
  const v = manual?.value;
  if (!manual || !v || v.action !== "assign_manual" || typeof v.hits !== "number" || v.hits <= 0 || !v.units?.length) return null;
  const cancels = v.sustainCancels ?? 1;
  let left = v.hits;
  const plan: { holder: string; unit: string; damaged: boolean; action: "sustain" | "destroy"; count: number }[] = [];
  const sustained = new Map<string, number>();
  for (const u of v.units) {
    const fresh = u.count - u.damaged;
    if (!u.sustain || fresh <= 0 || left <= 0) continue;
    const n = Math.min(fresh, Math.ceil(left / cancels));
    plan.push({ holder: u.holder, unit: u.unit, damaged: false, action: "sustain", count: n });
    sustained.set(`${u.holder}/${u.unit}`, n);
    left -= n * cancels;
  }
  const byCost = [...v.units].sort((a, b) => cost(a.unit) - cost(b.unit));
  for (const u of byCost) {
    if (left <= 0) break;
    const damaged = Math.min(u.damaged, left);
    if (damaged > 0) {
      plan.push({ holder: u.holder, unit: u.unit, damaged: true, action: "destroy", count: damaged });
      left -= damaged;
    }
    const fresh = u.count - u.damaged - (sustained.get(`${u.holder}/${u.unit}`) ?? 0);
    const n = Math.min(Math.max(0, fresh), left);
    if (n > 0) {
      plan.push({ holder: u.holder, unit: u.unit, damaged: false, action: "destroy", count: n });
      left -= n;
    }
  }
  const text = plan.map((e) => `${e.action} ${e.count} ${e.unit}${e.damaged ? " (damaged)" : ""}`).join(", ");
  return { option: manual, act: { action: "combat-plan", body: { plan } }, why: `bombardment: ${v.hits} hit(s) on ${v.holder ?? "the planet"}: ${text || "nothing left to hit"}` };
}

/** A manual menu addressed to us (only if someone opened it): close it once the engine says the hits are assigned. */
function finishMenu(d: CombatAssignUnits, me: string): CombatChoice | null {
  if (d.target?.userId !== me || !d.progress?.canCommit) return null;
  const done = d.options.find((o) => !o.disabled && o.value?.action === "done");
  return done ? { option: done, why: "combat: hits assigned; close the menu" } : null;
}

/** Lower bounds of a ship's capacity (unupgraded; flagships vary by faction, so none counted). */
const MIN_CAPACITY: Record<string, number> = { cv: 4, dn: 1, ws: 6 };

/**
 * A unit-removal list ("Remove Units in X" after a fleet pool / capacity reminder: assignType "remove", no hits
 * owed) addressed to us. When the board shows nothing over the limits in that system (non-fighter ships within the
 * fleet pool, fighters / ground forces in space within the least capacity the ships have, 3 fighters per dock), there
 * is nothing to remove: close it. Otherwise null: the unit-limit desk (botplay/violations.ts) removes the cheapest
 * units, and only the watchdog's last resort closes it. Live pbd60 / pbd114: such lists waited 60–75 s each.
 */
function closeRemovalList(d: CombatAssignUnits, state: GameState | null, me: string): CombatChoice | null {
  if (d.scope !== "player" || d.target?.userId !== me || d.progress) return null;
  const opts = d.options.filter((o) => !o.disabled && !forDummy(o));
  const done = opts.find((o) => o.value?.action === "done");
  if (!done || done.value?.assignType !== "remove") return null;
  if (opts.some((o) => o.value && "assignType" in o.value && o.value.assignType !== "remove")) return null;
  const tile = opts.map((o) => (o.value && "tile" in o.value ? o.value.tile : null)).find((t): t is string => !!t);
  const lim = tile ? unitLimits(tile, state, me) : null;
  if (!lim || lim.over) return null;
  return { option: done, why: `unit limits in ${tile}: ${lim.summary}: nothing to remove` };
}

/**
 * Our units in `tile` against the fleet pool / the least capacity our ships have (3 fighters per dock of ours there).
 * null when the board or our seat is unknown.
 */
export function unitLimits(tile: string, state: GameState | null, me: string): { over: boolean; summary: string } | null {
  const self = state?.players.find((p) => p.userId === me);
  const sys = state?.tiles.find((t) => t.position === tile);
  if (!self?.faction || !sys) return null;
  const mine = (u: { owner: string | null; color: string }) => u.owner === self.faction || u.color === self.color;
  const space = sys.holders.find((h) => h.name === "space")?.units.filter(mine) ?? [];
  const count = (unit: string) => space.filter((u) => u.unit === unit).reduce((n, u) => n + u.count, 0);
  const ships = space.filter((u) => !["ff", "gf", "mf"].includes(u.unit)).reduce((n, u) => n + u.count, 0);
  const capacity = space.reduce((n, u) => n + (MIN_CAPACITY[u.unit] ?? 0) * u.count, 0);
  const docks = sys.holders.filter((h) => h.name !== "space").flatMap((h) => h.units.filter(mine)).filter((u) => u.unit === "sd").reduce((n, u) => n + u.count, 0);
  const cargo = Math.max(0, count("ff") - 3 * docks) + count("gf") + count("mf");
  return {
    over: ships > self.commandTokens.fleet || cargo > capacity,
    summary: `${ships} ships / ${self.commandTokens.fleet} fleet, ${cargo} cargo / ${capacity}+ capacity`,
  };
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
  // (Only hits this bot can auto-assign: a BOMBARDMENT prompt has no auto option and must not stall the ground combat.)
  if (open.some((x) => x.kind === "combat.hits" && x.target?.userId === me && x.options.some((o) => !o.disabled && o.value?.action === "auto")))
    return null;
  // Space cannon defence before the first ground round, once.
  if (mine.roundsRolled === 0 && mine.abilities.includes("spacecannondefence") && !rolledSincePrompt("spacecannondefence")) {
    const scd = pick("spacecannondefence", holder);
    if (scd) return { option: scd, why: "combat: space cannon defence before ground combat" };
  }
  const o = pick("combat", holder);
  return o ? { option: o, why: `combat: roll round ${mine.roundsRolled + 1}` } : null;
}
