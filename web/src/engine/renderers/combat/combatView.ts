/**
 * One combat as the panel shows it, derived from engine data only (GameState.combat + the open combat decisions):
 * both sides per front (space / each planet), the dice of every round, hits produced, losses, hits owed, and the
 * single step the table is on ("Your turn: assign 2 hits…", "Waiting for X to roll round 2", "Roll for round 2"…).
 * Pure: no React, so it is unit-tested (src/engine/__tests__/combatView.test.ts).
 */
import type {
  CombatAbilityValue,
  CombatRoll,
  CombatState,
  HitsOwed,
  HittableUnit,
  RollType,
} from "../../../../../shim/src/engine/kinds/combat";
import type { Decision, GameState, Option } from "../../../../../shim/src/engine/types";

export type DieView = { unit: string; threshold: number; value: number; hit: boolean };

export type Loss = { unit: string; destroyed: number; sustained: number };

export type RollView = {
  faction: string;
  rollType: RollType;
  round: number | null;
  hits: number;
  dice: DieView[];
  /** What this side lost to the opponent's hits of this round (combat rounds; null when not known yet). */
  losses: Loss[] | null;
};

export type SideView = {
  faction: string;
  userId: string;
  self: boolean;
  attacker: boolean;
  units: HittableUnit[];
  roundsRolled: number;
};

export type RoundView = { round: number; rolls: RollView[] };

export type FrontView = {
  holder: string;
  sides: SideView[];
  /** Anti-fighter barrage, space cannon, bombardment rolls of this front (before its round 1). */
  pre: RollView[];
  rounds: RoundView[];
  /** Both sides still have units here. */
  on: boolean;
  /** Round being fought (1 + rounds both sides finished). */
  round: number;
  /** Final line once over: "Letnev wins the space combat (round 2)". */
  result: string | null;
};

export type StepKind = "assign" | "wait_assign" | "roll" | "wait_roll" | "blocked" | "retreat" | "over" | "idle";

export type StepView = {
  kind: StepKind;
  /** The step line, e.g. "Your turn: assign 2 hits to your ships". */
  text: string;
  mine: boolean;
  /** The decision that answers this step, when it is mine. */
  decision: Decision | null;
  holder: string | null;
  rollType: RollType | null;
};

/** Any decision's option, value unknown until narrowed (Decision is a union of ~100 kinds). */
export type AnyOption = Option<unknown>;

/** A decision's options, loosely typed. */
export const optionsOf = (d: Decision): AnyOption[] => d.options as AnyOption[];

export type RollChoice = { decision: Decision; option: AnyOption };

export type AbilityChoice = { decision: Decision; option: Option<CombatAbilityValue>; mine: boolean };

export type CombatView = {
  tile: string;
  tileId: string;
  fronts: FrontView[];
  /** The front the step is about (the first fight under way, else the latest one fought). */
  current: FrontView | null;
  step: StepView;
  owed: HitsOwed[];
  /** Roll options (mine to press now) for the step. */
  rolls: RollChoice[];
  /** Abilities posted with the combat (agents, relics, notes…): mine and unowned ones. */
  abilities: AbilityChoice[];
  /** Other combat controls: announce retreat, combat action cards, repair, Supercharge… */
  controls: RollChoice[];
  log: string[];
};

const HIT_SOURCE: Record<string, string> = {
  space: "your ships",
  ground: "your ground forces",
  afb: "your fighters",
  spacecannonoffence: "your ships",
};

const SOURCE_NAME: Record<string, string> = {
  space: "space combat",
  ground: "ground combat",
  afb: "anti-fighter barrage",
  spacecannonoffence: "space cannon",
};

export const ROLL_LABEL: Record<string, string> = {
  combat: "combat round",
  afb: "anti-fighter barrage",
  bombardment: "bombardment",
  spacecannonoffence: "space cannon offence",
  spacecannondefence: "space cannon defence",
};

const PRE: RollType[] = ["spacecannonoffence", "afb", "bombardment", "spacecannondefence"];

/** Pre-combat rolls older than this before round 1 belong to an earlier activation. */
const PRE_WINDOW_MS = 45 * 60 * 1000;

type Names = (faction: string) => string;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function dice(r: CombatRoll): DieView[] {
  return r.dice.flatMap((g) => g.results.map((value) => ({ unit: g.unit, threshold: g.threshold, value, hit: value >= g.threshold })));
}

/** Units lost between two snapshots of one side (destroyed, and newly damaged = sustained). */
export function lossesBetween(before: HittableUnit[], after: HittableUnit[]): Loss[] {
  const out: Loss[] = [];
  for (const b of before) {
    const a = after.find((x) => x.unit === b.unit && x.holder === b.holder);
    const destroyed = Math.max(0, b.count - (a?.count ?? 0));
    const sustained = Math.max(0, (a?.damaged ?? 0) - b.damaged);
    if (destroyed || sustained) out.push({ unit: b.unit, destroyed, sustained });
  }
  return out;
}

/** The combat rounds of one front: per round, each side's latest roll for that round. */
function roundsOf(combat: CombatState, holder: string, sides: SideView[]): RoundView[] {
  const rolls = combat.rolls.filter((r) => r.tile === combat.tile && r.holder === holder && r.rollType === "combat" && r.round != null);
  const last = Math.max(0, ...sides.map((s) => s.roundsRolled));
  const rounds: RoundView[] = [];
  for (let n = 1; n <= last; n++) {
    const views: RollView[] = [];
    for (const s of sides) {
      if (s.roundsRolled < n) continue;
      const r = [...rolls].reverse().find((x) => x.faction === s.faction && x.round === n);
      if (!r) continue;
      const next = [...rolls].reverse().find((x) => x.faction === s.faction && x.round === n + 1);
      const after = next ? next.units : s.roundsRolled === n ? s.units : null;
      views.push({
        faction: s.faction,
        rollType: "combat",
        round: n,
        hits: r.hits,
        dice: dice(r),
        losses: after && r.units.length ? lossesBetween(r.units, after) : null,
      });
    }
    rounds.push({ round: n, rolls: views });
  }
  return rounds;
}

function preRolls(combat: CombatState, holder: string, factions: string[], firstRoundAt: number | null): RollView[] {
  const now = firstRoundAt ?? Math.max(0, ...combat.rolls.map((r) => r.at));
  return combat.rolls
    .filter((r) => r.tile === combat.tile && PRE.includes(r.rollType) && factions.includes(r.faction))
    .filter((r) => (holder === "space" ? r.rollType === "afb" || r.rollType === "spacecannonoffence" : r.holder === holder))
    .filter((r) => r.at <= now + 1 && r.at >= now - PRE_WINDOW_MS)
    .map((r) => ({ faction: r.faction, rollType: r.rollType, round: null, hits: r.hits, dice: dice(r), losses: null }));
}

function frontsOf(combat: CombatState, me: string | null, names: Names): FrontView[] {
  return combat.fronts.map((f) => {
    const sides: SideView[] = f.sides.map((s) => ({
      faction: s.faction,
      userId: s.userId,
      self: s.userId === me,
      attacker: s.faction === combat.attacker,
      units: s.units,
      roundsRolled: s.roundsRolled,
    }));
    sides.sort((a, b) => Number(b.attacker) - Number(a.attacker));
    const rounds = roundsOf(combat, f.holder, sides);
    const firstAt = combat.rolls.find((r) => r.tile === combat.tile && r.holder === f.holder && r.rollType === "combat" && r.round === 1)?.at ?? null;
    const alive = sides.filter((s) => s.units.length > 0);
    const on = alive.length >= 2;
    const done = Math.min(...sides.map((s) => s.roundsRolled));
    const round = on ? done + 1 : Math.max(0, ...sides.map((s) => s.roundsRolled));
    let result: string | null = null;
    if (!on && round > 0) {
      const what = f.holder === "space" ? "the space combat" : "the ground combat";
      const winner = alive[0];
      result = !winner
        ? `Both sides destroyed in ${what} (round ${round})`
        : winner.self
          ? `You win ${what} (round ${round})`
          : `${names(winner.faction)} wins ${what} (round ${round})`;
    }
    return { holder: f.holder, sides, pre: preRolls(combat, f.holder, sides.map((s) => s.faction), firstAt), rounds, on, round, result };
  });
}

const optionTile = (o: AnyOption) => (o.value as { tile?: string | null } | null)?.tile ?? null;

/** Decisions about this combat: on its tile (or with no tile on their options). */
function aboutTile(d: Decision, tile: string) {
  if (!d.kind.startsWith("combat.")) return false;
  const subject = d.window?.subject.tile;
  if (subject != null) return field(subject) === tile;
  const tiles = optionsOf(d).map(optionTile).filter((t): t is string => !!t);
  return !tiles.length || tiles.includes(tile);
}

/** A window subject field as text ("" when absent or not a string / number). */
const field = (v: unknown, fallback = "") => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);

const live = (o: AnyOption) => !o.disabled && !o.needsInput && !!o.value && !o.id.includes("dummyPlayerSpoof");

/**
 * The combat view of the active system, or null when there is none. decisions: every open decision of the game
 * (mine and the others'), so the panel can say who it waits on.
 */
export function combatView(state: GameState | null, decisions: Decision[], me: string | null, names: Names): CombatView | null {
  const combat = state?.combat;
  if (!combat) return null;
  const tile = combat.tile;
  const myFaction = state?.players.find((p) => p.userId === me)?.faction ?? null;
  const fronts = frontsOf(combat, me, names);
  const relevant = decisions.filter((d) => aboutTile(d, tile));
  const owed = combat.owed ?? [];
  const step = stepOf(relevant, fronts, owed, me, names);
  const current =
    fronts.find((f) => f.holder === step.holder) ?? fronts.find((f) => f.on) ?? [...fronts].sort((a, b) => b.round - a.round)[0] ?? null;

  const rolls: RollChoice[] =
    step.kind === "roll" && step.decision
      ? optionsOf(step.decision)
          .filter(live)
          .filter((o) => {
            const v = o.value as { action?: string; rollType?: string; holder?: string };
            return v.action === "roll" && v.rollType === step.rollType && (step.rollType !== "combat" || v.holder === step.holder);
          })
          .map((option) => ({ decision: step.decision!, option }))
      : [];

  const abilities: AbilityChoice[] = [];
  const controls: RollChoice[] = [];
  const seen = new Set<string>();
  for (const d of relevant.filter((x) => x.kind === "combat.round")) {
    for (const o of optionsOf(d)) {
      if (!o.value || o.id.includes("dummyPlayerSpoof")) continue;
      const v = o.value as { action?: string; owner?: string | null; ability?: string; card?: string };
      const key = `${v.action}|${v.ability ?? v.card ?? o.label}`;
      if (seen.has(key)) continue;
      if (v.action === "ability") {
        const mine = !!myFaction && v.owner === myFaction;
        if (v.owner && !mine) continue;
        seen.add(key);
        abilities.push({ decision: d, option: o as Option<CombatAbilityValue>, mine });
        continue;
      }
      if (v.action === "temp_mod" && o.owner?.userId && o.owner.userId !== me) continue;
      if (["announce_retreat", "action_cards", "repair", "temp_mod", "automate"].includes(String(v.action))) {
        seen.add(key);
        controls.push({ decision: d, option: o });
      }
    }
  }
  return { tile, tileId: combat.tileId, fronts, current, step, owed, rolls, abilities, controls, log: logOf(fronts, me, names) };
}

function stepOf(decisions: Decision[], fronts: FrontView[], owed: HitsOwed[], me: string | null, names: Names): StepView {
  const base = { decision: null, holder: null, rollType: null } as const;
  const mineOwed = owed.find((o) => o.userId === me);
  if (mineOwed) {
    const d = decisions.find((x) => x.id === mineOwed.decisionId) ?? null;
    const menu = decisions.find((x) => x.kind === "combat.assign_units" && x.target?.userId === me) ?? null;
    const left = mineOwed.hits - mineOwed.assigned;
    return {
      ...base,
      kind: "assign",
      mine: true,
      decision: menu ?? d,
      holder: mineOwed.holder,
      text: `Your turn: assign ${plural(left, "hit")} to ${HIT_SOURCE[mineOwed.source] ?? "your units"} (${SOURCE_NAME[mineOwed.source] ?? mineOwed.source})`,
    };
  }
  const retreat = decisions.find((x) => x.kind === "combat.retreat" && x.target?.userId === me);
  if (retreat) return { ...base, kind: "retreat", mine: true, decision: retreat, text: "Retreat: choose where your ships go" };
  const theirs = owed[0];
  if (theirs)
    return {
      ...base,
      kind: "wait_assign",
      mine: false,
      holder: theirs.holder,
      text: `Waiting for ${names(theirs.faction)} to assign ${plural(theirs.hits - theirs.assigned, "hit")} (${SOURCE_NAME[theirs.source] ?? theirs.source})`,
    };

  const open = decisions.filter((d) => d.kind === "combat.round" && d.window?.kind === "combat_roll").filter((d) => {
    const w = d.window!;
    const holder = field(w.subject.holder, "space");
    const rollType = field(w.subject.rollType, "combat");
    if (rollType === "combat" && !fronts.find((f) => f.holder === holder)?.on) return false;
    return !!w.subject.waitingFor || w.eligible.some((u) => !w.responded.includes(u));
  });
  const minePending = open.find((d) => !d.window!.subject.waitingFor && !!me && d.window!.eligible.includes(me) && !d.window!.responded.includes(me));
  const pick = minePending ?? open[0];
  if (pick) {
    const w = pick.window!;
    const holder = field(w.subject.holder, "space");
    const rollType = field(w.subject.rollType, "combat") as RollType;
    const front = fronts.find((f) => f.holder === holder);
    const what = rollType === "combat" ? `round ${front?.round ?? 1}` : ROLL_LABEL[rollType];
    if (typeof w.subject.waitingFor === "string")
      return { kind: "blocked", mine: false, decision: null, holder, rollType, text: `Not yet: ${w.subject.waitingFor}` };
    if (pick === minePending)
      return { kind: "roll", mine: true, decision: pick, holder, rollType, text: rollType === "combat" ? `Roll for ${what}` : `Roll ${what}` };
    const waiting = w.eligible.filter((u) => !w.responded.includes(u)).map((u) => names(u));
    return { kind: "wait_roll", mine: false, decision: null, holder, rollType, text: `Waiting for ${waiting.join(", ")} to roll ${what}` };
  }
  const on = fronts.find((f) => f.on);
  if (on) return { ...base, kind: "idle", mine: false, holder: on.holder, text: `Round ${on.round}: waiting for the next roll prompt` };
  const last = [...fronts].reverse().find((f) => f.result);
  return { ...base, kind: "over", mine: false, holder: last?.holder ?? null, text: last?.result ?? "Combat over" };
}

function lossText(losses: Loss[] | null): string {
  if (!losses?.length) return "";
  return losses
    .map((l) => [l.destroyed ? `${l.destroyed} ${l.unit}` : "", l.sustained ? `${l.sustained} ${l.unit} sustained` : ""].filter(Boolean).join(", "))
    .join(", ");
}

/** Short combat log: pre-combat rolls, each round's hits and losses, the result. */
function logOf(fronts: FrontView[], me: string | null, names: Names): string[] {
  const who = (f: FrontView, faction: string) => (f.sides.find((s) => s.faction === faction)?.userId === me ? "You" : names(faction));
  const out: string[] = [];
  for (const f of fronts) {
    const where = f.holder === "space" ? "Space" : "Ground";
    for (const r of f.pre) out.push(`${where} · ${ROLL_LABEL[r.rollType]}: ${who(f, r.faction)} ${plural(r.hits, "hit")}`);
    for (const round of f.rounds) {
      const hits = round.rolls.map((r) => `${who(f, r.faction)} ${plural(r.hits, "hit")}`).join(" · ");
      const lost = round.rolls
        .map((r) => {
          const t = lossText(r.losses);
          return t ? `${who(f, r.faction)} lost ${t}` : "";
        })
        .filter(Boolean)
        .join("; ");
      out.push(`${where} R${round.round} · ${hits}${lost ? ` — ${lost}` : ""}`);
    }
    if (f.result) out.push(f.result);
  }
  return out;
}

/** The units of mine in this holder that may NOT take hits of this source, with the reason (shown greyed). */
export function ineligibleUnits(
  state: GameState | null,
  tile: string,
  holder: string,
  source: string,
  me: string | null,
): { unit: string; holder: string; count: number; reason: string }[] {
  const myFaction = state?.players.find((p) => p.userId === me)?.faction;
  const t = state?.tiles.find((x) => x.position === tile);
  if (!t || !myFaction) return [];
  const out: { unit: string; holder: string; count: number; reason: string }[] = [];
  const holders = source === "ground" ? t.holders.filter((h) => h.name === holder) : t.holders;
  for (const h of holders) {
    for (const u of h.units) {
      if (u.owner !== myFaction || u.count <= 0) continue;
      const reason = hitRefusal(u.unit, h.name, source);
      if (reason) out.push({ unit: u.unit, holder: h.name, count: u.count, reason });
    }
  }
  return out;
}

const GROUND = new Set(["gf", "mf"]);
const STRUCTURE = new Set(["pd", "sd"]);

/**
 * Display mirror of the bot's CombatHitRules (the bot is the authority and refuses illegal picks): space combat and
 * space cannon hits land on ships in space, barrage hits on fighters, ground hits on ground forces on the planet.
 */
export function hitRefusal(unit: string, holder: string, source: string): string | null {
  const inSpace = holder === "space";
  if (source === "afb") return inSpace && unit === "ff" ? null : "barrage hits land on fighters only";
  if (source === "ground") {
    if (inSpace) return "not on the planet";
    return GROUND.has(unit) ? null : "structures take no ground combat hits";
  }
  if (!inSpace) return "on a planet: not in the space combat";
  if (GROUND.has(unit)) return "transported: ground forces take no space combat hits";
  if (STRUCTURE.has(unit)) return "not a ship";
  return null;
}
