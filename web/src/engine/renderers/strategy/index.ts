import type { ComponentType } from "react";
import { PlayedCard } from "./PlayedCard";
import {
  AgendaView,
  CommandTokensView,
  ConstructionPlaceView,
  DiplomacySystemView,
  PickCard,
  PlanetReadyView,
  QueuePick,
  SpeakerView,
  StrategicActionView,
  TradeReplenishView,
} from "./Prompts";
import type { RendererProps } from "./shared";

/** G2 strategy-card renderers by decision kind (wired by INFRA-2 via import.meta.glob). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderers: Record<string, ComponentType<RendererProps<any>>> = {
  "strategy_card.pick": PickCard,
  "strategy_card.queue_pick": QueuePick,
  "strategy_card.strategic_action": StrategicActionView,
  "strategy_card.resolve": PlayedCard,
  "strategy_card.diplomacy_system": DiplomacySystemView,
  "planet.ready": PlanetReadyView,
  "strategy_card.politics_speaker": SpeakerView,
  "strategy_card.politics_agenda": AgendaView,
  "strategy_card.construction_place": ConstructionPlaceView,
  "strategy_card.trade_replenish": TradeReplenishView,
  "command_tokens.adjust": CommandTokensView,
};
