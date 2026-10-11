/**
 * Engine renderers for perpetual / optional / undo prompts, preferences and select-only prompts (c12), keyed by
 * decision kind (picked up by the registry glob). `ui.*` decisions are affordances, not questions: the reducer never
 * counts them as waiting on anyone; these renderers draw them when they are shown.
 */
import type { RendererModule } from "../../registry";
import { InfoMenuRenderer, OptionalRenderer, PreferenceRenderer, SelectRenderer, UndoAffordanceRenderer } from "./UiRenderers";

export const renderers: RendererModule["renderers"] = {
  "ui.undo_affordance": UndoAffordanceRenderer,
  "ui.optional": OptionalRenderer,
  "ui.info_menu": InfoMenuRenderer,
  "player.preference": PreferenceRenderer,
  "choose.select": SelectRenderer,
};
