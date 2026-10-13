/*
 * Runtime helpers for the G5 renderers. The engine contract is imported type-only (nothing from the shim is
 * bundled), so the guards and the payment suggestion mirror shim/src/engine/kinds/production.ts and
 * shim/src/engine/policy/production.ts (the bot policy): keep them in step.
 */
import type { GameState, PlanetId } from "../../../../../shim/src/engine/types";
import type {
  ObjectiveCost,
  ObjectivePlanet,
  PaymentDoneValue,
  PaymentPayload,
  PaymentSpend,
  PaymentValue,
  ProductionCap,
  ProductionDoneValue,
  ProductionPlaceValue,
  ProductionValue,
} from "../../../../../shim/src/engine/kinds/production";

export function isPaymentDone(v: PaymentValue | null | undefined): v is PaymentDoneValue {
  return !!v && "action" in v && v.action === "done";
}
export function isProductionDone(v: ProductionValue | null | undefined): v is ProductionDoneValue {
  return !!v && "action" in v && v.action === "done";
}
export function isPlacement(v: ProductionValue | null | undefined): v is ProductionPlaceValue {
  return !!v && "unit" in v;
}

/** Mirrors capExcludes in shim/src/engine/kinds/production.ts: why a production cap rules this unit out. */
export function capExcludes(cap: ProductionCap | null | undefined, unit: string, cost: number | null): string | null {
  if (!cap) return null;
  if (cap.onlyUnit && cap.onlyUnit !== unit) return "not allowed";
  if (cap.maxEachCost != null && cost != null && cost > cap.maxEachCost) return `costs ${cost} (> ${cap.maxEachCost})`;
  return null;
}

/** Mirrors capRoom in shim/src/engine/kinds/production.ts: more units of this cost that fit under the cap. */
export function capRoom(cap: ProductionCap | null | undefined, cost: number | null, units: number, spent: number): number {
  if (!cap) return Infinity;
  let room = Math.max(0, cap.maxUnits - units);
  if (cap.maxTotalCost != null && cost) room = Math.min(room, Math.max(0, Math.floor((cap.maxTotalCost - spent + 1e-6) / cost)));
  return room;
}

export type PaymentPlan = { payload: PaymentPayload; why: string };

/**
 * Trade goods / commodities are spent last: one only replaces planets that would overpay by more than this.
 * Planets with a technology specialty (a skip a later research may want) or a legendary ability cost a little more
 * than plain ones, so an equally exact plain set wins.
 */
const TG_WEIGHT = 3;
const COMM_WEIGHT = 2.5;
const SKIP_WEIGHT = 0.3;
const LEGENDARY_WEIGHT = 0.2;

/**
 * Cover the bill exactly, cheapest first (plain planets, then planets with a tech skip, trade goods last; Sarween
 * Tools whenever offered). A bill that cannot be covered spends everything offered (the engine accepts that: Done
 * finishes an underpaid payment). Unknown cost: nothing offered to spend → just Done; otherwise null (the planner
 * pays, e.g. Leadership's influence).
 */
export function planPayment(d: PaymentSpend, state: GameState | null, me: string): PaymentPlan | null {
  const opts = d.options.filter((o) => !o.disabled && o.value);
  const done = opts.map((o) => o.value).find(isPaymentDone);
  if (!done) return null;
  const req = (d.progress?.required ?? {}) as { cost?: number | null; remaining?: number | null };
  const cost = req.cost ?? done.cost;
  const currency = done.currency;
  if (currency !== "res" && currency !== "inf") return null;
  const self = state?.players.find((p) => p.userId === me);
  const exhausted = new Set(self?.exhaustedPlanets ?? []);
  if (cost == null) {
    const spendable = opts.some((o) => {
      const v = o.value;
      if (!v || !("source" in v)) return false;
      if (v.source === "planet") return !exhausted.has(v.planet);
      if (v.source === "tg") return (self?.tg ?? 0) > 0;
      return v.source === "commodities" && done.keleresAgent && (self?.commodities ?? 0) > 0;
    });
    return spendable ? null : { payload: { planets: [] }, why: "nothing left to spend: done" };
  }
  const counted = typeof req.remaining === "number" ? cost - req.remaining : currency === "inf" ? done.spentInfluence : done.spentResources;
  let due = cost - counted;
  if (due <= 0) return { payload: { planets: [] }, why: `bill of ${cost} already covered` };

  const sarween = opts.some((o) => o.value && "source" in o.value && o.value.source === "discount");
  if (sarween) due -= 1;
  const planets = opts
    .map((o) => o.value)
    .flatMap((v) => (v && "source" in v && v.source === "planet" && !exhausted.has(v.planet) ? [{ id: v.planet, v: currency === "inf" ? v.influence : v.resources, w: (v.techSpecialties?.length ? SKIP_WEIGHT : 0) + (v.legendary ? LEGENDARY_WEIGHT : 0) }] : []))
    .filter((p) => p.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 12);
  const hasTg = opts.some((o) => o.value && "source" in o.value && o.value.source === "tg");
  const hasComm = opts.some((o) => o.value && "source" in o.value && o.value.source === "commodities");
  const tgHeld = hasTg ? (self?.tg ?? 0) : 0;
  const commHeld = hasComm && done.keleresAgent ? (self?.commodities ?? 0) : 0;
  const tgv = Math.max(1, done.tgValue);

  let best: { set: PlanetId[]; tg: number; comm: number; score: number } | null = null;
  if (due <= 0) best = { set: [], tg: 0, comm: 0, score: 0 };
  for (let tg = 0; tg <= Math.min(tgHeld, Math.ceil(due / tgv)) && due > 0; tg++) {
    for (let comm = 0; comm <= Math.min(commHeld, Math.ceil(due / tgv)); comm++) {
      const need = due - (tg + comm) * tgv;
      const extra = tg * TG_WEIGHT + comm * COMM_WEIGHT;
      if (need <= 0) {
        const score = extra - need; // overpaid by -need
        if (!best || score < best.score) best = { set: [], tg, comm, score };
        continue;
      }
      for (let mask = 1; mask < 1 << planets.length; mask++) {
        let t = 0;
        let w = 0;
        const set: PlanetId[] = [];
        for (let i = 0; i < planets.length; i++)
          if (mask & (1 << i)) {
            t += planets[i].v;
            w += planets[i].w;
            set.push(planets[i].id);
          }
        if (t < need) continue;
        const score = t - need + extra + w + set.length * 0.01;
        if (!best || score < best.score) best = { set, tg, comm, score };
      }
    }
  }
  if (!best) {
    // Cannot cover the bill: spend everything offered (the engine then lets Done finish the underpaid payment).
    const all: PaymentPayload = { planets: planets.map((p) => p.id) };
    if (tgHeld) all.tg = tgHeld;
    if (commHeld) all.commodities = commHeld;
    if (sarween) all.sarween = true;
    return { payload: all, why: `cannot cover ${cost}: spend everything offered` };
  }
  const payload: PaymentPayload = { planets: best.set };
  if (best.tg) payload.tg = best.tg;
  if (best.comm) payload.commodities = best.comm;
  if (sarween) payload.sarween = true;
  const parts = [best.set.join("+") || null, best.tg ? `${best.tg} tg` : null, best.comm ? `${best.comm} commodities` : null, sarween ? "Sarween" : null].filter(Boolean);
  return { payload, why: `pay ${cost} ${currency === "inf" ? "influence" : "resources"} with ${parts.join(", ") || "nothing more"}` };
}

/**
 * Mirrors planObjectivePayment in shim/src/engine/kinds/production.ts: the cheapest planets + trade goods paying a
 * spend objective (each planet counts its resources or its influence; trade goods beyond the ones it asks for count
 * toward either part). With fixedTg and exactly the chosen planets it checks whether a selection covers it.
 */
export function planObjectivePayment(
  cost: ObjectiveCost,
  planets: ObjectivePlanet[],
  tgHeld: number,
  tgValue: number,
  opts: { fixedTg?: number; eitherValue?: boolean } = {},
): { planets: PlanetId[]; tg: number } | null {
  const R = cost.resources;
  const I = cost.influence;
  const tgv = Math.max(1, tgValue);
  type Cell = { score: number; set: PlanetId[] } | null;
  let dp: Cell[][] = Array.from({ length: R + 1 }, () => Array<Cell>(I + 1).fill(null));
  dp[0][0] = { score: 0, set: [] };
  for (const p of planets) {
    const r = opts.eitherValue ? p.resources + p.influence : p.resources;
    const i = opts.eitherValue ? p.resources + p.influence : p.influence;
    const next = dp.map((row) => row.slice());
    const put = (a: number, b: number, c: { score: number; set: PlanetId[] }) => {
      const cur = next[a][b];
      if (!cur || c.score < cur.score) next[a][b] = c;
    };
    for (let a = 0; a <= R; a++)
      for (let b = 0; b <= I; b++) {
        const c = dp[a][b];
        if (!c) continue;
        const w = (p.weight ?? 0) + 0.01;
        if (r > 0) put(Math.min(R, a + r), b, { score: c.score + r + w, set: [...c.set, p.id] });
        if (i > 0) put(a, Math.min(I, b + i), { score: c.score + i + w, set: [...c.set, p.id] });
      }
    dp = next;
  }
  const tgs = opts.fixedTg !== undefined ? [opts.fixedTg] : Array.from({ length: Math.max(0, tgHeld - cost.tg + 1) }, (_, k) => cost.tg + k);
  let best: { planets: PlanetId[]; tg: number; score: number } | null = null;
  for (const tg of tgs) {
    if (tg < cost.tg || tg > Math.max(tgHeld, opts.fixedTg ?? 0)) continue;
    const extra = (tg - cost.tg) * tgv;
    for (let a = 0; a <= R; a++)
      for (let b = 0; b <= I; b++) {
        const c = dp[a][b];
        if (!c || R - a + (I - b) > extra) continue;
        const score = c.score + (tg - cost.tg) * 1.5;
        if (!best || score < best.score) best = { planets: c.set, tg, score };
      }
  }
  return best ? { planets: best.planets, tg: best.tg } : null;
}
