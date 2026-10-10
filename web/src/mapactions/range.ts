import type { PlayerDataResponse } from "@/entities/data/types";
import type { Tile } from "@/entities/game/types";
import { getTileById } from "@/entities/lookup/systems";

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
 * A hint only — hyperlanes, gravity rifts and abilities are left to the bot. Unreachable systems are absent.
 */
export function distancesTo(
  target: string,
  tiles: Record<string, Tile>,
  faction: string,
  techs: string[],
  web?: PlayerDataResponse,
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
  const amd = techs.includes("amd") || techs.includes("absol_amd");
  /* Can a ship pass through (not end in) this system? */
  const passable = (t: Tile) => {
    const info = getTileById(t.systemId);
    if (info?.isSupernova || info?.isNebula) return false;
    if (info?.isAsteroidField && !amd) return false;
    return !enemyShips(t.position, faction, web);
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
      const nd = lane(n) ? d : d + 1;
      if ((dist.get(n.position) ?? Infinity) <= nd) continue;
      dist.set(n.position, nd);
      if (lane(n)) queue.unshift(n);
      else if (passable(n)) queue.push(n);
    }
  }
  for (const t of list) if (lane(t)) dist.delete(t.position);
  return dist;
}
