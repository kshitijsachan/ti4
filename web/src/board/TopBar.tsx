import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Indicator, Tooltip, UnstyledButton } from "@mantine/core";
import {
  IconCards,
  IconListDetails,
  IconMessageCircle,
  IconTarget,
  IconTransfer,
} from "@tabler/icons-react";
import cx from "clsx";
import { ConnectionBadge } from "@/play/ConnectionBadge";
import type { TurnState } from "@/play/turn";
import { SettingsMenu } from "./SettingsMenu";
import classes from "./TopBar.module.css";

export type DrawerName = "log" | "talk" | "trade" | "raw" | "hand";

type DrawerButtonProps = {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
};

function BarButton({ icon, label, active, badge, onClick }: DrawerButtonProps) {
  return (
    <Tooltip label={label} position="bottom" openDelay={400}>
      <UnstyledButton
        className={cx(classes.button, active && classes.buttonActive)}
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
      >
        <Indicator
          disabled={!badge}
          label={badge}
          size={15}
          offset={2}
          color="red"
          classNames={{ indicator: classes.badge }}
        >
          {icon}
        </Indicator>
        <span className={classes.buttonLabel}>{label}</span>
      </UnstyledButton>
    </Tooltip>
  );
}

type Props = {
  gameName: string;
  round?: number;
  turn: TurnState;
  /** Seat colour of whoever the table is waiting on. */
  activeColor?: string;
  /** e.g. "You passed", shown under the turn when it isn't mine. */
  myNote?: string;
  objectivesLabel?: string;
  drawer: DrawerName | null;
  onDrawer: (name: DrawerName | null) => void;
  onObjectives?: () => void;
  talkUnread: number;
  incomingTrades: number;
  showHandButton: boolean;
};

/** The table's header: where we are in the game, whose move it is, and the few things you can open. */
export function TopBar({
  gameName,
  round,
  turn,
  activeColor,
  myNote,
  objectivesLabel,
  drawer,
  onDrawer,
  onObjectives,
  talkUnread,
  incomingTrades,
  showHandButton,
}: Props) {
  const toggle = (name: DrawerName) => onDrawer(drawer === name ? null : name);
  let turnText = "";
  if (turn.mine) turnText = "Your turn";
  else if (turn.waitingOn) turnText = `${turn.waitingOn}'s turn`;

  return (
    <header className={classes.bar}>
      <div className={classes.left}>
        <Link to="/play" className={classes.mark} aria-label="All games">
          TI4
        </Link>
        <span className={classes.game}>{gameName}</span>
      </div>

      <div className={classes.center}>
        <div className={classes.phase}>
          {round ? <span className={classes.round}>Round {round}</span> : null}
          {turn.phase && <span className={classes.phaseName}>{turn.phase}</span>}
        </div>
        {turnText && (
          <div
            className={cx(classes.turn, turn.mine && classes.turnMine)}
            style={activeColor ? ({ "--turn": activeColor } as CSSProperties) : undefined}
            role="status"
          >
            <span className={classes.turnDot} />
            {turnText}
          </div>
        )}
        {!turn.mine && myNote && <span className={classes.note}>{myNote}</span>}
      </div>

      <div className={classes.right}>
        {onObjectives && (
          <BarButton
            icon={<IconTarget size={18} />}
            label={objectivesLabel ?? "Objectives"}
            active={false}
            onClick={onObjectives}
          />
        )}
        {showHandButton && (
          <BarButton
            icon={<IconCards size={18} />}
            label="Hand"
            active={drawer === "hand"}
            onClick={() => toggle("hand")}
          />
        )}
        <BarButton
          icon={<IconListDetails size={18} />}
          label="Log"
          active={drawer === "log"}
          onClick={() => toggle("log")}
        />
        <BarButton
          icon={<IconMessageCircle size={18} />}
          label="Table talk"
          active={drawer === "talk"}
          badge={drawer === "talk" ? 0 : talkUnread}
          onClick={() => toggle("talk")}
        />
        <BarButton
          icon={<IconTransfer size={18} />}
          label="Trade"
          active={drawer === "trade"}
          badge={incomingTrades}
          onClick={() => toggle("trade")}
        />
        <SettingsMenu onRawChannels={() => onDrawer("raw")} />
        <ConnectionBadge />
      </div>
    </header>
  );
}
