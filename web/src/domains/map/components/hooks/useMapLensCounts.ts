import { useMemo } from "react";
import { useGameData } from "@/state/useGameContext";
import type { MapLensKey } from "@/state/appStore";

/** How many systems each map highlight would light up on the current board. */
export function useMapLensCounts(): Record<MapLensKey, number> {
  const game = useGameData();
  return useMemo(() => {
    const tiles = Object.values(game?.tiles ?? {});
    return {
      planetTypesMode: tiles.filter((t) => Object.keys(t.planets ?? {}).length > 0).length,
      techSkipsMode: tiles.filter((t) => t.hasTechSkips).length,
      attachmentsMode: tiles.filter((t) => t.hasAttachments).length,
      showPDSLayer: game?.tilesWithPds?.size ?? 0,
    };
  }, [game?.tiles, game?.tilesWithPds]);
}
