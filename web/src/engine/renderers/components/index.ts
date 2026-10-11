import type { ComponentType } from "react";
import { ChoosePanel, ComponentActionPanel, LeaderAgentPanel, RelicUsePanel, TechStepPanel, type RendererProps } from "./ComponentPanels";

/** Components (C6) renderers by decision kind: component menu, relic uses, agent step, generic choose.* steps. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<RendererProps<any>>> = {
  "choose.planet": ChoosePanel,
  "choose.system": ChoosePanel,
  "choose.player": ChoosePanel,
  "choose.unit": ChoosePanel,
  "choose.amount": ChoosePanel,
  "choose.card": ChoosePanel,
  "choose.confirm": ChoosePanel,
  "component.action": ComponentActionPanel,
  "relic.use": RelicUsePanel,
  "leader.agent": LeaderAgentPanel,
  "tech.step": TechStepPanel,
};
