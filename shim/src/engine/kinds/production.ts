/**
 * G5 production + payment kinds. Mirrors bot ti4.selfhost.engine.kinds.PaymentSpendKind / ProductionProduceKind.
 *
 * Both are answered atomically with a payload (AnswerRequest.payload) instead of one option at a time: the engine
 * validates the whole answer, then makes the presses under the game lock. Plain option presses still work (legacy).
 */
import type { DecisionBase, Progress } from "../types.js";

// ---------------------------------------------------------------- payment.spend

export type PaymentCurrency = "res" | "inf" | "both" | "freelancers" | string;

export type PaymentPlanetValue = {
  source: "planet";
  planet: string;
  /** Include attachments and other modifiers (engine Planet values). */
  resources: number;
  influence: number;
  techSpecialties: string[];
  legendary: boolean;
};
export type PaymentTgValue = { source: "tg"; amount: number };
/** Only offered while the Keleres agent is ready: commodities are never money otherwise. */
export type PaymentCommoditiesValue = { source: "commodities"; amount: number };
export type PaymentDiscountValue = { source: "discount"; discount: "sarween" };
export type PaymentResetValue = { action: "reset" };
export type PaymentDoneValue = {
  action: "done";
  /** What Done finishes: "tacticalAction", "technology", "leadership", "componentAction", "spitItOut", ... */
  context: string;
  for: string;
  currency: PaymentCurrency;
  tech: boolean;
  /** Known for production (engine's own build cost) or read from the first prompt; null = unknown. */
  cost: number | null;
  costSource: "production" | "prompt" | null;
  spentResources: number;
  spentInfluence: number;
  /** 2 with Mirror Computing. */
  tgValue: number;
  keleresAgent: boolean;
};
export type PaymentValue =
  | PaymentPlanetValue
  | PaymentTgValue
  | PaymentCommoditiesValue
  | PaymentDiscountValue
  | PaymentResetValue
  | PaymentDoneValue;

export type PaymentProgress = Progress<{ resources: number; influence: number; planets: string[]; tg?: number }> & {
  required: { currency: PaymentCurrency; cost: number | null; costSource: string | null; remaining: number | null };
};

export type PaymentSpend = DecisionBase<"payment.spend", PaymentValue>;

/** The one answer that pays: planets exhausted, trade goods, commodities (Keleres agent only), Sarween Tools. */
export interface PaymentPayload {
  planets: string[];
  tg?: number;
  commodities?: number;
  sarween?: boolean;
}

// ---------------------------------------------------------------- production.produce

export type ProductionPlaceValue = {
  /** Async unit id: gf, ff, mf, dd, ca, cv, dn, fs, ws, sd, pd, ... */
  unit: string;
  /** 2 for the "2 infantry / 2 fighters" buttons. */
  count: number;
  /** "space" or a planet id. */
  holder: string;
  tile: string | null;
  /** Resource cost of one unit (0.5 for fighters/infantry); null if unknown. */
  cost: number | null;
};
export type ProductionResetValue = { action: "reset" };
export type ProductionDoneValue = {
  action: "done";
  context: string;
  tile: string | null;
  produced: Record<string, number>;
  unitCount: number;
  cost: number;
  /** Production limit the engine applies here (tactical action, Warfare, Bellum Gloriosum); null = not enforced. */
  productionLimit: number | null;
};
export type ProductionValue = ProductionPlaceValue | ProductionResetValue | ProductionDoneValue;

export type ProductionProduce = DecisionBase<"production.produce", ProductionValue>;

/** The one answer that produces: units to place, then Done (empty list = build nothing). */
export interface ProductionPayload {
  units: { unit: string; count: number; holder?: string; tile?: string }[];
}

// ---------------------------------------------------------------- production.place

/**
 * Free placements (Mitosis, Parasite, commanders, heroes, action cards): placeOneNDone_. holder: planet id or "space";
 * tile: position (null when unknown). free: placed (no production) vs produced.
 */
export type FreePlacementValue =
  | { op: "place"; unit: string; count: number; holder: string; tile: string | null; free: boolean }
  | { op: "mitosis_infantry" }
  | { op: "mitosis_mech" }
  | { op: "done" };
export type ProductionPlace = DecisionBase<"production.place", FreePlacementValue>;

// ---------------------------------------------------------------- commodities.gain

/** Gain / convert commodities outside exploration (stay: the prompt stays after the press). */
export type CommoditiesValue = { op: "gain" | "convert"; amount: number; stay: boolean } | { op: "done" };
export type CommoditiesGain = DecisionBase<"commodities.gain", CommoditiesValue>;

export type ProductionDecision = PaymentSpend | ProductionProduce | ProductionPlace | CommoditiesGain;

export function isPaymentDone(v: PaymentValue | null | undefined): v is PaymentDoneValue {
  return !!v && "action" in v && v.action === "done";
}
export function isProductionDone(v: ProductionValue | null | undefined): v is ProductionDoneValue {
  return !!v && "action" in v && v.action === "done";
}
export function isPlacement(v: ProductionValue | null | undefined): v is ProductionPlaceValue {
  return !!v && "unit" in v;
}
