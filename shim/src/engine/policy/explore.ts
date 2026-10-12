/**
 * Autopilot policy for exploration + relic decisions (G9). Pure: (decision, state, me) → option or null (null leaves
 * the decision to the legacy rule table). Sensible defaults, no lookahead:
 *  - explore.planet: explore normally (never the Bentor/Kollecc breakthrough variants); pick the trait / planet whose
 *    relic fragments we hold most of (closest to a relic), then the first offered.
 *  - explore.card_pick: best card by a fixed value table (relic > 5 ACs/TGs > attachments, Mirage > fragments > rest).
 *  - explore.frontier: the first system offered.
 *  - explore.outcome: take free benefits, pay with a mech that stays, remove an infantry only when it nets units,
 *    commodities: convert when we hold some, else gain; Deep Mining: explore; Distant Suns: draw two.
 *  - relic.fragments: complete one set (most-held trait first, frontier as wild), then draw.
 *  - relic.draw: draw.
 */
import type {
  ExploreCardPick,
  ExploreDecision,
  ExploreOutcome,
  ExplorePlanet,
  FragmentCounts,
  RelicFragments,
} from "../kinds/explore.js";
import type { GameState, Option, PlayerState } from "../types.js";

export type ExploreChoice = { option: Option<any>; why: string };

/** Answerable options: not disabled, no form, and not marked unavailable by the engine (a cost the seat cannot pay). */
const live = <T>(opts: Option<T>[]) =>
  opts.filter((o) => !o.disabled && !o.needsInput && !(o.value as { unavailable?: string | null } | null)?.unavailable);

function fragments(self: PlayerState | undefined): FragmentCounts {
  const c: FragmentCounts = { cultural: 0, industrial: 0, hazardous: 0, frontier: 0 };
  for (const f of self?.fragments ?? []) {
    if (f.startsWith("supermassive")) continue;
    if (f.startsWith("crf")) c.cultural++;
    else if (f.startsWith("irf")) c.industrial++;
    else if (f.startsWith("hrf")) c.hazardous++;
    else if (f.startsWith("urf")) c.frontier++;
  }
  return c;
}

export function chooseExplore(d: ExploreDecision, state: GameState | null, me: string): ExploreChoice | null {
  const self = state?.players.find((p) => p.userId === me);
  switch (d.kind) {
    case "explore.planet":
      return explorePlanet(d, self);
    case "explore.card_pick":
      return cardPick(d);
    case "explore.frontier": {
      const o = live(d.options).find((x) => x.value);
      return o ? { option: o, why: "explore: first frontier system" } : null;
    }
    case "explore.outcome":
      return outcome(d, self);
    case "relic.fragments":
      return relicFragments(d, self);
    case "relic.draw": {
      const o = live(d.options).find((x) => x.value?.action === "draw");
      return o ? { option: o, why: "relic: draw" } : null;
    }
    default:
      return null;
  }
}

function explorePlanet(d: ExplorePlanet, self: PlayerState | undefined): ExploreChoice | null {
  const frags = fragments(self);
  const exhausted = new Set(self?.exhaustedPlanets ?? []);
  const opts = live(d.options).filter((o) => o.value && !o.value.frontierInstead && !o.value.fromDiscard);
  if (!opts.length) return null;
  const score = (o: (typeof opts)[number]) =>
    (frags[o.value!.trait as keyof FragmentCounts] ?? 0) * 10 +
    // Impressment Programs exhausts the planet: prefer planets already exhausted.
    (o.value!.via === "dsdihmy" && exhausted.has(o.value!.planet) ? 1 : 0);
  const best = [...opts].sort((a, b) => score(b) - score(a))[0];
  return { option: best, why: `explore: ${best.value!.planetName} (${best.value!.trait})` };
}

const CARD_VALUE: [RegExp, number][] = [
  [/^dw$/, 100], // Derelict Wreck... relic
  [/^(fiveac|fivetg)\d/, 90],
  [/^mirage$/, 85],
  [/^ed\d$/, 80], // Enigmatic Device
  [/^(dv|lc)\d$/, 70],
];

function cardScore(v: { card: string; resolution?: string | null }): number {
  for (const [re, n] of CARD_VALUE) if (re.test(v.card)) return n;
  if (v.resolution === "attach") return 75;
  if (v.resolution === "fragment") return 60;
  if (v.resolution === "token") return 40;
  return 50;
}

function cardPick(d: ExploreCardPick): ExploreChoice | null {
  const opts = live(d.options).filter((o) => o.value);
  if (!opts.length) return null;
  const best = [...opts].sort((a, b) => cardScore(b.value!) - cardScore(a.value!))[0];
  return { option: best, why: `explore: resolve ${best.value!.cardName ?? best.value!.card}` };
}

function outcome(d: ExploreOutcome, self: PlayerState | undefined): ExploreChoice | null {
  const opts = live(d.options).filter((o) => o.value);
  if (!opts.length) return null;
  const comms = self?.commodities ?? 0;
  const tg = self?.tg ?? 0;
  const pick = (pred: (v: NonNullable<(typeof opts)[number]["value"]>) => boolean, why: string) => {
    const o = opts.find((x) => pred(x.value!));
    return o ? { option: o, why: `explore: ${why}` } : null;
  };
  const decline = () => pick((v) => v.effect === "decline", "decline");

  // Abilities offered around an explore.
  const ability = pick((v) => v.ability === "distant_suns" && v.effect === "draw_two_choose_one", "Distant Suns: draw two");
  if (ability) return ability;
  const deep = pick((v) => v.ability === "deep_mining" && v.effect === "explore", "Deep Mining: explore instead");
  if (deep) return deep;

  // Commodity choices (Functioning Base, Abandoned Warehouses, Local Fabricators, Merchant Station).
  const merchantConvert = pick((v) => v.card === "merchantstation" && v.effect === "convert_commodities", "Merchant Station: convert");
  const merchantReplenish = pick((v) => v.card === "merchantstation" && v.effect === "replenish_commodities", "Merchant Station: replenish");
  if (merchantConvert || merchantReplenish) {
    const max = self?.commoditiesMax ?? 0;
    return (comms * 2 >= max ? merchantConvert : merchantReplenish) ?? merchantConvert ?? merchantReplenish;
  }
  const mech = pick((v) => v.effect === "place_mech" && v.card === "localfabricators", "Local Fabricators: mech");
  if (mech && comms + tg > 0) return mech;
  const ac = pick((v) => v.effect === "draw_action_card" && v.cost === "commodity_or_tg", "Functioning Base: action card");
  if (ac && comms > 0) return ac;
  const convert = pick((v) => v.effect === "convert_commodities", "convert commodities");
  if (convert && comms >= 2) return convert;
  const gain = pick((v) => v.effect === "gain_commodities", "gain commodities");
  if (gain) return gain;
  if (convert) return convert;

  const ion = pick((v) => v.effect === "place_ion_storm" && v.side === "alpha", "Ion Storm: alpha side");
  if (ion) return ion;

  // Hazardous cards: a mech that stays is free; removing an infantry only when it nets units.
  const free = pick(
    (v) => v.cost === "mech_present" && v.effect !== "produce" && v.effect !== "place_units",
    "free benefit with a mech there",
  );
  if (free) return free;
  const units = pick((v) => v.effect === "place_units" && v.units === "1 mech", "place a mech");
  if (units) return units;
  const twoInf = pick((v) => v.effect === "place_units" && v.units === "2 infantry", "place 2 infantry");
  if (twoInf) return twoInf;
  const seedyAc = pick((v) => v.card === "seedyspaceport" && v.effect === "draw_action_card", "Seedy Spaceport: action card");
  if (seedyAc && seedyAc.option.value?.cost === "mech_present") return seedyAc;

  // Production (Freelancers, Immediate Assembly) needs a payment flow the autopilot does not plan; decline.
  return decline();
}

function relicFragments(d: RelicFragments, self: PlayerState | undefined): ExploreChoice | null {
  const opts = live(d.options);
  const typed = opts.filter((o) => o.value);
  const draw = typed.find((o) => o.value!.action === "draw");
  const any = typed[0]?.value;
  if (!any) return null;
  const setSize = (d.progress?.required?.setSize as number | undefined) ?? any.setSize ?? 3;
  const purged =
    (d.progress?.accumulated?.purged as number | undefined) ??
    sumDiff(any.fragmentsAtStart, fragments(self));
  if (purged >= setSize) {
    if (draw) return { option: draw, why: "relic: set purged, draw" };
    // Fabrication / Lanefir mech menus: one purge is the whole cost; press the menu's own done button.
    const done = opts.find((o) => !o.value && /done|finish/i.test(o.label));
    return done ? { option: done, why: "relic: done purging" } : null;
  }
  const purges = typed.filter((o) => o.value!.action === "purge" && !o.value!.supermassive);
  if (!draw) {
    // Single-fragment cost menus (Fabrication, Lanefir mech): purge one of what we hold most of (frontier last).
    if (purged > 0) {
      const done = opts.find((o) => !o.value && /done|finish/i.test(o.label));
      return done ? { option: done, why: "relic: done purging" } : null;
    }
    const one = [...purges]
      .filter((o) => o.value!.count === 1)
      .sort((a, b) => rankTrait(b.value!.trait, self) - rankTrait(a.value!.trait, self))[0];
    return one ? { option: one, why: `relic: purge 1 ${one.value!.trait}` } : null;
  }
  const need = setSize - purged;
  if (purged > 0) {
    // Second step: complete with frontier (wild), else more of the same trait we started.
    const front = purges.find((o) => o.value!.trait === "frontier" && o.value!.count === need);
    if (front) return { option: front, why: `relic: purge ${need} frontier` };
    const same = purges.find((o) => o.value!.count === need);
    return same ? { option: same, why: `relic: purge ${need} ${same.value!.trait}` } : null;
  }
  // First step: the non-frontier trait we hold most of, as many as useful.
  const now = fragments(self);
  const traits = (["cultural", "industrial", "hazardous"] as const).filter((t) => now[t] > 0).sort((a, b) => now[b] - now[a]);
  for (const t of traits) {
    const take = Math.min(now[t], setSize);
    if (take + now.frontier < setSize) continue;
    const o = purges.find((x) => x.value!.trait === t && x.value!.count === take);
    if (o) return { option: o, why: `relic: purge ${take} ${t}` };
  }
  const front = purges.find((o) => o.value!.trait === "frontier" && o.value!.count === Math.min(setSize, now.frontier));
  return front && now.frontier >= setSize ? { option: front, why: "relic: purge frontier fragments" } : null;
}

function rankTrait(t: string | null | undefined, self: PlayerState | undefined): number {
  if (!t || t === "frontier") return -1;
  return fragments(self)[t as keyof FragmentCounts] ?? 0;
}

function sumDiff(a: FragmentCounts | undefined, b: FragmentCounts): number {
  if (!a) return 0;
  let n = 0;
  for (const k of Object.keys(b) as (keyof FragmentCounts)[]) n += Math.max(0, (a[k] ?? 0) - b[k]);
  return n;
}
