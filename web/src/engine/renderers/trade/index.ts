import type { ComponentType } from "react";
import { TradeForceReplenishRenderer } from "./TradeForceReplenish";
import { TradeOfferRenderer } from "./TradeOffer";
import { TradeOfferSentRenderer } from "./TradeOfferSent";

/**
 * G11 trade renderers, keyed by decision kind. The deal builder itself is the trade drawer (`@/trade` TradePanel),
 * driven by GameState.trade and the `trade.propose` action; "Counter…" here opens it with the offer mirrored.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<any>> = {
  "trade.offer": TradeOfferRenderer,
  "trade.offer_sent": TradeOfferSentRenderer,
  "trade.force_replenish": TradeForceReplenishRenderer,
};
