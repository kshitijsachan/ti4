import { baseId } from "../../model/controls";
import { strategyStepRenderers } from "../index";
import type { RendererProps } from "../types";
import { isPaymentPrompt } from "./model";
import { PaymentBody } from "./Payment";
import { isProductionPrompt } from "./production";
import { ProductionBody } from "./Production";

/**
 * Payment and production panels, for every bot spend prompt (planets, trade goods, discounts, Done) and every
 * "Produce Units" prompt. Registered as step renderers so they win over the kind-based bodies; Leadership keeps its
 * own panel (registered before this one). Imported for its side effect by `decisions/index.ts`.
 */
const leadership = (props: RendererProps) => props.d.choices.some((c) => baseId(c.customId) === "deleteButtons_leadership");

strategyStepRenderers.push((props: RendererProps) => (isProductionPrompt(props.d.choices) ? <ProductionBody {...props} /> : null));
strategyStepRenderers.push((props: RendererProps) =>
  isPaymentPrompt(props.d.choices) && !leadership(props) ? <PaymentBody key={props.d.id} {...props} /> : null,
);
