// Run: cd shim && npx tsx --test src/engine/policy/production.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planPayment, productionPayload } from "./production.js";
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
  assert.equal(planPayment(payment(vals, 3, 3), state(0, [], 5), "u"), null);
  const p = planPayment(payment(vals, 3, 3, { keleresAgent: true } as Partial<PaymentValue>), state(0, [], 5), "u");
  assert.equal(p?.payload.commodities, 2);
});

test("Sarween is used when offered", () => {
  const d = payment([planet("a", 2), { source: "discount", discount: "sarween" }], 3, 3);
  assert.deepEqual(planPayment(d, state(0), "u")?.payload, { planets: ["a"], sarween: true });
});

test("cannot cover → null (the engine refuses underpay)", () => {
  assert.equal(planPayment(payment([planet("a", 1)], 5, 5), state(0), "u"), null);
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
