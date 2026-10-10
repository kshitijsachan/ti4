import { registerStrategyCardRenderer } from "../index";
import type { RendererProps } from "../types";
import { CARDS } from "./cards";
import { StrategyFollowBody } from "./Follow";
import { StrategyPrimaryBody } from "./Primary";
import { TradePrimaryBody } from "./TradePrimary";

/**
 * Strategy-card renderers, one per card (primary and follow), registered with `registerStrategyCardRenderer`.
 * Imported for its side effect by `decisions/index.ts`.
 */
for (const sc of Object.keys(CARDS).map(Number)) {
  registerStrategyCardRenderer(sc, {
    follow: (props: RendererProps) => <StrategyFollowBody {...props} />,
    primary: (props: RendererProps) => (sc === 5 ? <TradePrimaryBody {...props} /> : <StrategyPrimaryBody {...props} />),
  });
}
