import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import type { Decision } from "../model/classify";
import type { Choice } from "../model/controls";
import type { PressFn } from "../ui/ChoiceButtons";

/** Live game context a renderer can draw on. */
export type DecisionData = {
  gameName: string;
  web?: PlayerDataResponse;
  me?: PlayerData;
  players: PlayerData[];
  /** Action-card aliases in my hand, when the seat's hand could be read. */
  hand?: string[];
};

export type RendererProps = {
  d: Decision;
  data: DecisionData;
  onPress: PressFn;
  pendingKey: string | null;
  onHoverChoice: (c: Choice | null) => void;
};

export function playerByFaction(data: DecisionData, faction?: string) {
  if (!faction) return undefined;
  return data.players.find((p) => p.faction === faction || p.color === faction);
}

export function playerByName(data: DecisionData, name?: string) {
  if (!name) return undefined;
  const n = name.toLowerCase();
  return data.players.find((p) => p.userName.toLowerCase() === n || p.displayName?.toLowerCase() === n);
}
