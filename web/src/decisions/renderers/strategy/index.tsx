import { registerStrategyCardRenderer, strategyStepRenderers } from "../index";
import type { RendererProps } from "../types";
import { CARDS } from "./cards";
import { StrategyFollowBody } from "./Follow";
import { StrategyPrimaryBody } from "./Primary";
import { TradePrimaryBody } from "./TradePrimary";
import { LeadershipBody, isLeadershipStep } from "./Leadership";
import { DiploSystemBody, isDiploSystemStep } from "./DiploSystem";
import { ReadyPlanetsBody, isReadyPlanetsStep } from "./ReadyPlanets";
import { ImperialScoreBody, isImperialScoreStep } from "./ImperialScore";
import { AgendaPlacementBody, isAgendaPlacementStep } from "./AgendaPlacement";

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

strategyStepRenderers.push((props: RendererProps) => (isLeadershipStep(props.d.choices) ? <LeadershipBody {...props} /> : null));
strategyStepRenderers.push((props: RendererProps) => (isDiploSystemStep(props.d.choices) ? <DiploSystemBody {...props} /> : null));
strategyStepRenderers.push((props: RendererProps) => (isReadyPlanetsStep(props.d.choices) ? <ReadyPlanetsBody {...props} /> : null));
strategyStepRenderers.push((props: RendererProps) => (isImperialScoreStep(props.d.choices) ? <ImperialScoreBody {...props} /> : null));
strategyStepRenderers.push((props: RendererProps) => (isAgendaPlacementStep(props.d.choices) ? <AgendaPlacementBody {...props} /> : null));
