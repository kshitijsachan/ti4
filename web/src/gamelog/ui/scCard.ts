import { strategyCards } from "@/entities/data/strategyCards";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";
import type { StrategyCardDefinition } from "@/entities/data/types";
import type { GameEvent } from "../types";

const byImage = new Map<string, StrategyCardDefinition>();
for (const card of strategyCards) {
  if (!card.imageFileName || !card.primaryTexts.length || byImage.has(card.imageFileName)) continue;
  byImage.set(card.imageFileName, card);
}

/** The strategy card a play event names: the exact variant from its thread art, else the default for its number. */
export function strategyCardFor(event: GameEvent): StrategyCardDefinition | undefined {
  if (event.kind !== "sc_play") return undefined;
  const exact = event.scImage ? byImage.get(event.scImage) : undefined;
  if (exact) return exact;
  const label = event.summary.find((s) => s.t === "b");
  const n = label?.t === "b" ? Number(label.v.match(/^(\d+)/)?.[1]) : NaN;
  const card = Number.isFinite(n) ? getStrategyCardByInitiative(n) : undefined;
  return card?.primaryTexts.length ? card : undefined;
}
