import type { ReactNode } from "react";
import { HoverCard, Loader } from "@mantine/core";
import { UnitCard } from "./UnitCard";
import { useUnitInfo } from "./useUnitInfo";
import styles from "./FactionSheet.module.css";

type InfoProps = {
  unitId: string;
  faction?: string;
  /** The player's `unitsOwned`, so an upgraded unit shows its upgraded card. */
  owned?: string[];
  color?: string;
  /** Also show the not-yet-researched upgrade side. */
  showUpgrade?: boolean;
};

/** The unit's card (stats, keywords, ability text), sized for a tooltip. */
export function UnitInfoCard({ unitId, faction, owned, color, showUpgrade = true }: InfoProps) {
  const info = useUnitInfo(unitId, faction, owned);
  if (!info) return <Loader size="xs" />;
  return (
    <div className={`${styles.sheet} ${styles.tooltip}`}>
      <UnitCard
        unit={info.unit}
        upgrade={showUpgrade ? info.upgrade : undefined}
        upgradeTech={info.upgradeTech}
        color={color}
      />
    </div>
  );
}

type Props = InfoProps & { children: ReactNode; openDelay?: number; position?: "top" | "bottom" | "left" | "right" };

/** Hover a unit (map token, unit chip…) to see its stats and abilities. */
export function UnitTooltip({ children, openDelay = 250, position = "top", ...info }: Props) {
  return (
    <HoverCard openDelay={openDelay} closeDelay={80} position={position} withinPortal shadow="md" classNames={{ dropdown: styles.tooltipDropdown }} zIndex="calc(var(--z-app-modal) + 20)">
      <HoverCard.Target>{children}</HoverCard.Target>
      <HoverCard.Dropdown>
        <UnitInfoCard {...info} />
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
