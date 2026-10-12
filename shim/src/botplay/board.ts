import type { Json } from "../store.js";
import { HYPERLANES } from "./hyperlanes.js";

/*
 * The board as an autopilot sees it: the bot's web data (GET /api/public/game/{g}/web-data) turned into systems,
 * hex adjacency, units and planets. Read-only and conservative: hyperlanes, wormholes and anomalies are treated as
 * walls, so a move this module calls legal is legal (it may miss some that are).
 */

export type UnitStack = { unit: string; count: number; damaged: number };

export type PlanetView = {
  id: string;
  resources: number;
  influence: number;
  controlledBy: string | null;
  exhausted: boolean;
  /** faction → its units on the planet. */
  units: Map<string, UnitStack[]>;
  /** Neutral tokens (custodians, …). */
  tokens: string[];
};

export type SystemView = {
  position: string;
  tileId: string;
  anomaly: boolean;
  hyperlane: boolean;
  /** Command token colours in the system. */
  ccs: string[];
  /** faction → its units in space. */
  space: Map<string, UnitStack[]>;
  planets: PlanetView[];
  /** colour → production value there. */
  production: Map<string, number>;
  /** Axial hex coordinates (null for corners / off-ring positions). */
  hex: { q: number; r: number } | null;
};

export type PlayerView = {
  userId: string;
  faction: string;
  color: string;
  name: string;
  planets: string[];
  exhaustedPlanets: Set<string>;
  techs: string[];
  unitsOwned: string[];
  tacticalCC: number;
  fleetCC: number;
  strategicCC: number;
  tg: number;
  commodities: number;
  passed: boolean;
  scs: number[];
  exhaustedSCs: number[];
  vps: number;
  unitCounts: Record<string, { unitCap: number; deployedCount: number }>;
  raw: Json;
};

export type Board = {
  game: string;
  round: number;
  phase: string;
  activePlayer: string | null;
  activeSystem: string | null;
  players: PlayerView[];
  systems: Map<string, SystemView>;
  /** planet id → system position. */
  planetSystem: Map<string, string>;
  objectives: Json[];
  strategyCards: Json[];
  raw: Json;
};

const SHIPS = new Set(["cv", "ca", "dd", "dn", "ws", "fs", "ff"]);
export const isShip = (u: string) => SHIPS.has(u);
const STRUCTURE = new Set(["pd", "sd"]);
export const isStructure = (u: string) => STRUCTURE.has(u);

/** PoK / base-game hyperlane tiles (83a … 91b, any rotation). */
const HYPERLANE = /^(8[3-9]|9[01])[ab]/;

function stacks(list: Json[] | undefined): UnitStack[] {
  const out: UnitStack[] = [];
  for (const e of list ?? []) {
    if (e?.entityType !== "unit" || !(e.count > 0)) continue;
    const states: number[] = e.unitStates ?? [];
    const damaged = states.length ? (states[1] ?? 0) + (states[3] ?? 0) : Math.min(e.sustained ?? 0, e.count);
    out.push({ unit: String(e.entityId), count: e.count, damaged });
  }
  return out;
}

function tokens(list: Json[] | undefined): string[] {
  return (list ?? []).filter((e) => e?.entityType === "token").map((e) => String(e.entityId));
}

/** Ring r slot s (1 at the top, clockwise) → axial coordinates of a flat-topped hex grid. */
export function hexOf(position: string): { q: number; r: number } | null {
  if (!/^\d{3,4}$/.test(position)) return null;
  const ring = Number(position.slice(0, -2));
  const slot = Number(position.slice(-2));
  if (ring === 0) return { q: 0, r: 0 };
  if (slot < 1 || slot > ring * 6) return null;
  // Corners walked clockwise from the top: N → NE → SE → S → SW → NW; each side steps in one direction.
  const steps = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ];
  let q = 0;
  let r = -ring;
  let left = slot - 1;
  for (const [dq, dr] of steps) {
    const n = Math.min(left, ring);
    q += dq * n;
    r += dr * n;
    left -= n;
    if (!left) break;
  }
  return { q, r };
}

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }) {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

export function parseBoard(game: string, data: Json, users?: Record<string, Json>): Board {
  const systems = new Map<string, SystemView>();
  const planetSystem = new Map<string, string>();
  const tileIds = new Map<string, string>();
  for (const entry of data.tilePositions ?? []) {
    const [pos, id] = String(entry).split(":");
    tileIds.set(pos, id ?? "");
  }
  for (const [pos, t] of Object.entries<Json>(data.tileUnitData ?? {})) {
    const space = new Map<string, UnitStack[]>();
    for (const [f, list] of Object.entries<Json[]>(t.space ?? {})) {
      const s = stacks(list);
      if (s.length) space.set(f, s);
    }
    const planets: PlanetView[] = [];
    for (const [pid, p] of Object.entries<Json>(t.planets ?? {})) {
      const units = new Map<string, UnitStack[]>();
      const toks: string[] = [];
      for (const [f, list] of Object.entries<Json[]>(p.entities ?? {})) {
        const s = stacks(list);
        if (s.length) units.set(f, s);
        toks.push(...tokens(list));
      }
      planets.push({
        id: pid,
        resources: Number(p.resources ?? 0),
        influence: Number(p.influence ?? 0),
        controlledBy: p.controlledBy ? String(p.controlledBy) : null,
        exhausted: !!p.exhausted,
        units,
        tokens: toks,
      });
      planetSystem.set(pid, pos);
    }
    const tileId = tileIds.get(pos) ?? "";
    systems.set(pos, {
      position: pos,
      tileId,
      anomaly: !!t.anomaly,
      hyperlane: HYPERLANE.test(tileId),
      ccs: (t.ccs ?? []).map((c: Json) => String(typeof c === "string" ? c : (c?.color ?? c?.faction ?? ""))),
      space,
      planets,
      production: new Map(Object.entries<number>(t.production ?? {})),
      hex: hexOf(pos),
    });
  }
  const players: PlayerView[] = [];
  for (const p of data.playerData ?? []) {
    if (!p.faction || p.faction === "null" || p.faction === "neutral" || !p.discordId) continue;
    players.push({
      userId: String(p.discordId),
      faction: String(p.faction),
      color: String(p.color),
      name: String(users?.[String(p.discordId)]?.global_name ?? p.userName ?? p.faction),
      planets: (p.planets ?? []).map(String),
      exhaustedPlanets: new Set((p.exhaustedPlanets ?? []).map(String)),
      techs: (p.techs ?? []).map(String),
      unitsOwned: (p.unitsOwned ?? []).map(String),
      tacticalCC: Number(p.tacticalCC ?? 0),
      fleetCC: Number(p.fleetCC ?? 0),
      strategicCC: Number(p.strategicCC ?? 0),
      tg: Number(p.tg ?? 0),
      commodities: Number(p.commodities ?? 0),
      passed: !!p.passed,
      scs: (p.scs ?? []).map(Number),
      exhaustedSCs: (p.exhaustedSCs ?? []).map(Number),
      vps: Number(p.totalVps ?? 0),
      unitCounts: p.unitCounts ?? {},
      raw: p,
    });
  }
  return {
    game,
    round: Number(data.gameRound ?? 1),
    phase: String(data.gameState?.phase ?? ""),
    activePlayer: data.gameState?.activePlayer ? String(data.gameState.activePlayer) : null,
    activeSystem: data.gameState?.activeSystem ? String(data.gameState.activeSystem) : null,
    players,
    systems,
    planetSystem,
    objectives: data.objectives?.allObjectives ?? [],
    strategyCards: data.strategyCards ?? [],
    raw: data,
  };
}

export function playerOf(board: Board, userId: string) {
  return board.players.find((p) => p.userId === userId);
}

/** Hex directions in the bot's order: N, NE, SE, S, SW, NW (axial deltas of a flat-topped grid). */
const DIRS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

function at(board: Board, q: number, r: number): SystemView | undefined {
  for (const s of board.systems.values()) if (s.hex && s.hex.q === q && s.hex.r === r) return s;
  return undefined;
}

/**
 * Systems adjacent to `pos`: sharing an edge, or joined through hyperlanes (followed lane by lane with the bot's
 * connection table). Hyperlane tiles themselves are never returned. Wormholes are ignored.
 */
export function neighbours(board: Board, pos: string): SystemView[] {
  const s = board.systems.get(pos);
  if (!s?.hex) return [];
  const cache = (board as Board & { _adj?: Map<string, SystemView[]> })._adj ?? new Map<string, SystemView[]>();
  (board as Board & { _adj?: Map<string, SystemView[]> })._adj = cache;
  const hit = cache.get(pos);
  if (hit) return hit;
  const out = new Map<string, SystemView>();
  const walk = (lane: SystemView, enteredFrom: number, depth: number) => {
    const data = HYPERLANES[lane.tileId];
    if (!data || depth > 6 || !lane.hex) return;
    const row = data.split(";")[enteredFrom] ?? "";
    for (let e = 0; e < 6; e++) {
      if (row[e] !== "1") continue;
      const n = at(board, lane.hex.q + DIRS[e][0], lane.hex.r + DIRS[e][1]);
      if (!n || n.position === pos) continue;
      if (n.hyperlane) walk(n, (e + 3) % 6, depth + 1);
      else out.set(n.position, n);
    }
  };
  for (let d = 0; d < 6; d++) {
    const n = at(board, s.hex.q + DIRS[d][0], s.hex.r + DIRS[d][1]);
    if (!n) continue;
    if (n.hyperlane) walk(n, (d + 3) % 6, 0);
    else out.set(n.position, n);
  }
  const list = [...out.values()];
  cache.set(pos, list);
  return list;
}

/** Other factions' ships (not fighters alone count too) in a system's space. */
export function enemyShipsIn(sys: SystemView, faction: string) {
  for (const [f, list] of sys.space) {
    if (f === faction || f === "neutral") continue;
    if (list.some((u) => isShip(u.unit))) return true;
  }
  return false;
}

export function enemyGroundOn(p: PlanetView, faction: string) {
  for (const [f, list] of p.units) if (f !== faction && list.length) return true;
  return false;
}

/** Whether a ship may pass through (not stop in) a system. */
function passable(sys: SystemView, faction: string) {
  return !sys.anomaly && !sys.hyperlane && !enemyShipsIn(sys, faction);
}

/**
 * Movement distance from every system to `target` for `faction`'s ships: steps through passable systems only
 * (no anomalies, hyperlanes or enemy ships on the way). Unreachable systems are absent.
 */
export function distancesTo(board: Board, target: string, faction: string, max = 4): Map<string, number> {
  const dist = new Map<string, number>([[target, 0]]);
  const queue = [target];
  while (queue.length) {
    const pos = queue.shift()!;
    const d = dist.get(pos)!;
    if (d >= max) continue;
    for (const n of neighbours(board, pos)) {
      if (dist.has(n.position) || n.hyperlane) continue;
      dist.set(n.position, d + 1);
      // Ships may start in an anomaly (a nebula home system) but never pass through one.
      if (n.anomaly) continue;
      // A ship starting in n reaches the target; going further out must pass through n.
      if (passable(n, faction)) queue.push(n.position);
    }
  }
  return dist;
}

export function myUnits(sys: SystemView, faction: string): UnitStack[] {
  return sys.space.get(faction) ?? [];
}

export function countUnit(list: UnitStack[] | undefined, unit: string) {
  return (list ?? []).filter((u) => u.unit === unit).reduce((a, u) => a + u.count, 0);
}
