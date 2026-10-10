import type { PlayerDataResponse } from "@/entities/data/types";
import type { Tile } from "@/entities/game/types";
import { getTileById } from "@/entities/lookup/systems";

/** Centre-to-centre distance of neighbouring hexes on the map (TILE_HEIGHT), with slack. */
const NEIGHBOUR_MIN = 270;
const NEIGHBOUR_MAX = 330;
const GROUND = new Set(["gf", "mf", "pd", "sd"]);

function wormholesOf(tile: Tile, web?: PlayerDataResponse) {
  const out = new Set<string>();
  for (const w of getTileById(tile.systemId)?.wormholes ?? []) if (w) out.add(w.toLowerCase());
  for (const list of Object.values(web?.tileUnitData?.[tile.position]?.space ?? {})) {
    for (const e of list) {
      if (e.entityType !== "token") continue;
      const m = e.entityId.toLowerCase().match(/(alpha|beta|gamma)/);
      if (m) out.add(m[1]);
    }
  }
  return out;
}

function enemyShips(position: string, faction: string, web?: PlayerDataResponse) {
  const space = web?.tileUnitData?.[position]?.space ?? {};
  return Object.entries(space).some(
    ([f, list]) => f !== faction && f !== "neutral" && list.some((e) => e.entityType === "unit" && e.count > 0 && !GROUND.has(e.entityId)),
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
  const list = Object.values(tiles).filter((t) => t.systemId && !getTileById(t.systemId)?.isHyperlane);
  const holes = new Map(list.map((t) => [t.position, wormholesOf(t, web)]));
  const neighbours = (t: Tile) => {
    const out: Tile[] = [];
    const mine = holes.get(t.position)!;
    for (const o of list) {
      if (o === t) continue;
      const d = Math.hypot(o.properties.x - t.properties.x, o.properties.y - t.properties.y);
      if (d >= NEIGHBOUR_MIN && d <= NEIGHBOUR_MAX) out.push(o);
      else if ([...holes.get(o.position)!].some((w) => mine.has(w))) out.push(o);
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
  let frontier = [start];
  for (let d = 1; frontier.length && d <= 6; d++) {
    const next: Tile[] = [];
    for (const t of frontier) {
      for (const n of neighbours(t)) {
        if (dist.has(n.position)) continue;
        dist.set(n.position, d);
        if (passable(n)) next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}
