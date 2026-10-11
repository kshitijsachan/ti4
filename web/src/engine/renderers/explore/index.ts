import type { ComponentType } from "react";
import {
  ExploreCardPickPanel,
  ExploreFrontierPanel,
  ExploreOutcomePanel,
  ExplorePlanetPanel,
  RelicDrawPanel,
  RelicFragmentsPanel,
} from "./ExplorePanels";
import type { RendererProps } from "./types";

export { ExploreResult } from "./ExplorePanels";

/** Exploration + relic (G9) renderers by decision kind. answer(optionId) answers an option. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<RendererProps<any>>> = {
  "explore.planet": ExplorePlanetPanel,
  "explore.card_pick": ExploreCardPickPanel,
  "explore.frontier": ExploreFrontierPanel,
  "explore.outcome": ExploreOutcomePanel,
  "relic.fragments": RelicFragmentsPanel,
  "relic.draw": RelicDrawPanel,
};
