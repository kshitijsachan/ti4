import {
  countUnit,
  distancesTo,
  enemyGroundOn,
  enemyShipsIn,
  isShip,
  type Board,
  type PlanetView,
  type PlayerView,
  type SystemView,
} from "./board.js";
import { statsOf } from "./units.js";

/*
 * Choosing what to do (the goal). Executing it (the bot's buttons) lives in tactical.ts. Everything here is a pure
 * function of the board so later strategy layers (objective planner, combat odds, faction playbooks) can replace or
 * re-rank the candidates without touching the button flow.
 */

/** Units to take from one place of one origin system ("space" or a planet id). */
export type MoveOrder = { origin: string; holder: string; unit: string; count: number };

export type ExpandGoal = {
  kind: "expand";
  target: string;
  moves: MoveOrder[];
  /** planet → infantry to land there. */
  land: Record<string, number>;
  why: string;
};

export type ProduceGoal = { kind: "produce"; target: string; why: string };

export type Goal = ExpandGoal | ProduceGoal | { kind: "pass"; why: string };

/** How much a planet is worth to take (the planet-valuation hook; legendary / skips come later). */
export function planetValue(p: PlanetView): number {
  return p.resources + p.influence * 0.75 + 0.5;
}

/** A planet we could land on without a fight: nobody controls it, nobody stands on it, no custodians. */
export function freePlanet(p: PlanetView, me: PlayerView) {
  if (p.controlledBy && p.controlledBy !== me.faction && p.controlledBy !== me.color) return false;
  if (me.planets.includes(p.id)) return false;
  if (enemyGroundOn(p, me.faction)) return false;
  if (p.tokens.some((t) => /custodian/i.test(t))) return false;
  return true;
}

export function hasMyCC(sys: SystemView, me: PlayerView) {
  return sys.ccs.includes(me.color) || sys.ccs.includes(me.faction);
}

/** Systems with my space dock. */
export function dockSystems(board: Board, me: PlayerView): SystemView[] {
  return [...board.systems.values()].filter((s) => s.planets.some((p) => countUnit(p.units.get(me.faction), "sd") > 0));
}

/** Resources I can still spend this round (unexhausted planets + trade goods). */
export function spendable(board: Board, me: PlayerView, kind: "res" | "inf" = "res") {
  let n = me.tg;
  for (const id of me.planets) {
    if (me.exhaustedPlanets.has(id)) continue;
    const pos = board.planetSystem.get(id);
    const p = pos ? board.systems.get(pos)?.planets.find((x) => x.id === id) : undefined;
    if (p) n += kind === "res" ? p.resources : p.influence;
  }
  return n;
}

/** Tactic tokens kept back (for defence) from round 5 on. */
export function reserve(board: Board) {
  return board.round >= 5 ? 1 : 0;
}

type Carrier = { origin: string; unit: string; move: number; capacity: number };

/** Every expansion this player could make right now, best first. */
export function expansionOptions(board: Board, me: PlayerView): ExpandGoal[] {
  const out: (ExpandGoal & { score: number })[] = [];
  const homes = new Set(dockSystems(board, me).map((s) => s.position));
  for (const target of board.systems.values()) {
    if (target.anomaly || target.hyperlane || !target.hex) continue;
    if (hasMyCC(target, me) || enemyShipsIn(target, me.faction)) continue;
    const free = target.planets.filter((p) => freePlanet(p, me));
    if (!free.length) continue;
    const dist = distancesTo(board, target.position, me.faction, 3);
    // The best transport that reaches it: a carrier (or another ship with capacity) in an unlocked system.
    let best: { score: number; goal: ExpandGoal } | null = null;
    for (const [origin, d] of dist) {
      const sys = board.systems.get(origin);
      if (!sys || hasMyCC(sys, me)) continue;
      if (origin === target.position) continue;
      const ships = sys.space.get(me.faction) ?? [];
      const carriers: Carrier[] = ships
        .filter((u) => isShip(u.unit) && u.unit !== "ff")
        .map((u) => ({ origin, unit: u.unit, ...statsOf(u.unit, me) }))
        .map((c) => (sys.anomaly ? { ...c, move: Math.min(c.move, 1) } : c))
        .filter((c) => c.capacity > 0 && c.move >= d)
        .sort((a, b) => b.capacity - a.capacity);
      if (!carriers.length) continue;
      const carrier = carriers[0];
      // Ground forces in the origin: in space, and on my planets there (keep one at home when it has 3+).
      const inSpace = countUnit(ships, "gf");
      const onPlanets = sys.planets
        .filter((p) => me.planets.includes(p.id))
        .map((p) => ({ id: p.id, n: countUnit(p.units.get(me.faction), "gf") }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n);
      const total = inSpace + onPlanets.reduce((a, x) => a + x.n, 0);
      // A home with 3+ infantry keeps one on its biggest planet.
      const keep = homes.has(origin) && total >= 3 && onPlanets.length ? 1 : 0;
      const want = Math.min(carrier.capacity, total - keep, free.length + 1);
      if (want < 1) continue;
      const moves: MoveOrder[] = [{ origin, holder: "space", unit: carrier.unit, count: 1 }];
      let left = want;
      const fromSpace = Math.min(left, inSpace);
      if (fromSpace) moves.push({ origin, holder: "space", unit: "gf", count: fromSpace });
      left -= fromSpace;
      for (const p of onPlanets) {
        if (!left) break;
        const take = Math.min(left, p.n - (keep && p === onPlanets[0] ? 1 : 0));
        if (take > 0) {
          moves.push({ origin, holder: p.id, unit: "gf", count: take });
          left -= take;
        }
      }
      const carried = want - left;
      if (carried < 1) continue;
      // One escort if one is there and fast enough (not the last ship guarding a dock).
      const escort = ships
        .filter((u) => (u.unit === "dd" || u.unit === "ca") && (sys.anomaly ? 1 : statsOf(u.unit, me).move) >= d)
        .sort((a, b) => statsOf(a.unit, me).combat - statsOf(b.unit, me).combat)[0];
      if (escort) moves.push({ origin, holder: "space", unit: escort.unit, count: 1 });
      // Land one per planet, best planets first; extras on the best one.
      const ranked = [...free].sort((a, b) => planetValue(b) - planetValue(a));
      const land: Record<string, number> = {};
      let toLand = carried;
      for (const p of ranked) {
        if (!toLand) break;
        land[p.id] = 1;
        toLand--;
      }
      if (toLand && ranked[0]) land[ranked[0].id] += toLand;
      const value = ranked.filter((p) => land[p.id]).reduce((a, p) => a + planetValue(p), 0);
      const score = value - d * 0.5;
      const names = Object.entries(land)
        .map(([p, n]) => `${n} inf on ${p}`)
        .join(", ");
      const what = moves
        .filter((m) => m.holder === "space" && m.unit !== "gf")
        .map((m) => `${m.count} ${statsOf(m.unit).name}`)
        .concat([`${carried} inf`])
        .join(" + ");
      const goal: ExpandGoal = {
        kind: "expand",
        target: target.position,
        moves,
        land,
        why: `tactical ${target.position} (${free.map((p) => p.id).join("/")}) — move ${what} from ${origin}, land ${names}`,
      };
      if (!best || score > best.score) best = { score, goal };
    }
    if (best) out.push({ ...best.goal, score: best.score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** What to do with this action-phase turn (the strategy card, if unplayed, is played before this is asked). */
export function chooseGoal(board: Board, me: PlayerView): Goal {
  if (me.tacticalCC <= reserve(board)) return { kind: "pass", why: `no spare tactic tokens (${me.tacticalCC})` };
  const expand = expansionOptions(board, me)[0];
  if (expand) return expand;
  const dock = dockSystems(board, me).find((s) => !hasMyCC(s, me) && !enemyShipsIn(s, me.faction));
  const budget = spendable(board, me);
  if (dock && budget >= 3) return { kind: "produce", target: dock.position, why: `tactical ${dock.position} — produce with ${budget} resources` };
  return { kind: "pass", why: dock ? `only ${budget} resources to produce with` : "nothing to expand to or produce" };
}

/**
 * What to build at a dock with `budget` resources and `capacity` units of production: carriers and infantry early,
 * then cruisers / destroyers, dreadnoughts from round 3. Returns unit ids (gf counts are single infantry).
 */
export function buildList(board: Board, me: PlayerView, budget: number, capacity: number): string[] {
  const out: string[] = [];
  const left = { budget, capacity };
  const deployed = (u: string) => me.unitCounts[u]?.deployedCount ?? 0;
  const cap = (u: string) => me.unitCounts[u]?.unitCap ?? 99;
  const planned = (u: string) => out.filter((x) => x === u).length;
  const take = (u: string) => {
    const st = statsOf(u, me);
    if (left.budget < st.cost || left.capacity < st.per) return false;
    if (deployed(u) + planned(u) + st.per > cap(u)) return false;
    out.push(u);
    left.budget -= st.cost;
    left.capacity -= st.per;
    if (st.per === 2) out.push(u);
    return true;
  };
  const carriers = deployed("cv");
  if (carriers < 3) take("cv");
  if (board.round >= 3) take("dn");
  // Infantry pairs to fill the carriers, then a cruiser or destroyer.
  for (let i = 0; i < 2; i++) take("gf");
  if (!take("ca")) take("dd");
  while (left.budget >= 1 && left.capacity >= 1 && out.length < 12) {
    if (!take("gf") && !take("dd")) break;
  }
  return out;
}
