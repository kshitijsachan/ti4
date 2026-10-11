/**
 * Autopilot policy for combat decisions (G4). Pure: (decision, state, my other open decisions) → option or null.
 *
 * Safety rules: a bot never destroys or sustains its own units except through the engine's auto-assignment of hits
 * it is owed (combat.hits targeted at it); it rolls each combat round once (the engine's window says who still has
 * to roll, from the round trackers), never ahead of its opponent and never while it still owes hits; barrage and
 * space cannon once per prompt; it never bombards, retreats or cancels hits.
 */
import type { CombatDecision, CombatHits, CombatRound, CombatAssignUnits, CombatControlValue } from "./kinds/combat.js";
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
      return finishMenu(d, me);
    default:
      return null; // retreat: a bot never retreats
  }
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
