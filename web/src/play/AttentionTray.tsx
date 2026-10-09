import { useEffect, useRef, useState } from "react";
import { Tooltip, UnstyledButton } from "@mantine/core";
import {
  IconBell,
  IconBellOff,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconX,
} from "@tabler/icons-react";
import cx from "clsx";
import { MessageBody, usePlayConnection } from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { shortTime } from "@/discord/shared/time";
import { useChannelJump } from "@/play/channelJump";
import type { AttentionItem } from "@/play/attention";
import type { TurnState } from "@/play/turn";
import { alertsEnabled, disableAlerts, enableAlerts } from "@/play/turn";
import classes from "./AttentionTray.module.css";

const REASONS: Record<AttentionItem["reason"], string> = {
  ephemeral: "only you",
  reply: "for you",
  mention: "pinged you",
  "follow-up": "for you",
  role: "everyone",
};

/** Scrolls the sidebar to a message once its channel is on screen, and flashes it. */
function revealMessage(messageId: string, tries = 12) {
  const el = document.getElementById(`msg-${messageId}`);
  if (!el) {
    if (tries > 0) window.setTimeout(() => revealMessage(messageId, tries - 1), 150);
    return;
  }
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.dataset.flash = "1";
  window.setTimeout(() => delete el.dataset.flash, 1400);
}

function Item({ item }: { item: AttentionItem }) {
  const conn = usePlayConnection();
  const jump = useChannelJump((s) => s.jump);
  const open = () => {
    jump(item.channelId);
    revealMessage(item.message.id);
  };
  return (
    <li className={classes.item}>
      <div className={classes.itemMeta}>
        <span className={classes.where}>{item.where}</span>
        <span className={classes.reason}>{REASONS[item.reason]}</span>
        <span className={classes.time}>{shortTime(item.message.timestamp)}</span>
        <span className={classes.grow} />
        <Tooltip label="Show in channel">
          <UnstyledButton className={classes.iconBtn} onClick={open} aria-label="Show in channel">
            <IconExternalLink size={13} />
          </UnstyledButton>
        </Tooltip>
        <Tooltip label="Hide this prompt">
          <UnstyledButton
            className={classes.iconBtn}
            onClick={() => conn.actions.dismissPrompt(item.message.id)}
            aria-label="Hide this prompt"
          >
            <IconX size={13} />
          </UnstyledButton>
        </Tooltip>
      </div>
      <div className={cx("ti4play", classes.body)}>
        <MessageBody m={item.message} />
      </div>
    </li>
  );
}

function AlertsToggle() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [on, setOn] = useState(alertsEnabled);
  if (!supported) return null;
  const toggle = async () => {
    if (on) {
      disableAlerts();
      setOn(false);
      return;
    }
    setOn(await enableAlerts());
  };
  const label = on
    ? "Alerts on: you get a notification when it is your turn"
    : "Notify me when it is my turn";
  return (
    <Tooltip label={label} position="top">
      <UnstyledButton
        className={cx(classes.iconBtn, on && classes.bellOn)}
        onClick={() => void toggle()}
        aria-label={label}
        aria-pressed={on}
      >
        {on ? <IconBell size={14} /> : <IconBellOff size={14} />}
      </UnstyledButton>
    </Tooltip>
  );
}

type Props = {
  items: AttentionItem[];
  turn: TurnState;
};

/**
 * Floating "needs you" tray over the board: whose turn it is, and every bot
 * prompt waiting on me with its live buttons, wherever the bot posted it
 * (action log, my hand thread, a combat thread, an only-you message).
 */
export function AttentionTray({ items, turn }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const count = items.length;
  const newest = items.reduce<string | undefined>(
    (max, it) =>
      !max || compareSnowflakes(it.message.id, max) > 0 ? it.message.id : max,
    undefined,
  );
  const lastNewest = useRef(newest);

  /* A new prompt reopens the tray. */
  useEffect(() => {
    if (newest && newest !== lastNewest.current) setCollapsed(false);
    lastNewest.current = newest;
  }, [newest]);

  const attention = turn.mine || count > 0;
  let headline = turn.waitingOn ? `Waiting on ${turn.waitingOn}` : "Nothing needs you";
  if (turn.mine) headline = "Your turn";
  else if (count) headline = count === 1 ? "1 prompt for you" : `${count} prompts for you`;
  let sub = turn.phase;
  if (turn.mine && !count) sub = `${turn.phase ?? ""} · your buttons are in the action log`;
  else if (!turn.mine && count && turn.waitingOn)
    sub = `Waiting on ${turn.waitingOn}${turn.phase ? ` · ${turn.phase}` : ""}`;
  const empty = !count;

  return (
    <section
      className={cx(classes.tray, attention && classes.hot, (collapsed || empty) && classes.compact)}
      aria-label="Needs your input"
    >
      <header className={classes.head}>
        <span className={cx(classes.dot, turn.mine && classes.dotLive, !turn.mine && count > 0 && classes.dotWarn)} />
        <div className={classes.titles}>
          <span className={classes.headline}>{headline}</span>
          {sub && <span className={classes.sub}>{sub}</span>}
        </div>
        <AlertsToggle />
        {!empty && (
          <UnstyledButton
            className={classes.iconBtn}
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Show prompts" : "Hide prompts"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
          </UnstyledButton>
        )}
      </header>
      {!collapsed && !empty && (
        <ul className={classes.list}>
          {items
            .slice()
            .reverse()
            .map((item) => (
              <Item key={item.message.id} item={item} />
            ))}
        </ul>
      )}
    </section>
  );
}
