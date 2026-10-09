import { Tooltip } from "@mantine/core";
import cx from "clsx";
import { displayName, usePlay } from "@/discord";
import classes from "./ConnectionBadge.module.css";

const LABELS = {
  idle: "Not connected",
  connecting: "Connecting",
  open: "Connected",
  reconnecting: "Reconnecting",
  closed: "Offline",
} as const;

/** Who I am and whether the live link (and the bot behind it) is up. */
export function ConnectionBadge() {
  const status = usePlay((s) => s.status);
  const me = usePlay((s) => s.me);
  const botOnline = usePlay((s) => s.botOnline);
  const healthy = status === "open" && botOnline;
  const botDown = status === "open" && !botOnline;
  const label = botDown ? "Connected · the bot is offline" : LABELS[status];

  return (
    <Tooltip label={label} position="bottom">
      <div className={classes.badge} role="status" aria-label={label}>
        <span
          className={cx(
            classes.dot,
            healthy && classes.ok,
            botDown && classes.warn,
          )}
        />
        {me && <span className={classes.name}>{displayName(me)}</span>}
      </div>
    </Tooltip>
  );
}
