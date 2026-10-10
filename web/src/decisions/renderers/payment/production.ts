import type { PlayerData } from "@/entities/data/types";
import { lookupUnit } from "@/entities/lookup/units";
import { baseId, cleanLabel, type Choice } from "../../model/controls";

/** One thing I can produce somewhere: a row with a stepper. */
export type ProduceRow = {
  key: string;
  unit: string;
  name: string;
  /** Where it goes: "space" or a planet name. */
  where: string;
  /** The bot's 1-unit button, and its 2-unit button for fighters / infantry. */
  one?: Choice;
  two?: Choice;
  cost: number;
  capacity: number;
  ship: boolean;
  ground: boolean;
  /** Units of this type left in reinforcements, when the button says. */
  left?: number;
};

const ASYNC: Record<string, string> = {
  warsun: "ws",
  flagship: "fs",
  dreadnought: "dn",
  carrier: "cv",
  cruiser: "ca",
  destroyer: "dd",
  fighter: "ff",
  infantry: "gf",
  mech: "mf",
  sd: "sd",
  pds: "pd",
};
const NAMES: Record<string, [string, string]> = {
  warsun: ["war sun", "war suns"],
  flagship: ["flagship", "flagships"],
  dreadnought: ["dreadnought", "dreadnoughts"],
  carrier: ["carrier", "carriers"],
  cruiser: ["cruiser", "cruisers"],
  destroyer: ["destroyer", "destroyers"],
  fighter: ["fighter", "fighters"],
  infantry: ["infantry", "infantry"],
  mech: ["mech", "mechs"],
  sd: ["space dock", "space docks"],
  pds: ["PDS", "PDS"],
};
const ORDER = ["warsun", "flagship", "dreadnought", "carrier", "cruiser", "destroyer", "fighter", "mech", "infantry", "sd", "pds"];

/** The bot's "Produce Units" prompt: one button per unit and place, ending with "Done Producing Units". */
export function isProductionPrompt(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.some((id) => /^place_\w+_/.test(id)) && ids.some((id) => /^deleteButtons_\w+/.test(id)) && choices.some((c) => /done producing/i.test(c.label));
}

export function unitName(unit: string, n: number) {
  const [one, many] = NAMES[unit] ?? [unit, `${unit}s`];
  return `${n} ${n === 1 ? one : many}`;
}

/** "place_2gf_jord" → unit "infantry", count 2, where "jord". */
function parsePlace(id: string) {
  const m = id.match(/^place_([a-z0-9]+)_(.+)$/i);
  if (!m) return undefined;
  const raw = m[1].toLowerCase();
  const two = raw === "2ff" || raw === "2gf";
  const unit = raw === "2ff" ? "fighter" : raw === "2gf" ? "infantry" : raw;
  return { unit, two, loc: m[2] };
}

function whereFromLabel(label: string) {
  const on = label.match(/\bon (.+?)(?:\s*\(\d+\))?$/i)?.[1];
  if (on) return cleanLabel(on).replace(/\s*\(\d+\/\d+\)\s*$/, "");
  return "space";
}

export function productionRows(choices: Choice[], me?: PlayerData): ProduceRow[] {
  const rows = new Map<string, ProduceRow>();
  for (const c of choices) {
    const p = parsePlace(baseId(c.customId));
    if (!p || !ASYNC[p.unit]) continue;
    const key = `${p.unit}@${p.loc}`;
    const row = rows.get(key);
    if (row) {
      if (p.two) row.two = c;
      else {
        row.one = c;
        row.where = whereFromLabel(cleanLabel(c.label));
      }
      continue;
    }
    const data = me ? lookupUnit(ASYNC[p.unit], me.faction, me) : null;
    const left = p.two ? undefined : c.label.match(/\((\d+)\)\s*$/)?.[1];
    rows.set(key, {
      key,
      unit: p.unit,
      name: NAMES[p.unit]?.[0] ?? p.unit,
      where: whereFromLabel(cleanLabel(c.label)),
      one: p.two ? undefined : c,
      two: p.two ? c : undefined,
      cost: data?.cost ?? (p.unit === "fighter" || p.unit === "infantry" ? 0.5 : 0),
      capacity: data?.capacityValue ?? 0,
      ship: !!data?.isShip,
      ground: !!data?.isGroundForce,
      left: left ? Number(left) : undefined,
    });
  }
  return [...rows.values()].sort((a, b) => ORDER.indexOf(a.unit) - ORDER.indexOf(b.unit));
}

/** What a set of counts costs: whole units at their cost, fighters and infantry in pairs (per type). */
export function buildCost(rows: ProduceRow[], counts: Record<string, number>) {
  let cost = 0;
  let ff = 0;
  let gf = 0;
  for (const r of rows) {
    const n = counts[r.key] ?? 0;
    if (r.unit === "fighter") ff += n;
    else if (r.unit === "infantry") gf += n;
    else cost += r.cost * n;
  }
  return Math.ceil(cost) + Math.ceil(ff / 2) + Math.ceil(gf / 2);
}

/** "2 fighters, 1 carrier" in the order the panel lists them. */
export function buildSummary(rows: ProduceRow[], counts: Record<string, number>) {
  const byUnit = new Map<string, number>();
  for (const r of rows) {
    const n = counts[r.key] ?? 0;
    if (n) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + n);
  }
  return [...byUnit.entries()].map(([u, n]) => unitName(u, n)).join(", ");
}

/** The production value the bot reported for this build ("You have 5 PRODUCTION value in this system."). */
export function productionValue(texts: string[]): number | undefined {
  for (const t of texts) {
    const hit = t.match(/PRODUCTION limit is (\d+)/i) ?? t.match(/You have (\d+) PRODUCTION value/i) ?? t.match(/\((\d+) PRODUCTION/i);
    if (hit) return Number(hit[1]);
  }
  return undefined;
}
