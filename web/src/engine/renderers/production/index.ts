import type { ComponentType } from "react";
import { PaymentRenderer } from "./Payment";
import { ProductionRenderer } from "./Production";
import type { AreaRendererProps } from "./shared";

/**
 * Production + payment renderers (G5), keyed by decision kind. Both answer with `{ optionId: <Done>, payload }`: the
 * engine checks the whole answer and executes it atomically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<AreaRendererProps<any>>> = {
  "payment.spend": PaymentRenderer,
  "production.produce": ProductionRenderer,
};
