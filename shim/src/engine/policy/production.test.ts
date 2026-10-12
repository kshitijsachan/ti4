// Run: cd shim && npx tsx --test src/engine/policy/production.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseCappedBuild, planPayment, productionPayload } from "./production.js";
import type { PaymentSpend, PaymentValue, ProductionProduce, ProductionValue } from "../kinds/production.js";
import type { GameState, Option, PlanetId } from "../types.js";

const opt = <V>(id: string, value: V | null): Option<V> => ({ id, label: id, style: "danger", emoji: null, disabled: false, needsInput: false, handler: id, value });

function payment(values: (PaymentValue | null)[], cost: number | null, remaining: number | null, extra: Partial<PaymentValue> = {}): PaymentSpend {
  const done = { action: "done", context: "tacticalAction", for: "res", currency: "res", tech: false, cost, costSource: cost === null ? null : "production", spentResources: 0, spentInfluence: 0, tgValue: 1, keleresAgent: false, ...extra } as PaymentValue;
  return {
    id: "d1", game: "g", kind: "payment.spend", seq: 1, stateVersion: 1, target: null, scope: "player", visibility: "public", prompt: "",
    options: [...values.map((v, i) => opt(`o${i}`, v)), opt("done", done)],
    source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false }, createdAt: 0, revision: 1, window: null,
    progress: { flow: "payment", step: "select_sources", accumulated: {}, required: { currency: "res", cost, costSource: "production", remaining }, canCommit: false },
  } as PaymentSpend;
}

// Fixture planet ids ("a", "b", …) are not real ones: cast.
const planet = (id: string, resources: number, influence = 0): PaymentValue => ({ source: "planet", planet: id as PlanetId, resources, influence, techSpecialties: [], legendary: false });
const state = (tg: number, exhausted: string[] = [], commodities = 0) =>
  ({ players: [{ userId: "u", self: true, tg, commodities, exhaustedPlanets: exhausted }] }) as unknown as GameState;

test("least waste: exact subset over bigger planet", () => {
  const d = payment([planet("a", 4), planet("b", 2), planet("c", 1)], 3, 3);
  const p = planPayment(d, state(0), "u");
  assert.deepEqual(p?.payload.planets.sort(), ["b", "c"]);
});

test("unknown cost is left to the caller", () => {
  assert.equal(planPayment(payment([planet("a", 4)], null, null), state(0), "u"), null);
});

test("exhausted planets are never used; trade goods cover the rest", () => {
  const d = payment([planet("a", 4), planet("b", 2), { source: "tg", amount: 1 }], 3, 3);
  const p = planPayment(d, state(5, ["a"]), "u");
  assert.deepEqual(p?.payload, { planets: ["b"], tg: 1 });
});

test("already counted spend is subtracted; nothing due → empty payment", () => {
  const p = planPayment(payment([planet("a", 4)], 3, 0), state(0), "u");
  assert.deepEqual(p?.payload, { planets: [] });
});

test("commodities only with the Keleres agent", () => {
  const vals = [planet("a", 1), { source: "tg", amount: 1 } as PaymentValue, { source: "commodities", amount: 1 } as PaymentValue];
  assert.deepEqual(planPayment(payment(vals, 3, 3), state(0, [], 5), "u")?.payload, { planets: ["a"] }); // no agent: commodities never spent
  const p = planPayment(payment(vals, 3, 3, { keleresAgent: true } as Partial<PaymentValue>), state(0, [], 5), "u");
  assert.equal(p?.payload.commodities, 2);
});

test("Sarween is used when offered", () => {
  const d = payment([planet("a", 2), { source: "discount", discount: "sarween" }], 3, 3);
  assert.deepEqual(planPayment(d, state(0), "u")?.payload, { planets: ["a"], sarween: true });
});

test("cannot cover → spend everything offered (the engine lets Done finish)", () => {
  assert.deepEqual(planPayment(payment([planet("a", 1)], 5, 5), state(0), "u")?.payload, { planets: ["a"] });
});

test("production payment with nothing left to spend (Reset / Sarween / Done only)", () => {
  const sarween: PaymentValue = { source: "discount", discount: "sarween" };
  assert.deepEqual(planPayment(payment([{ action: "reset" }, sarween], 3, 3), state(0), "u")?.payload, { planets: [], sarween: true });
  assert.deepEqual(planPayment(payment([{ action: "reset" }], null, null), state(0), "u")?.payload, { planets: [] });
  // Unknown cost with something to spend stays the planner's.
  assert.equal(planPayment(payment([planet("a", 2)], null, null), state(0), "u"), null);
});

test("plain planets before tech-skip planets, trade goods last", () => {
  const skip: PaymentValue = { source: "planet", planet: "s" as PlanetId, resources: 2, influence: 0, techSpecialties: ["warfare"], legendary: false };
  const d = payment([skip, planet("p", 2), { source: "tg", amount: 1 }], 2, 2);
  assert.deepEqual(planPayment(d, state(3), "u")?.payload, { planets: ["p"] });
  const big = payment([planet("a", 3), { source: "tg", amount: 1 }], 1, 1);
  assert.deepEqual(planPayment(big, state(3), "u")?.payload, { planets: ["a"] });
});

test("production payload groups units, ground forces on a planet", () => {
  const places: ProductionValue[] = [
    { unit: "cv", count: 1, holder: "space", tile: "301", cost: 3 },
    { unit: "gf", count: 1, holder: "space", tile: "301", cost: 0.5 },
    { unit: "gf", count: 1, holder: "lodor", tile: "301", cost: 0.5 },
    { unit: "gf", count: 2, holder: "lodor", tile: "301", cost: 0.5 },
  ];
  const d = { kind: "production.produce", options: places.map((v, i) => opt(`p${i}`, v)) } as unknown as ProductionProduce;
  assert.deepEqual(productionPayload(d, ["cv", "gf", "gf", "ws"]).units, [{ unit: "cv", count: 1 }, { unit: "gf", count: 2, holder: "lodor" }]);
  assert.deepEqual(productionPayload(d, []).units, []);
});

// User report: "for umbat, shouldn't it check that i only make 2 units?" — a capped production (Umbat: up to 2 units
// each costing 4 or less) takes only what fits, and the bot builds within it when Umbat is used on it.
test("capped production (Umbat): payload clipped, capped build for the bot", () => {
  const places: ProductionValue[] = [
    { unit: "dn", count: 1, holder: "space", tile: "304", cost: 4 },
    { unit: "dd", count: 1, holder: "space", tile: "304", cost: 1 },
    { unit: "ff", count: 2, holder: "space", tile: "304", cost: 0.5 },
    { unit: "ws", count: 1, holder: "space", tile: "304", cost: 12 },
    {
      action: "done", context: "muaatagent", tile: "304", produced: {}, unitCount: 0, cost: 0, productionLimit: null,
      limit: { maxUnits: 2, maxEachCost: 4, maxTotalCost: null, onlyUnit: null, source: "umbat", label: "Umbat: up to 2 units, each cost ≤4" },
    },
  ];
  const d = { kind: "production.produce", target: { userId: "u" }, options: places.map((v, i) => opt(`p${i}`, v)) } as unknown as ProductionProduce;
  assert.deepEqual(productionPayload(d, ["ws", "dn", "dn", "dd"]).units, [{ unit: "dn", count: 2 }]);
  assert.deepEqual(productionPayload(d, ["dd", "ff", "ff"]).units, [{ unit: "dd", count: 1 }, { unit: "ff", count: 1 }]);
  const pick = chooseCappedBuild(d, state(3), "u");
  assert.deepEqual(pick?.payload, { units: [{ unit: "dd", count: 2 }] });
  assert.equal(chooseCappedBuild(d, state(3), "someone else"), null);
});

// Live (pbd36 / pbd60 / pbd88 / pbd90 / pbd92 / pbd105): unpriced Leadership / Technology bills waited out the 60 s
// fallback ("Done Exhausting Planets") and stalled the seat.
const withCards = (cards: { card: string; holder: string; played: boolean }[]) =>
  ({ ...state(0), strategyCards: cards.map((c, i) => ({ number: i + 1, tradeGoods: 0, name: c.card, holderFaction: null, reactions: [], ...c })) }) as unknown as GameState;

test("leadership bill (cost null): buys no extra tokens, finishes at once", () => {
  const d = payment([planet("a", 1, 4)], null, null, { context: "leadership", for: "inf", currency: "inf" } as Partial<PaymentValue>);
  const p = planPayment(d, withCards([]), "u");
  assert.deepEqual(p?.payload, { planets: [] });
  assert.match(p!.why, /leadership: nothing to pay/);
});

test("technology bill (cost null): free for the Technology holder's research", () => {
  const d = payment([planet("a", 4)], null, null, { context: "technology", for: "restech", tech: true } as Partial<PaymentValue>);
  assert.deepEqual(planPayment(d, withCards([{ card: "pok7technology", holder: "u", played: true }]), "u")?.payload, { planets: [] });
});

test("technology bill (cost null): a follower pays 4 resources", () => {
  const d = payment([planet("a", 4), planet("b", 1)], null, null, { context: "technology", for: "restech", tech: true } as Partial<PaymentValue>);
  assert.deepEqual(planPayment(d, withCards([{ card: "pok7technology", holder: "x", played: true }]), "u")?.payload, { planets: ["a"] });
});

test("technology bill (cost null) with no Technology card played: left to the caller", () => {
  const d = payment([planet("a", 4)], null, null, { context: "technology", for: "restech", tech: true } as Partial<PaymentValue>);
  assert.equal(planPayment(d, withCards([]), "u"), null);
});
