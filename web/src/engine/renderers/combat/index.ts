import { createElement, type ComponentType } from "react";
import type { CombatHits } from "../../../../../shim/src/engine/kinds/combat";
import { CombatHitsPanel } from "./CombatHitsPanel";
import { CombatAssignUnitsPanel, CombatRetreatPanel } from "./CombatMenuPanels";
import { CombatRoundPanel } from "./CombatRoundPanel";
import type { RendererProps } from "./types";

export type { CombatPlanPayload } from "./types";

/** The hits panel keeps a local plan: start it afresh when the hits change (e.g. a hit was cancelled). */
function CombatHitsKeyed(props: RendererProps<CombatHits>) {
  return createElement(CombatHitsPanel, { ...props, key: `${props.decision.id}@${props.decision.revision}` });
}

/**
 * Combat (G4) renderers by decision kind. answer(optionId) answers an option; answer({kind: "combat-plan", plan})
 * must be sent to POST /api/game/{g}/engine/decisions/{id}/combat-plan with body {plan, expectedSeq}.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<RendererProps<any>>> = {
  "combat.round": CombatRoundPanel,
  "combat.hits": CombatHitsKeyed,
  "combat.assign_units": CombatAssignUnitsPanel,
  "combat.retreat": CombatRetreatPanel,
};
