import { MapTile } from "@/domains/map/components/MapTile";
import { PlayerStatsArea } from "@/domains/map/components/PlayerStatsArea";
import type { Tile } from "@/entities/game/types";
import type { PlayerData } from "@/entities/data/types";
import { computeControlOpenSides } from "@/entities/game/controlBorders";
import { memo, useMemo } from "react";
import { useSettingsStore } from "@/state/appStore";
import { useGameData } from "@/state/useGameContext";
import {
  HomeSystemLabels,
  homeLabelAnchors,
} from "@/domains/map/components/HomeSystemLabels";

type Props = {
  tiles: Tile[];
  playerData: PlayerData[] | undefined;
  statTilePositions: Record<string, string[]> | undefined;
  onUnitMouseOver: (
    faction: string,
    unitId: string,
    x: number,
    y: number,
  ) => void;
  onUnitMouseLeave: () => void;
  onUnitSelect: (faction: string) => void;
  onPlanetMouseEnter: (planetId: string, x: number, y: number) => void;
  onPlanetMouseLeave: () => void;
};

export const MapTilesRenderer = memo(function MapTilesRenderer({
  tiles,
  playerData,
  statTilePositions,
  onUnitMouseOver,
  onUnitMouseLeave,
  onUnitSelect,
  onPlanetMouseEnter,
  onPlanetMouseLeave,
}: Props) {
  const controlOpenSides = computeControlOpenSides(tiles);
  const showStats = useSettingsStore((s) => s.settings.showMapPlayerStats);
  const gameData = useGameData();
  const ringCount = gameData?.ringCount;
  const tilePositions = gameData?.tilePositions;
  const labelAnchors = useMemo(
    () =>
      showStats
        ? []
        : homeLabelAnchors(statTilePositions, tiles, ringCount, tilePositions),
    [showStats, statTilePositions, tiles, ringCount, tilePositions],
  );

  return (
    <>
      {!showStats && playerData && (
        <HomeSystemLabels anchors={labelAnchors} playerData={playerData} />
      )}
      {showStats &&
        playerData &&
        statTilePositions &&
        Object.entries(statTilePositions).map(([faction, statTiles]) => {
          const player = playerData.find((p) => p.faction === faction);
          if (!player) return null;

          return (
            <PlayerStatsArea
              key={faction}
              faction={faction}
              playerData={player}
              statTilePositions={statTiles}
            />
          );
        })}
      {tiles.map((tile, index) => (
        <MapTile
          key={`${tile.position}-${index}`}
          mapTile={tile}
          controlOpenSides={controlOpenSides[tile.position]}
          onUnitMouseOver={onUnitMouseOver}
          onUnitMouseLeave={onUnitMouseLeave}
          onUnitSelect={onUnitSelect}
          onPlanetMouseEnter={onPlanetMouseEnter}
          onPlanetMouseLeave={onPlanetMouseLeave}
        />
      ))}
    </>
  );
});
