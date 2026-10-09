import { usePlay } from "../client/PlayProvider";
import classes from "./ConnectionStatus.module.css";

const LABEL = {
  idle: "Offline",
  connecting: "Connecting",
  open: "Live",
  reconnecting: "Reconnecting",
  closed: "Offline",
} as const;

/** Small live/reconnecting indicator; reports the bot as offline separately from our own socket. */
export function ConnectionStatus() {
  const status = usePlay((s) => s.status);
  const botOnline = usePlay((s) => s.botOnline);
  const state = status === "open" && !botOnline ? "bot" : status;
  const label = state === "bot" ? "Bot offline" : LABEL[status];
  return (
    <span className={classes.status} data-state={state} role="status" title={label}>
      <i className={classes.dot} aria-hidden />
      {label}
    </span>
  );
}
