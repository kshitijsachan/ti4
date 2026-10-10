import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Tooltip, UnstyledButton } from "@mantine/core";
import { IconListDetails, IconMessageCircle, IconTarget, IconTransfer, IconUsers } from "@tabler/icons-react";
import cx from "clsx";
import { usePlay } from "@/discord";
import { UndoButton } from "@/rollback";
import type { TurnState } from "@/play/turn";
import { SettingsMenu } from "./SettingsMenu";
import classes from "./TopBar.module.css";

export type DrawerName = "log" | "talk" | "trade" | "raw";

type BarButtonProps = {
  icon: ReactNode;
  label: string;
  /** Tooltip; defaults to the label. */
  tip?: string;
  active: boolean;
  /** Something here needs you: a small dot, no number. */
  attention?: boolean;
  onClick: () => void;
};

function BarButton({ icon, label, tip, active, attention, onClick }: BarButtonProps) {
  return (
    <Tooltip label={tip ?? label} position="bottom" openDelay={300}>
      <UnstyledButton
        className={cx(classes.button, active && classes.buttonActive)}
        onClick={onClick}
        aria-pressed={active}
        aria-label={tip ?? label}
      >
        <span className={classes.iconWrap}>
          {icon}
          {attention && <span className={classes.dot} />}
        </span>
        <span className={classes.buttonLabel}>{label}</span>
      </UnstyledButton>
    </Tooltip>
  );
}

const LINK_LABELS = {
  idle: "Not connected",
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  closed: "Offline",
} as const;

/** Only speaks up when the live link (or the game server behind it) is down. */
function LinkWarning() {
  const status = usePlay((s) => s.status);
  const botOnline = usePlay((s) => s.botOnline);
  const fine = status === "open" && botOnline;
  /* The link reconnects by itself within seconds (server restarts): only speak up if it stays down. */
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (fine) return setLate(false);
    const timer = window.setTimeout(() => setLate(true), 5000);
    return () => window.clearTimeout(timer);
  }, [fine]);
  if (fine || !late) return null;
  const label = status === "open" ? "Game server is starting up or offline" : LINK_LABELS[status];
  return (
    <Tooltip label={label} position="bottom">
      <span className={classes.link} role="status" aria-label={label}>
        <span className={classes.linkDot} />
        <span className={classes.linkText}>{status === "open" ? "Server offline" : LINK_LABELS[status]}</span>
      </span>
    </Tooltip>
  );
}

type Props = {
  gameName: string;
  round?: number;
  turn: TurnState;
  /** Seat colour of whoever the table is waiting on. */
  activeColor?: string;
  /** e.g. "You passed", shown after the turn when it isn't mine. */
  myNote?: string;
  /** Revealed public objectives, for the tooltip. */
  objectives?: number;
  drawer: DrawerName | null;
  onDrawer: (name: DrawerName | null) => void;
  onObjectives?: () => void;
  /** All players' boards side by side. */
  onPlayers?: () => void;
  talkUnread: number;
  incomingTrades: number;
};

/** The table's header, one quiet line: which game, where we are in it, whose move it is, and a few icons. */
export function TopBar({
  gameName,
  round,
  turn,
  activeColor,
  myNote,
  objectives,
  drawer,
  onDrawer,
  onObjectives,
  onPlayers,
  talkUnread,
  incomingTrades,
}: Props) {
  const toggle = (name: DrawerName) => onDrawer(drawer === name ? null : name);
  let turnText = "";
  if (turn.mine) turnText = "Your turn";
  else if (turn.waitingOn) turnText = `${turn.waitingOn}'s turn`;
  const where = [round ? `Round ${round}` : null, turn.phase].filter(Boolean).join(" · ");

  return (
    <header className={classes.bar}>
      <div className={classes.left}>
        <Link to="/play" className={classes.mark} aria-label="All games">
          TI4
        </Link>
        <span className={classes.game}>{gameName}</span>
      </div>

      <div className={classes.center}>
        {where && <span className={classes.where}>{where}</span>}
        {turnText && (
          <span
            className={cx(classes.turn, turn.mine && classes.turnMine)}
            style={activeColor ? ({ "--turn": activeColor } as CSSProperties) : undefined}
            role="status"
          >
            <span className={classes.turnDot} />
            <span className={classes.turnText}>{turnText}</span>
          </span>
        )}
        {!turn.mine && myNote && <span className={classes.note}>{myNote}</span>}
      </div>

      <div className={classes.right}>
        <LinkWarning />
        {onObjectives && (
          <BarButton
            icon={<IconTarget size={18} stroke={1.6} />}
            label="Objectives"
            tip={objectives ? `Objectives · ${objectives} revealed` : "Objectives"}
            active={false}
            onClick={onObjectives}
          />
        )}
        {onPlayers && (
          <BarButton
            icon={<IconUsers size={18} stroke={1.6} />}
            label="Players"
            tip="Players · all boards side by side"
            active={false}
            onClick={onPlayers}
          />
        )}
        <BarButton
          icon={<IconListDetails size={18} stroke={1.6} />}
          label="Log"
          tip="Game log"
          active={drawer === "log"}
          onClick={() => toggle("log")}
        />
        <BarButton
          icon={<IconMessageCircle size={18} stroke={1.6} />}
          label="Chat"
          tip={talkUnread && drawer !== "talk" ? `Table talk · ${talkUnread} unread` : "Table talk"}
          active={drawer === "talk"}
          attention={drawer !== "talk" && talkUnread > 0}
          onClick={() => toggle("talk")}
        />
        <BarButton
          icon={<IconTransfer size={18} stroke={1.6} />}
          label="Trade"
          tip={incomingTrades ? `Trade · ${incomingTrades} offer${incomingTrades > 1 ? "s" : ""} for you` : "Trade"}
          active={drawer === "trade"}
          attention={incomingTrades > 0}
          onClick={() => toggle("trade")}
        />
        <span className={classes.sep} />
        <UndoButton gameName={gameName} onOpenHistory={() => onDrawer("log")} className={classes.undo} />
        <SettingsMenu onRawChannels={() => onDrawer("raw")} />
      </div>
    </header>
  );
}
