import type { EntityData, PlayerData, TileUnitData } from "@/entities/data/types";
import { lookupUnit } from "@/entities/lookup/units";
import { baseId, type Choice } from "../../model/controls";

/** Unit async ids, biggest first (the order units are listed in). */
export const UNIT_ORDER = ["ws", "fs", "dn", "ca", "cv", "dd", "ff", "mf", "gf", "pd", "sd"];

export const UNIT_NAME: Record<string, [string, string]> = {
  ws: ["War Sun", "War Suns"],
  fs: ["Flagship", "Flagships"],
  dn: ["Dreadnought", "Dreadnoughts"],
  ca: ["Cruiser", "Cruisers"],
  cv: ["Carrier", "Carriers"],
  dd: ["Destroyer", "Destroyers"],
  ff: ["Fighter", "Fighters"],
  mf: ["Mech", "Mechs"],
  gf: ["Infantry", "Infantry"],
  pd: ["PDS", "PDS"],
  sd: ["Space Dock", "Space Docks"],
};

/** The bot's unit emoji names ("<:dreadnought:…>") → async ids. */
export const EMOJI_UNIT: Record<string, string> = {
  warsun: "ws",
  flagship: "fs",
  dreadnought: "dn",
  cruiser: "ca",
  carrier: "cv",
  destroyer: "dd",
  fighter: "ff",
  mech: "mf",
  infantry: "gf",
  pds: "pd",
  spacedock: "sd",
};

/** What losing one unit costs, for suggesting the cheapest assignment (fighters and infantry first). */
const LOSS_COST: Record<string, number> = { ff: 0.5, gf: 0.5, dd: 1, ca: 2, mf: 2, cv: 3, pd: 4, sd: 4, dn: 4, fs: 8, ws: 12 };

export function unitName(id: string, n = 1) {
  const names = UNIT_NAME[id];
  if (!names) return id;
  return n === 1 ? names[0] : names[1];
}

/** "2 Dreadnoughts", "1 Infantry". */
export function countName(id: string, n: number) {
  return `${n} ${unitName(id, n)}`;
}

const SHIPS = new Set(["ws", "fs", "dn", "ca", "cv", "dd", "ff"]);
const GROUND = new Set(["gf", "mf"]);

/** One kind of my units in one place, as the hit / removal panel lists it. */
export type UnitRowModel = {
  /** `${unit}@${holder}` */
  key: string;
  unit: string;
  /** "space" or a planet id. */
  holder: string;
  /** Planet name for display ("Andeara"), when on a planet. */
  holderName?: string;
  count: number;
  /** Already damaged (cannot sustain again). */
  damaged: number;
  canSustain: boolean;
};

export type HitTarget = "space" | "ground" | "afb" | "any";

/** My units the hits may land on, from the live map. */
export function rowsFromTile(
  tile: TileUnitData | undefined,
  me: PlayerData | undefined,
  target: HitTarget,
  planet?: string,
): UnitRowModel[] {
  if (!tile || !me?.faction) return [];
  const rows: UnitRowModel[] = [];
  const push = (list: EntityData[] | undefined, holder: string) => {
    for (const u of list ?? []) {
      if (u.entityType !== "unit" || u.count <= 0) continue;
      if (target === "space" && !SHIPS.has(u.entityId)) continue;
      if (target === "afb" && u.entityId !== "ff") continue;
      if (target === "ground" && !GROUND.has(u.entityId)) continue;
      rows.push({
        key: `${u.entityId}@${holder}`,
        unit: u.entityId,
        holder,
        count: u.count,
        damaged: Math.min(u.count, u.sustained ?? u.unitStates?.[1] ?? 0),
        canSustain: target !== "afb" && !!lookupUnit(u.entityId, me.faction, me)?.sustainDamage,
      });
    }
  };
  if (target !== "ground") push(tile.space?.[me.faction], "space");
  if (target === "ground" || target === "any") {
    for (const [id, p] of Object.entries(tile.planets ?? {})) {
      if (planet && id !== planet) continue;
      push(p.entities?.[me.faction], id);
    }
  }
  return sortRows(rows);
}

export function sortRows(rows: UnitRowModel[]) {
  return rows.sort(
    (a, b) => (a.holder === "space" ? 0 : 1) - (b.holder === "space" ? 0 : 1) || a.holder.localeCompare(b.holder) || UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit),
  );
}

/** A per-unit sustain / destroy (or remove) button: `assignHits_<pos>_<n>_<unit>[_<state>][_<planet>]_<color>`. */
export type PickButton = {
  choice: Choice;
  action: "assignHits" | "assignDamage";
  pos: string;
  unit: string;
  state?: string;
  holder: string;
  color: string;
  /** "FFCC_mentak_" or "". */
  prefix: string;
};

const PICK = /^(assignHits|assignDamage)_([^_]+)_(\d+)_([a-z]{2})_(.+)$/;
const STATE = /^(dmg_glv|dmg|glv)(?:_|$)/;

export function parsePick(c: Choice): PickButton | null {
  const id = baseId(c.customId);
  const m = id.match(PICK);
  if (!m) return null;
  const [, action, pos, , unit, rest] = m;
  const prefix = (c.customId ?? "").slice(0, (c.customId ?? "").length - id.length);
  const parts = rest.split("_");
  const color = parts.pop() ?? "";
  let middle = parts.join("_");
  const state = middle.match(STATE)?.[1];
  if (state) middle = middle.slice(state.length).replace(/^_/, "");
  return { choice: c, action: action as PickButton["action"], pos, unit, state, holder: middle || "space", color, prefix };
}

/** The unit-pick buttons of a prompt (the bot's "Sustain 1 Dreadnought" / "Destroy 1 Fighter" / "Remove 2 Infantry" ladder). */
export function picksOf(choices: Choice[]) {
  return choices.map(parsePick).filter((p): p is PickButton => !!p);
}

/** Rows for a unit-pick prompt: what its buttons offer, counted from the live map. */
export function rowsFromPicks(picks: PickButton[], tile: TileUnitData | undefined, me: PlayerData | undefined): UnitRowModel[] {
  const rows = new Map<string, UnitRowModel>();
  for (const p of picks) {
    const key = `${p.unit}@${p.holder}`;
    const live = p.holder === "space" ? tile?.space?.[me?.faction ?? ""] : tile?.planets?.[p.holder]?.entities?.[me?.faction ?? ""];
    const e = live?.find((u) => u.entityId === p.unit);
    const row = rows.get(key) ?? {
      key,
      unit: p.unit,
      holder: p.holder,
      count: e?.count ?? 0,
      damaged: Math.min(e?.count ?? 0, e?.sustained ?? e?.unitStates?.[1] ?? 0),
      canSustain: false,
    };
    if (p.action === "assignDamage") row.canSustain = true;
    /* No live count (fog, a unit the map does not list): at least what the buttons offer. */
    if (!e) row.count = Math.max(row.count, Number(p.choice.customId?.match(/_(\d+)_[a-z]{2}_/)?.[1] ?? 1));
    rows.set(key, row);
  }
  return sortRows([...rows.values()]);
}

/** Per row: how many sustain and how many are destroyed / removed. */
export type Plan = Record<string, { sustain: number; destroy: number }>;

export function planTotal(plan: Plan) {
  return Object.values(plan).reduce((n, p) => n + p.sustain + p.destroy, 0);
}

export function samePlan(a: Plan, b: Plan) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k]?.sustain ?? 0) !== (b[k]?.sustain ?? 0) || (a[k]?.destroy ?? 0) !== (b[k]?.destroy ?? 0)) return false;
  }
  return true;
}

/**
 * The cheapest way to take `hits`: sustain damage first (war suns, flagships, dreadnoughts, mechs — whatever can), then
 * lose the cheapest units (fighters, infantry, destroyers, …), damaged ones of a kind before healthy ones.
 */
export function suggestPlan(rows: UnitRowModel[], hits: number, allowSustain = true): Plan {
  const plan: Plan = Object.fromEntries(rows.map((r) => [r.key, { sustain: 0, destroy: 0 }]));
  let left = hits;
  if (allowSustain) {
    for (const r of [...rows].sort((a, b) => (LOSS_COST[b.unit] ?? 3) - (LOSS_COST[a.unit] ?? 3))) {
      if (!r.canSustain || left <= 0) continue;
      const n = Math.min(left, r.count - r.damaged);
      plan[r.key].sustain = n;
      left -= n;
    }
  }
  for (const r of [...rows].sort((a, b) => (LOSS_COST[a.unit] ?? 3) - (LOSS_COST[b.unit] ?? 3))) {
    if (left <= 0) break;
    const n = Math.min(left, r.count);
    plan[r.key].destroy = n;
    left -= n;
  }
  return plan;
}

/** The bot's own suggestion in the hit prompt ("Would sustain 2 <:dreadnought:…>", "Would destroy 2 <:fighter:…>"). */
export function botPlan(text: string, rows: UnitRowModel[]): Plan | null {
  const plan: Plan = Object.fromEntries(rows.map((r) => [r.key, { sustain: 0, destroy: 0 }]));
  let found = false;
  for (const m of text.matchAll(/would (sustain|destroy) (\d+)\s*(?:damaged\s*)?<a?:(\w+):\d+>/gi)) {
    const unit = EMOJI_UNIT[m[3].toLowerCase()];
    const row = rows.find((r) => r.unit === unit);
    if (!row) return null;
    plan[row.key][m[1].toLowerCase() === "sustain" ? "sustain" : "destroy"] += Number(m[2]);
    found = true;
  }
  return found ? plan : null;
}

/** "sustain 2 Dreadnoughts, destroy 2 Fighters". */
export function describePlan(plan: Plan, rows: UnitRowModel[], destroyVerb = "destroy") {
  const parts: string[] = [];
  for (const r of rows) {
    const p = plan[r.key];
    if (p?.sustain) parts.push(`sustain ${countName(r.unit, p.sustain)}`);
  }
  for (const r of rows) {
    const p = plan[r.key];
    if (p?.destroy) parts.push(`${destroyVerb} ${countName(r.unit, p.destroy)}`);
  }
  return parts.join(", ");
}

/**
 * The bot's buttons to press for a plan, in order: every sustain, then every loss (damaged units of a kind first).
 * Ids are built in the bot's own format from a template button, so a unit damaged by this very plan can still be named.
 */
export function pressesFor(plan: Plan, rows: UnitRowModel[], picks: PickButton[]): string[] {
  const any = picks[0];
  if (!any) return [];
  const id = (action: string, r: UnitRowModel, state?: string) =>
    `${any.prefix}${action}_${any.pos}_1_${r.unit}${state ? `_${state}` : ""}${r.holder !== "space" ? `_${r.holder}` : ""}_${any.color}`;
  const out: string[] = [];
  for (const r of rows) {
    for (let i = 0; i < (plan[r.key]?.sustain ?? 0); i++) out.push(id("assignDamage", r));
  }
  for (const r of rows) {
    const p = plan[r.key];
    if (!p?.destroy) continue;
    /* Units damaged before or by this plan go first; then healthy ones. */
    const damaged = Math.min(p.destroy, r.damaged + p.sustain);
    for (let i = 0; i < p.destroy; i++) out.push(id("assignHits", r, i < damaged ? "dmg" : undefined));
  }
  return out;
}
