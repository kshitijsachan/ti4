/** Engine renderers for game-level prompts (game.end), keyed by decision kind (picked up by the registry glob). */
import type { RendererModule } from "../../registry";
import { GameEndRenderer } from "./GameEndRenderer";

export const renderers: RendererModule["renderers"] = {
  "game.end": GameEndRenderer,
};
