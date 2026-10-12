/**
 * Bot policy for G5 kinds (pure functions of decision + state). Payment: the cheapest way to cover the bill the
 * engine states (cost / already counted come from the decision, planet values include attachments). Production:
 * turns a planner's build list into one production.produce payload.
 */
import type { GameState, HolderName, Option, PlanetId } from "../types.js";
import {
  capExcludes,
  capRoom,
  isPaymentDone,
  isPlacement,
  isProductionDone,
  type ProductionCap,
  type PaymentDoneValue,
  type PaymentPayload,
  type PaymentSpend,
  type PaymentValue,
  type ProductionPayload,
  type ProductionProduce,
  type ProductionValue,
  type ProductionPlace,
  type FreePlacementValue,
  type CommoditiesGain,
  type CommoditiesValue,
} from "../kinds/production.js";

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
  const opts = d.options.filter((o) => !o.disabled && o.value) as Option<PaymentValue>[];
  const done = opts.map((o) => o.value).find(isPaymentDone);
  if (!done) return null;
  const req = (d.progress?.required ?? {}) as { cost?: number | null; remaining?: number | null };
  const cost = req.cost ?? done.cost ?? contextCost(done, state, me);
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
  if (due <= 0) return { payload: { planets: [] }, why: cost === 0 ? `${done.context}: nothing to pay; done` : `bill of ${cost} already covered` };

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
 * What a bill the engine does not price (cost null) costs a bot, by what Done finishes (live: every Leadership
 * and Technology payment waited out the 60 s fallback, and stalled the seat behind it):
 * - leadership: the influence spent buys extra command tokens; the bot's Leadership policy gains only the card's 3
 *   (engine/kinds/strategyPolicy.ts commandTokens), so it buys none: 0.
 * - technology: the Technology primary's first research is free (the only one the strategy policy researches): 0
 *   for the card's holder; a follower's research costs 4 resources.
 * null otherwise (left to the planner / fallback).
 */
export function contextCost(done: PaymentDoneValue, state: GameState | null, me: string): number | null {
  if (done.context === "leadership" && done.currency === "inf") return 0;
  if (done.context === "technology" && done.currency === "res" && done.tech) {
    const card = state?.strategyCards.find((c) => c.card === "pok7technology" && c.played);
    if (!card) return null;
    return card.holder === me ? 0 : 4;
  }
  return null;
}

/**
 * A planner's build list (unit ids, one entry per unit: ["cv", "gf", "gf"]) → the production payload for this
 * decision. Ground forces go on the first planet offered (never space unless that is all there is). Units the
 * decision does not offer are dropped.
 */
export function productionPayload(d: ProductionProduce, build: string[]): ProductionPayload {
  const places = d.options.filter((o) => !o.disabled).map((o) => o.value as ProductionValue | null).filter(isPlacement);
  const cap = productionCap(d);
  const counts = new Map<string, number>();
  for (const u of build) counts.set(u, (counts.get(u) ?? 0) + 1);
  const units: ProductionPayload["units"] = [];
  let chosen = 0;
  let spent = 0;
  for (const [unit, want] of counts) {
    const offered = places.filter((p) => p.unit === unit);
    if (!offered.length) continue;
    const spot = offered.find((p) => p.holder !== "space") ?? offered[0];
    // A capped production (Umbat, riders, ...) takes only what fits; the engine refuses the rest.
    if (capExcludes(cap, spot.unit, spot.cost)) continue;
    // None left in reinforcements (component limit): the engine refuses it, so it is not asked for.
    const count = Math.min(want, capRoom(cap, spot.cost, chosen, spent), spot.remaining ?? Infinity);
    if (count <= 0) continue;
    chosen += count;
    spent += count * (spot.cost ?? 0);
    const ground = unit === "gf" || unit === "mf";
    units.push(ground ? { unit: spot.unit, count, holder: spot.holder } : { unit: spot.unit, count });
  }
  return { units };
}

/** The cap of a capped production (Umbat, Production / Armament Rider, Maximus, Availyn, Flaah Hyphae), or null. */
export function productionCap(d: ProductionProduce): ProductionCap | null {
  const done = d.options.map((o) => o.value as ProductionValue | null).find(isProductionDone);
  return done?.limit ?? ((d.progress?.required as { limit?: ProductionCap | null } | undefined)?.limit ?? null);
}

/** Cheap units first: a capped build is a bonus, and the bot does not know its resources before the bill. */
const CAPPED_PREFERENCE = ["dd", "ff", "gf", "ca", "cv", "mf"];

/**
 * A capped production addressed to the bot (Umbat exhausted on it, a rider it won, its Maximus / Availyn / Flaah
 * Hyphae): no planner job builds these, so the policy does — as many of the cheapest offered unit as the cap
 * allows (destroyers, else fighters, else infantry …), within trade goods + ready planets (a rough budget: one
 * resource a planet); nothing when none fits.
 */
export function chooseCappedBuild(d: ProductionProduce, state: GameState | null, me: string): { payload: Record<string, unknown>; why: string } | null {
  if (d.target?.userId !== me) return null;
  const cap = productionCap(d);
  if (!cap) return null;
  const self = state?.players.find((p) => p.userId === me);
  const budget = self ? (self.tg ?? 0) + (self.planets ?? []).filter((p) => !(self.exhaustedPlanets ?? []).includes(p)).length : 2;
  const places = d.options.filter((o) => !o.disabled).map((o) => o.value as ProductionValue | null).filter(isPlacement);
  for (const unit of CAPPED_PREFERENCE) {
    const spot = places.find((p) => p.unit === unit && p.holder !== "space") ?? places.find((p) => p.unit === unit);
    if (!spot || capExcludes(cap, spot.unit, spot.cost)) continue;
    const affordable = spot.cost ? Math.floor((budget + 1e-6) / spot.cost) : Infinity;
    const count = Math.min(capRoom(cap, spot.cost, 0, 0), affordable, spot.remaining ?? 20, 20);
    if (count <= 0) continue;
    const ground = unit === "gf" || unit === "mf";
    const units = [ground ? { unit: spot.unit, count, holder: spot.holder } : { unit: spot.unit, count }];
    return { payload: { units }, why: `${cap.label}: produce ${count} ${unit}` };
  }
  return { payload: { units: [] }, why: `${cap.label}: nothing fits; build nothing` };
}

/**
 * Free placements (production.place): always answered for the bot: the first
 * placement on a planet we control (else the first offered); "Done" only when nothing can be placed.
 */
export function choosePlacement(d: ProductionPlace, state: GameState | null, me: string): { option: Option<FreePlacementValue>; why: string } | null {
  const live = d.options.filter((o) => !o.disabled && o.value) as Option<FreePlacementValue>[];
  const mine: ReadonlySet<HolderName> = new Set(state?.players.find((p) => p.userId === me)?.planets ?? []);
  const places = live.filter((o) => o.value!.op === "place");
  const pick = places.find((o) => mine.has((o.value as { holder: HolderName }).holder)) ?? places[0];
  if (pick) {
    const v = pick.value as Extract<FreePlacementValue, { op: "place" }>;
    return { option: pick, why: `free placement: ${v.count} ${v.unit} on ${v.holder}${v.tile ? ` (${v.tile})` : ""}` };
  }
  const done = live.find((o) => o.value!.op === "done");
  return done ? { option: done, why: "free placement: nowhere to place" } : null;
}

/**
 * Gain / convert commodities: convert when we hold at least that many commodities (trade goods are spendable),
 * else gain; "Done" when neither is offered. A prompt that stays ("_stay") is answered once (history).
 */
export function chooseCommodities(d: CommoditiesGain, state: GameState | null, me: string, history: string[]): { option: Option<CommoditiesValue>; why: string } | null {
  const live = (d.options.filter((o) => !o.disabled && o.value) as Option<CommoditiesValue>[]).filter((o) => !history.includes(o.id));
  const done = d.options.find((o) => !o.disabled && o.value?.op === "done") as Option<CommoditiesValue> | undefined;
  if (history.length && done) return { option: done, why: "commodities: already taken" };
  const held = state?.players.find((p) => p.userId === me)?.commodities ?? 0;
  const amountOf = (o: Option<CommoditiesValue>) => (o.value!.op === "done" ? 0 : o.value!.amount);
  const convert = live.find((o) => o.value!.op === "convert" && held >= amountOf(o));
  if (convert) return { option: convert, why: `commodities: convert ${amountOf(convert)} into trade goods` };
  const gain = live.find((o) => o.value!.op === "gain");
  if (gain) return { option: gain, why: `commodities: gain ${amountOf(gain)}` };
  const anyConvert = live.find((o) => o.value!.op === "convert");
  if (anyConvert) return { option: anyConvert, why: "commodities: convert what we have" };
  return done ? { option: done, why: "commodities: nothing to take" } : null;
}
