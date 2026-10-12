import { planets } from "@/entities/data/planets";
import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import { baseId, type Choice } from "./controls";

/** The bot's button that opens the expedition list ("Do an Expedition (N Remaining)"). */
export const EXPEDITION_ID = /^expeditionInfoAndButtons$/;

type ExpeditionKey = keyof PlayerDataResponse["expeditions"];

/** Each Thunder's Edge expedition's cost, in the bot's words (`Expeditions.getExpeditionMessage`). */
const COSTS: Record<ExpeditionKey, string> = {
  techSkip: "exhaust a technology specialty planet",
  tradeGoods: "spend 3 trade goods",
  fiveRes: "spend 5 resources",
  fiveInf: "spend 5 influence",
  secret: "discard a secret objective",
  actionCards: "discard 2 action cards",
};

const specialtyPlanets = new Set(planets.filter((p) => (p.techSpecialties ?? []).length > 0).map((p) => p.id));

function canPay(key: ExpeditionKey, me: PlayerData): boolean {
  const ready = me.planets.filter((p) => !me.exhaustedPlanets.includes(p));
  switch (key) {
    case "techSkip":
      return ready.some((p) => specialtyPlanets.has(p));
    case "tradeGoods":
      return me.tg >= 3;
    case "fiveRes":
      return me.resources + me.tg >= 5;
    case "fiveInf":
      return me.influence + me.tg >= 5;
    case "secret":
      return me.numUnscoredSecrets > 0;
    case "actionCards":
      return me.acCount >= 2;
  }
}

/**
 * The expeditions still open that I can pay for right now, as their costs. The bot offers "Do an Expedition" at
 * every end of turn and pass without checking any of this, so an empty list means the offer is noise.
 * Undefined when the game data is not loaded (then nothing is hidden).
 */
export function affordableExpeditions(me?: PlayerData, web?: PlayerDataResponse): string[] | undefined {
  if (!me || !web?.expeditions) return undefined;
  return (Object.keys(COSTS) as ExpeditionKey[])
    .filter((k) => web.expeditions[k] && web.expeditions[k].completedBy == null)
    .filter((k) => canPay(k, me))
    .map((k) => COSTS[k]);
}

export function isExpeditionChoice(c: Choice): boolean {
  return EXPEDITION_ID.test(baseId(c.customId));
}

/** The expedition is on offer at all: Thunder's Edge game, an expedition still open (the bot's own condition). */
export function expeditionOffered(web?: PlayerDataResponse): boolean {
  return Object.values(web?.expeditions ?? {}).some((e) => e?.completedBy == null);
}
