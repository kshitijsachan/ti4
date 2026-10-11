import type { ComponentType } from "react";
import type { Decision, DecisionKind, DecisionOf, GameState } from "../../../../../shim/src/engine/types";

/** What every engine decision renderer gets (see docs/ENGINE.md §6 step 5). */
export type RendererProps<D extends Decision = Decision> = {
  decision: D;
  state: GameState | null;
  /** Answers with an option id (or a payload, for kinds that take one); may resolve when the engine answered. */
  answer: (optionIdOrPayload: string | Record<string, unknown>) => unknown;
};

export type Renderer<K extends DecisionKind> = ComponentType<RendererProps<DecisionOf<K>>>;

export type { Decision, GameState };
