/**
 * G5 production + payment kinds. Mirrors bot ti4.selfhost.engine.kinds.PaymentSpendKind / ProductionProduceKind.
 *
 * Both are answered atomically with a payload (AnswerRequest.payload) instead of one option at a time: the engine
 * validates the whole answer, then makes the presses under the game lock. Plain option presses still work (legacy).
 */
import type { DecisionBase, HolderName, PlanetId, Progress, TilePosition, UnitId } from "../types.js";

// ---------------------------------------------------------------- payment.spend

export type PaymentCurrency = "res" | "inf" | "both" | "freelancers" | string;

export type PaymentPlanetValue = {
  source: "planet";
  planet: PlanetId;
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
  costSource: "production" | "prompt" | "objective" | "technology" | null;
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

export type PaymentProgress = Progress<{ resources: number; influence: number; planets: PlanetId[]; tg?: number }> & {
  required: { currency: PaymentCurrency; cost: number | null; costSource: string | null; remaining: number | null };
};

export type PaymentSpend = DecisionBase<"payment.spend", PaymentValue>;

/** The one answer that pays: planets exhausted, trade goods, commodities (Keleres agent only), Sarween Tools. */
export interface PaymentPayload {
  planets: PlanetId[];
  tg?: number;
  commodities?: number;
  sarween?: boolean;
}

// ---------------------------------------------------------------- production.produce

export type ProductionPlaceValue = {
  /** Async unit id: gf, ff, mf, dd, ca, cv, dn, fs, ws, sd, pd, ... */
  unit: UnitId;
  /** 2 for the "2 infantry / 2 fighters" buttons. */
  count: number;
  /** "space" or a planet id. */
  holder: HolderName;
  tile: TilePosition | null;
  /** Resource cost of one unit (0.5 for fighters/infantry); null if unknown. */
  cost: number | null;
  /**
   * Units of this type left in the player's reinforcements (component limit; ships and mechs). null / absent = not
   * limited (fighters, infantry, structures) or an older bot. The engine refuses producing more than this.
   */
  remaining?: number | null;
};
export type ProductionResetValue = { action: "reset" };
export type ProductionDoneValue = {
  action: "done";
  context: string;
  tile: TilePosition | null;
  produced: Partial<Record<UnitId, number>>;
  unitCount: number;
  cost: number;
  /** Production limit the engine applies here (tactical action, Warfare, Bellum Gloriosum); null = not enforced. */
  productionLimit: number | null;
  /** A capped production's cap (Umbat, Production / Armament Rider, Maximus, Availyn, Flaah Hyphae): enforced. */
  limit?: ProductionCap | null;
};

/**
 * The cap of a capped production, enforced by the engine (validate) and the bot's own buttons: at most maxUnits
 * units in all (each fighter / infantry counts), each costing ≤ maxEachCost, all together ≤ maxTotalCost, only
 * onlyUnit. label: e.g. "Umbat: up to 2 units, each cost ≤4".
 */
export interface ProductionCap {
  maxUnits: number;
  maxEachCost: number | null;
  maxTotalCost: number | null;
  onlyUnit: UnitId | null;
  source: "umbat" | "rider" | "maximus" | "availyn" | "flaah" | string;
  label: string;
}
export type ProductionValue = ProductionPlaceValue | ProductionResetValue | ProductionDoneValue;

export type ProductionProduce = DecisionBase<"production.produce", ProductionValue>;

/** The one answer that produces: units to place, then Done (empty list = build nothing). */
export interface ProductionPayload {
  units: { unit: UnitId; count: number; holder?: HolderName; tile?: TilePosition }[];
}

// ---------------------------------------------------------------- production.place

/**
 * Free placements (Parasite, commanders, heroes, action cards; the Mitosis choice itself is faction.ability): placeOneNDone_. holder: planet id or "space";
 * tile: position (null when unknown). free: placed (no production) vs produced.
 */
export type FreePlacementValue =
  | { op: "place"; unit: UnitId; count: number; holder: HolderName; tile: TilePosition | null; free: boolean }
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
/** Why a production cap rules this unit out (only unit / cost each); null when it may be produced under the cap. */
export function capExcludes(cap: ProductionCap | null | undefined, unit: UnitId, cost: number | null): string | null {
  if (!cap) return null;
  if (cap.onlyUnit && cap.onlyUnit !== unit) return "not allowed";
  if (cap.maxEachCost != null && cost != null && cost > cap.maxEachCost) return `costs ${cost} (> ${cap.maxEachCost})`;
  return null;
}

/**
 * How many more units of this cost fit under a production cap, given `units` units costing `spent` already chosen
 * (produced before + picked); Infinity without a cap.
 */
export function capRoom(cap: ProductionCap | null | undefined, cost: number | null, units: number, spent: number): number {
  if (!cap) return Infinity;
  let room = Math.max(0, cap.maxUnits - units);
  if (cap.maxTotalCost != null && cost) room = Math.min(room, Math.max(0, Math.floor((cap.maxTotalCost - spent + 1e-6) / cost)));
  return room;
}

export function isProductionDone(v: ProductionValue | null | undefined): v is ProductionDoneValue {
  return !!v && "action" in v && v.action === "done";
}
export function isPlacement(v: ProductionValue | null | undefined): v is ProductionPlaceValue {
  return !!v && "unit" in v;
}
