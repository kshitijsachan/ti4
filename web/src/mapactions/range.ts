import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import type { Tile } from "@/entities/game/types";
import { getTileById } from "@/entities/lookup/systems";
import { groupKey, type MovePlan, type UnitGroup } from "./movement";

/** Neighbouring hexes sit at the map's smallest centre-to-centre distance; this much slack is allowed. */
const NEIGHBOUR_SLACK = 1.12;
const GROUND = new Set(["gf", "mf", "pd", "sd"]);

function wormholesOf(tile: Tile, web?: PlayerDataResponse) {
  const out = new Set<string>();
  for (const w of getTileById(tile.systemId)?.wormholes ?? [])
    if (w) out.add(w.toLowerCase());
  for (const list of Object.values(
    web?.tileUnitData?.[tile.position]?.space ?? {},
  )) {
    for (const e of list) {
      if (e.entityType !== "token") continue;
      const m = e.entityId.toLowerCase().match(/(alpha|beta|gamma)/);
      if (m) out.add(m[1]);
    }
  }
  return out;
}

function enemyShips(
  position: string,
  faction: string,
  web?: PlayerDataResponse,
) {
  const space = web?.tileUnitData?.[position]?.space ?? {};
  return Object.entries(space).some(
    ([f, list]) =>
      f !== faction &&
      f !== "neutral" &&
      list.some(
        (e) =>
          e.entityType === "unit" && e.count > 0 && !GROUND.has(e.entityId),
      ),
  );
}

/**
 * Hex distance from every system to `target` for my ships, by the map's geometry and wormholes, around systems
 * ships cannot pass (supernovas, nebulas, asteroid fields without Antimass Deflectors, other players' ships).
 * A hint only (gravity rifts count their +1 move; hyperlanes and abilities are left to the bot). Unreachable systems are absent.
 */
export function distancesTo(
  target: string,
  tiles: Record<string, Tile>,
  faction: string,
  techs: string[],
  web?: PlayerDataResponse,
  relics: string[] = [],
  rifts = true,
): Map<string, number> {
  const list = Object.values(tiles).filter(
    (t) => t.systemId && t.position !== "special",
  );
  const lane = (t: Tile) => !!getTileById(t.systemId)?.isHyperlane;
  const holes = new Map(list.map((t) => [t.position, wormholesOf(t, web)]));
  const gap = (a: Tile, b: Tile) =>
    Math.hypot(
      a.properties.x - b.properties.x,
      a.properties.y - b.properties.y,
    );
  let step = Infinity;
  for (const a of list)
    for (const b of list)
      if (a !== b) step = Math.min(step, gap(a, b) || Infinity);
  const neighbours = (t: Tile) => {
    const out: Tile[] = [];
    const mine = holes.get(t.position)!;
    for (const o of list) {
      if (o === t) continue;
      if (gap(o, t) <= step * NEIGHBOUR_SLACK) out.push(o);
      else if ([...holes.get(o.position)!].some((w) => mine.has(w)))
        out.push(o);
    }
    return out;
  };
  /* Circlet of the Void: my units ignore anomalies. Light/Wave Deflector: my ships move through others' ships. */
  const circlet = relics.includes("circletofthevoid");
  const amd = circlet || techs.includes("amd") || techs.includes("absol_amd");
  const lwd = techs.includes("lwd") || techs.includes("absol_lwd");
  /* Can a ship pass through (not end in) this system? */
  const passable = (t: Tile) => {
    const info = getTileById(t.systemId);
    if (info?.isSupernova || (info?.isNebula && !circlet)) return false;
    if (info?.isAsteroidField && !amd) return false;
    return lwd || !enemyShips(t.position, faction, web);
  };
  const enterable = (t: Tile) => {
    const info = getTileById(t.systemId);
    if (info?.isSupernova) return false;
    return !(info?.isAsteroidField && !amd);
  };

  /* Search outwards from the target: a ship at distance d reaches it through d-1 passable systems. */
  const dist = new Map<string, number>([[target, 0]]);
  const start = tiles[target];
  if (!start || !enterable(start)) return dist;
  /* Hyperlanes cost nothing to cross (and, as a hint, are taken to join all their neighbours). */
  const queue: Tile[] = [start];
  while (queue.length) {
    const t = queue.shift()!;
    const d = dist.get(t.position)!;
    if (d >= 6) continue;
    for (const n of neighbours(t)) {
      /* A ship leaving a gravity rift (starting in it or passing through) gets +1 move: the rift costs nothing. */
      const rift = rifts && !!getTileById(n.systemId)?.isGravityRift;
      const nd = lane(n) || rift ? d : d + 1;
      if ((dist.get(n.position) ?? Infinity) <= nd) continue;
      dist.set(n.position, nd);
      if (lane(n)) queue.unshift(n);
      else if (passable(n)) queue.push(n);
    }
  }
  for (const t of list) if (lane(t)) dist.delete(t.position);
  return dist;
}

/** A move bonus for this tactical action: to every ship (`ships` Infinity, e.g. Flank Speed) or to a few (Gravity Drive: one). */
export type MoveBonus = { name: string; amount: number; ships: number };

/** The move bonuses my technologies give without a press, as far as the map can tell (the game checks the move itself). */
export function passiveBonuses(me: PlayerData | undefined): MoveBonus[] {
  const techs = new Set(me?.techs ?? []);
  const exhausted = new Set(me?.exhaustedTechs ?? []);
  const out: MoveBonus[] = [];
  if (techs.has("gd") && !exhausted.has("gd")) out.push({ name: "Gravity Drive", amount: 1, ships: 1 });
  return out;
}

const allShips = (bonuses: MoveBonus[]) => bonuses.filter((b) => b.ships === Infinity);
const fewShips = (bonuses: MoveBonus[]) => bonuses.filter((b) => b.ships !== Infinity);
const boost = (bonuses: MoveBonus[]) => allShips(bonuses).reduce((a, b) => a + b.amount, 0);
const boostNames = (bonuses: MoveBonus[]) => allShips(bonuses).map((b) => b.name).join(" + ");

export type Reach =
  /** Within its move (`via`: the all-ship bonuses it needs). */
  | { kind: "ok"; move: number; needs?: number; via?: string }
  /** Only with a one-ship bonus (`left`: how many more ships it can still go to). */
  | { kind: "bonus"; move: number; needs: number; bonus: MoveBonus; left: number; via?: string }
  | { kind: "far"; move: number; needs?: number; bonus?: MoveBonus; used?: boolean };

/** How many planned ships lean on each one-ship bonus. */
function bonusUse(
  plan: MovePlan,
  groups: Record<string, UnitGroup[]>,
  distances: Map<string, number>,
  bonuses: MoveBonus[],
) {
  const used = new Map<string, number>();
  const all = boost(bonuses);
  for (const [origin, picks] of Object.entries(plan)) {
    const d = distances.get(origin);
    if (d === undefined) continue;
    for (const g of groups[origin] ?? []) {
      const n = picks[groupKey(g)] ?? 0;
      if (!n || g.cargo || g.move + all >= d) continue;
      const b = fewShips(bonuses).find((x) => g.move + all + x.amount >= d);
      if (b) used.set(b.name, (used.get(b.name) ?? 0) + n);
    }
  }
  return used;
}

/** Whether a ship of `g` in `origin` reaches the target, counting my bonuses (one-ship ones not yet spent elsewhere). */
export function reachOf(
  g: UnitGroup,
  origin: string,
  plan: MovePlan,
  groups: Record<string, UnitGroup[]>,
  distances: Map<string, number>,
  bonuses: MoveBonus[],
): Reach {
  const needs = distances.get(origin);
  if (g.cargo || needs === undefined || g.move >= needs) return { kind: "ok", move: g.move, needs };
  const all = boost(bonuses);
  const via = all ? boostNames(bonuses) : undefined;
  if (g.move + all >= needs) return { kind: "ok", move: g.move, needs, via };
  const bonus = fewShips(bonuses).find((b) => g.move + all + b.amount >= needs);
  if (!bonus) return { kind: "far", move: g.move, needs };
  const used = bonusUse(plan, groups, distances, bonuses).get(bonus.name) ?? 0;
  const mine = plan[origin]?.[groupKey(g)] ?? 0;
  /* What this group holds already stays; the rest of the bonus is open to it. */
  const left = bonus.ships - (used - mine);
  if (left <= 0) return { kind: "far", move: g.move, needs, bonus, used: true };
  return { kind: "bonus", move: g.move, needs, bonus, left, via };
}

/** "Move 1, needs 2 — reaches with Gravity Drive". */
export function reachText(r: Reach): string {
  if (r.kind === "ok") return r.via && r.needs !== undefined ? `Move ${r.move}, needs ${r.needs} — reaches with ${r.via}` : `Move ${r.move}`;
  const head = `Move ${r.move}, needs ${r.needs}`;
  if (r.kind === "bonus") return `${head} — reaches with ${r.via ? `${r.via} and ` : ""}${r.bonus.name}`;
  if (r.bonus && r.used) return `${head} — ${r.bonus.name} is already on another ship, can't reach`;
  return `${head} — can't reach`;
}

/** Planned ships the map counts out of reach (too slow, or a one-ship bonus spread over too many). */
export function outOfReach(
  plan: MovePlan,
  groups: Record<string, UnitGroup[]>,
  distances: Map<string, number>,
  bonuses: MoveBonus[],
): string[] {
  const out: string[] = [];
  const used = bonusUse(plan, groups, distances, bonuses);
  const all = boost(bonuses);
  for (const [origin, picks] of Object.entries(plan)) {
    const d = distances.get(origin);
    if (d === undefined) continue;
    for (const g of groups[origin] ?? []) {
      const n = picks[groupKey(g)] ?? 0;
      if (!n || g.cargo || g.move + all >= d) continue;
      const b = fewShips(bonuses).find((x) => g.move + all + x.amount >= d);
      if (!b) out.push(`${g.name} (move ${g.move}, needs ${d})`);
    }
  }
  for (const b of fewShips(bonuses)) {
    const n = used.get(b.name) ?? 0;
    if (n > b.ships) out.push(`${n} ships need ${b.name}, which helps ${b.ships === 1 ? "only one" : `only ${b.ships}`}`);
  }
  return out;
}

/** The most an origin's fastest ship can gain: every all-ship bonus plus the biggest one-ship bonus. */
export function maxBoost(bonuses: MoveBonus[]) {
  return boost(bonuses) + Math.max(0, ...fewShips(bonuses).map((b) => b.amount));
}
