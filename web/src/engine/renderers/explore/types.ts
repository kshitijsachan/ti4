import type { ExploreEvent } from "../../../../../shim/src/engine/kinds/explore";
import type { GameState, Option } from "../../../../../shim/src/engine/types";

export type RendererProps<D> = {
  decision: D;
  state: GameState | null;
  answer: (optionIdOrPayload: string) => unknown;
  pendingOptionId?: string | null;
};

export const isLive = <V,>(o: Option<V>) => !o.disabled && !o.needsInput;

const TRAIT_LABEL: Record<string, string> = {
  cultural: "Cultural",
  industrial: "Industrial",
  hazardous: "Hazardous",
  frontier: "Frontier",
};

export const traitLabel = (t: string | null | undefined) => (t ? (TRAIT_LABEL[t] ?? t) : "");

/** The most recent exploration result of a player (what the decision in front of them is about). */
export function latestExplore(state: GameState | null, userId: string | null | undefined): ExploreEvent | null {
  const recent = state?.exploration?.recent ?? [];
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].type === "explore" && (!userId || recent[i].userId === userId)) return recent[i];
  }
  return null;
}
