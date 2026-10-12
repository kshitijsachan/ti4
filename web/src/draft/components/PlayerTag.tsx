import cx from "clsx";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import type { DraftPlayer, DraftState } from "../types";
import classes from "../Draft.module.css";

/** Seat-independent player identity colour: the game colour once chosen, else a fixed per-draft-position hue. */
export function playerAccent(player: DraftPlayer) {
  if (player.color) {
    const css = getPrimaryColorCSS(player.color);
    if (css) return css;
  }
  return `var(--draft-seat-${((player.draftPosition - 1) % 8) + 1})`;
}

type Props = {
  player: DraftPlayer;
  draft: DraftState;
  compact?: boolean;
  className?: string;
};

export function PlayerTag({ player, draft, compact, className }: Props) {
  const faction = draft.factions.find((f) => f.alias === player.faction);
  return (
    <span
      className={cx(
        classes.playerTag,
        compact && classes.playerTagCompact,
        className,
      )}
      style={{ ["--player-accent" as string]: playerAccent(player) }}
      title={player.name}
    >
      {faction?.icon ? (
        <img src={faction.icon} alt="" className={classes.playerTagIcon} />
      ) : (
        <span className={classes.playerTagDot} />
      )}
      <span className={classes.playerTagName}>{player.name}</span>
    </span>
  );
}
