import type { ComponentType } from "react";
import type { Decision, DecisionKind, DecisionOf, GameState } from "./contract";
import type { AnswerPayload } from "./link";
import { GenericDecision } from "./GenericDecision";

/** What every engine decision renderer gets. Draw from `option.value` + `state`, never from labels or ids. */
export type EngineRendererProps<D extends Decision = Decision> = {
  decision: D;
  state: GameState | null;
  answer: (optionIdOrPayload: string | AnswerPayload) => void;
  /** The option whose answer is in flight, if any (disable the rest). */
  pendingOptionId?: string | null;
};

export type EngineRenderer<K extends DecisionKind = DecisionKind> = ComponentType<EngineRendererProps<DecisionOf<K>>>;

/** An area's `renderers/<area>/index.ts` exports `renderers: { "<kind>": Component }`. */
export type RendererModule = { renderers?: Partial<{ [K in DecisionKind]: EngineRenderer<K> }> & Record<string, unknown> };

const modules = import.meta.glob<RendererModule>("./renderers/*/index.{ts,tsx}", { eager: true });

/** kind → renderer, from every area's index (area teams add files; nothing to register here). */
export const RENDERERS: Record<string, EngineRenderer> = buildRegistry(modules);

export function buildRegistry(mods: Record<string, RendererModule>): Record<string, EngineRenderer> {
  const out: Record<string, EngineRenderer> = {};
  for (const [path, mod] of Object.entries(mods).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [kind, component] of Object.entries(mod.renderers ?? {})) {
      if (typeof component !== "function" && typeof component !== "object") continue;
      if (out[kind] && import.meta.env.DEV) console.warn(`engine renderer for ${kind} defined twice (${path})`);
      out[kind] = component as EngineRenderer;
    }
  }
  return out;
}

/** The renderer for a decision's kind; untyped (`legacy`) and unknown kinds get buttons from the options' labels. */
export function rendererFor(kind: string): EngineRenderer {
  return RENDERERS[kind] ?? (GenericDecision as EngineRenderer);
}
