/**
 * Bot policy for G5 kinds (pure functions of decision + state). Payment: the cheapest way to cover the bill the
 * engine states (cost / already counted come from the decision, planet values include attachments). Production:
 * turns a planner's build list into one production.produce payload.
 */
import type { GameState, Option } from "../types.js";
import {
  isPaymentDone,
  isPlacement,
  type PaymentPayload,
  type PaymentSpend,
  type PaymentValue,
  type ProductionPayload,
  type ProductionProduce,
  type ProductionValue,
} from "../kinds/production.js";

export type PaymentPlan = { payload: PaymentPayload; why: string };

/** Trade goods / commodities are worth more than an exhausted planet: weight them when choosing what to spend. */
const TG_WEIGHT = 1.25;
const COMM_WEIGHT = 1.1;

/**
 * Cover the bill with the least waste. null when the engine does not know the cost (leave it to the caller) or the
 * bill cannot be covered (the engine refuses underpaying; the legacy path decides what to do).
 */
export function planPayment(d: PaymentSpend, state: GameState | null, me: string): PaymentPlan | null {
  const opts = d.options.filter((o) => !o.disabled && o.value) as Option<PaymentValue>[];
  const done = opts.map((o) => o.value).find(isPaymentDone);
  if (!done) return null;
  const req = (d.progress?.required ?? {}) as { cost?: number | null; remaining?: number | null };
  const cost = req.cost ?? done.cost;
  const currency = done.currency;
  if (cost == null || (currency !== "res" && currency !== "inf")) return null;
  const counted = typeof req.remaining === "number" ? cost - req.remaining : currency === "inf" ? done.spentInfluence : done.spentResources;
  let due = cost - counted;
  if (due <= 0) return { payload: { planets: [] }, why: `bill of ${cost} already covered` };

  const self = state?.players.find((p) => p.userId === me);
  const exhausted = new Set(self?.exhaustedPlanets ?? []);
  const sarween = opts.some((o) => o.value && "source" in o.value && o.value.source === "discount");
  if (sarween) due -= 1;
  const planets = opts
    .map((o) => o.value)
    .flatMap((v) => (v && "source" in v && v.source === "planet" && !exhausted.has(v.planet) ? [{ id: v.planet, v: currency === "inf" ? v.influence : v.resources }] : []))
    .filter((p) => p.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 12);
  const hasTg = opts.some((o) => o.value && "source" in o.value && o.value.source === "tg");
  const hasComm = opts.some((o) => o.value && "source" in o.value && o.value.source === "commodities");
  const tgHeld = hasTg ? (self?.tg ?? 0) : 0;
  const commHeld = hasComm && done.keleresAgent ? (self?.commodities ?? 0) : 0;
  const tgv = Math.max(1, done.tgValue);

  let best: { set: string[]; tg: number; comm: number; score: number } | null = null;
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
        const set: string[] = [];
        for (let i = 0; i < planets.length; i++)
          if (mask & (1 << i)) {
            t += planets[i].v;
            set.push(planets[i].id);
          }
        if (t < need) continue;
        const score = t - need + extra + set.length * 0.01;
        if (!best || score < best.score) best = { set, tg, comm, score };
      }
    }
  }
  if (!best) return null;
  const payload: PaymentPayload = { planets: best.set };
  if (best.tg) payload.tg = best.tg;
  if (best.comm) payload.commodities = best.comm;
  if (sarween) payload.sarween = true;
  const parts = [best.set.join("+") || null, best.tg ? `${best.tg} tg` : null, best.comm ? `${best.comm} commodities` : null, sarween ? "Sarween" : null].filter(Boolean);
  return { payload, why: `pay ${cost} ${currency === "inf" ? "influence" : "resources"} with ${parts.join(", ") || "nothing more"}` };
}

/**
 * A planner's build list (unit ids, one entry per unit: ["cv", "gf", "gf"]) → the production payload for this
 * decision. Ground forces go on the first planet offered (never space unless that is all there is). Units the
 * decision does not offer are dropped.
 */
export function productionPayload(d: ProductionProduce, build: string[]): ProductionPayload {
  const places = d.options.filter((o) => !o.disabled).map((o) => o.value as ProductionValue | null).filter(isPlacement);
  const counts = new Map<string, number>();
  for (const u of build) counts.set(u, (counts.get(u) ?? 0) + 1);
  const units: ProductionPayload["units"] = [];
  for (const [unit, count] of counts) {
    const offered = places.filter((p) => p.unit === unit);
    if (!offered.length) continue;
    const spot = offered.find((p) => p.holder !== "space") ?? offered[0];
    const ground = unit === "gf" || unit === "mf";
    units.push(ground ? { unit, count, holder: spot.holder } : { unit, count });
  }
  return { units };
}
