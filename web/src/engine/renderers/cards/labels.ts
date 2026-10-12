import { actionCardData, promissoryData } from "@/hand/cardData";
import { getPlanetData } from "@/entities/lookup/planets";
import type { GameState, PlayerState } from "../../contract";
import { playerLabel as enginePlayerLabel } from "../../names";

/** Display names from typed ids (never from option labels). */
export function acName(id: string | null | undefined): string {
  if (!id) return "Action card";
  return actionCardData(id)?.name ?? id;
}

export function acWindow(id: string | null | undefined): string | undefined {
  return id ? actionCardData(id)?.window : undefined;
}

export function pnName(id: string): string {
  return promissoryData(id)?.name ?? id;
}

export function playerByFaction(state: GameState | null, faction: string | null | undefined): PlayerState | undefined {
  return faction ? state?.players.find((p) => p.faction === faction) : undefined;
}

export function playerLabel(state: GameState | null, faction: string | null | undefined): string {
  return enginePlayerLabel(state, faction);
}

export function planetName(id: string): string {
  return getPlanetData(id)?.name ?? id;
}

export function me(state: GameState | null): PlayerState | undefined {
  return state?.players.find((p) => p.self);
}
