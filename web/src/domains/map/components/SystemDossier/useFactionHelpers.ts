import { getColorAlias } from "@/entities/lookup/colors";
import { factionKeyDisplayName, getPlayerFactionDisplayName } from "@/entities/game/playerUtils";
import { useGameData } from "@/state/useGameContext";
import type { PlayerData } from "@/entities/data/types";

export type FactionHelpers = ReturnType<typeof useFactionHelpers>;

export function useFactionHelpers() {
  const gameData = useGameData();
  const players = gameData?.playerData ?? [];

  const playerFor = (faction: string): PlayerData | undefined =>
    players.find((p) => p.faction === faction);

  const displayName = (faction: string): string => {
    const player = playerFor(faction);
    if (player) return getPlayerFactionDisplayName(player);
    const name = factionKeyDisplayName(faction);
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  const colorAlias = (faction: string): string =>
    getColorAlias(playerFor(faction)?.color);

  return { playerFor, displayName, colorAlias };
}
