import { UnitDetailsCard } from "@/domains/cards/components/UnitDetailsCard";
import { lookupUnit } from "@/entities/lookup/units";
import { useGameData } from "@/state/useGameContext";
import { type MapLayout } from "@/domains/map/components/mapLayout";
import { MapTooltipPositioner, useLingeringHover } from "@/domains/map/components/MapTooltipPositioner";
import type { TooltipUnit } from "@/hooks/useTabsAndTooltips";

type Props = {
  tooltipUnit: TooltipUnit | null;
  mapPadding?: number;
  mapZoom?: number;
  mapLayout?: MapLayout;
};

export function MapUnitDetailsCard({
  tooltipUnit: hovered,
  mapPadding,
  mapZoom,
  mapLayout = "panels",
}: Props) {
  const gameData = useGameData();
  const { shown: tooltipUnit, onCardEnter, onCardLeave } = useLingeringHover(hovered);
  if (!tooltipUnit || !tooltipUnit.unitId || !tooltipUnit.faction) return null;
  const playerData = gameData?.playerData;

  const activePlayer = playerData?.find(
    (player) => player.faction === tooltipUnit.faction
  );

  const lookupFaction = activePlayer?.faction || tooltipUnit.faction;
  const unitIdToUse =
    lookupUnit(tooltipUnit.unitId, lookupFaction, activePlayer)?.id ||
    tooltipUnit.unitId;

  return (
    <MapTooltipPositioner
      coords={tooltipUnit.coords}
      mapPadding={mapPadding}
      mapZoom={mapZoom}
      mapLayout={mapLayout}
      zIndexVar="var(--z-map-unit-details)"
      kind="unit"
      onCardEnter={onCardEnter}
      onCardLeave={onCardLeave}
    >
      <UnitDetailsCard unitId={unitIdToUse} color={activePlayer?.color} />
    </MapTooltipPositioner>
  );
}
