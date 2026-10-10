import { registerStrategyCardRenderer } from "../index";
import type { RendererProps } from "../types";
import { CARDS } from "./cards";
import { StrategyFollowBody } from "./Follow";

/**
 * Strategy-card renderers, one per card (primary and follow), registered with `registerStrategyCardRenderer`.
 * Imported for its side effect by `decisions/index.ts`.
 */
for (const sc of Object.keys(CARDS).map(Number)) {
  registerStrategyCardRenderer(sc, { follow: (props: RendererProps) => <StrategyFollowBody {...props} /> });
}
