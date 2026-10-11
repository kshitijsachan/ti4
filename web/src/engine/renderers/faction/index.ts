import type { RendererModule } from "../../registry";
import { FactionStep } from "./FactionStep";

/** Shared faction kinds: every faction's leaders and abilities (phase C faction areas). */
export const renderers: RendererModule["renderers"] = {
  "leader.use": FactionStep,
  "faction.ability": FactionStep,
};
