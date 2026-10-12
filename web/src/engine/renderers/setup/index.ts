/**
 * Engine decision renderers for setup + draft (workstream G1), keyed by decision kind. Wired by the INFRA-2 glob
 * registry. Every renderer reads option.value and GameState (draft picks, setup stage), never labels or prompt text.
 */
import type { ComponentType } from "react";
import { MiltyDraftInfoRenderer, MiltyDraftPickRenderer, MiltyDraftQueueRenderer } from "./Draft";
import { KeleresFlavorRenderer, KeleresTechRenderer } from "./Keleres";
import { GameSettingsRenderer, PlayerSetupRenderer } from "./Misc";
import { DealSecretsRenderer, RevealObjectivesRenderer, SecretDiscardRenderer } from "./Secrets";
import { TechChooseTypeRenderer, TechGainRenderer } from "./Tech";
import type { RendererProps } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<RendererProps<any>>> = {
  "draft.milty.pick": MiltyDraftPickRenderer,
  "draft.milty.queue": MiltyDraftQueueRenderer,
  "draft.milty.info": MiltyDraftInfoRenderer,
  "setup.keleres_flavor": KeleresFlavorRenderer,
  "setup.keleres_tech": KeleresTechRenderer,
  "setup.player": PlayerSetupRenderer,
  "setup.deal_secrets": DealSecretsRenderer,
  "setup.reveal_objectives": RevealObjectivesRenderer,
  "setup.game_settings": GameSettingsRenderer,
  "secret_objective.discard": SecretDiscardRenderer,
  "tech.gain": TechGainRenderer,
  "tech.choose_type": TechChooseTypeRenderer,
};
