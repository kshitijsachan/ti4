import { Tooltip } from "@mantine/core";
import cx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import classes from "../Trade.module.css";

type Props = {
  name: string;
  text?: string | null;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  disabledReason?: string;
  /** Player color the chip is keyed to (PN owner). */
  ownerColor?: string | null;
  accent?: string;
  icon?: ReactNode;
};

/** A toggleable card chip (promissory note, action card, relic). Hover shows the card text. */
export function CardChip({
  name,
  text,
  selected,
  onToggle,
  disabled,
  disabledReason,
  ownerColor,
  accent,
  icon,
}: Props) {
  const chipAccent = ownerColor ? getPrimaryColorCSS(ownerColor) : accent;
  const tip = disabled && disabledReason ? disabledReason : text;
  const chip = (
    <button
      type="button"
      className={cx(classes.chip, selected && classes.chipOn)}
      style={chipAccent ? ({ "--chip-accent": chipAccent } as CSSProperties) : undefined}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
    >
      {icon}
      <span className={classes.chipName}>{name}</span>
      {selected && <span className={classes.chipCheck}>✓</span>}
    </button>
  );
  if (!tip) return chip;
  return (
    <Tooltip
      label={tip}
      multiline
      w={280}
      openDelay={350}
      withinPortal
      styles={{ tooltip: { fontSize: 12, lineHeight: 1.45 } }}
    >
      {chip}
    </Tooltip>
  );
}
