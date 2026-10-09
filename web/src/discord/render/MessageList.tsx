import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader } from "@mantine/core";
import { IconArrowBackUp, IconArrowDown } from "@tabler/icons-react";
import type { Message, Snowflake } from "../types";
import { usePlay, usePlayConnection } from "../client/PlayProvider";
import { displayName, useChannelMessages } from "../client/hooks";
import { dayLabel, messageTime, shortTime } from "../shared/time";
import { MessageBody } from "./Message";
import classes from "./MessageList.module.css";

export type MessageListVariant = "cozy" | "log" | "hand";

type Props = {
  channelId: Snowflake;
  variant?: MessageListVariant;
  /** Hide messages for which this returns false (e.g. chatter in the action log). */
  filter?: (m: Message) => boolean;
  empty?: ReactNode;
};

const WINDOW = 80;
/** Most messages kept in the DOM; scrolling past this drops the far end so long logs stay fast. */
const MAX_RENDERED = 320;
const GROUP_GAP_MS = 7 * 60 * 1000;

type Group = { key: string; day?: string; messages: Message[] };

function groupKey(m: Message) {
  return `${m.author.id}|${m.ephemeral ? 1 : 0}|${m.interaction_metadata?.user?.id ?? ""}`;
}

function buildGroups(messages: Message[], variant: MessageListVariant): Group[] {
  const groups: Group[] = [];
  let prev: Message | undefined;
  for (const m of messages) {
    const day = prev && new Date(prev.timestamp).toDateString() === new Date(m.timestamp).toDateString() ? undefined : m.timestamp;
    const continues =
      prev &&
      !day &&
      variant !== "log" &&
      groupKey(prev) === groupKey(m) &&
      !m.referenced_message &&
      new Date(m.timestamp).getTime() - new Date(prev.timestamp).getTime() < GROUP_GAP_MS;
    if (continues) groups[groups.length - 1].messages.push(m);
    else groups.push({ key: m.id, day, messages: [m] });
    prev = m;
  }
  return groups;
}

function ReplyAction({ m }: { m: Message }) {
  const conn = usePlayConnection();
  return (
    <button
      type="button"
      className={classes.replyAction}
      onClick={() => conn.actions.setReply(m.channel_id, m)}
      aria-label="Reply"
      title="Reply"
    >
      <IconArrowBackUp size={14} />
    </button>
  );
}

function Monogram({ name, bot, me }: { name: string; bot?: boolean; me?: boolean }) {
  const letters = bot ? "TI4" : name.slice(0, 2).toUpperCase();
  return (
    <div className={classes.avatar} data-bot={bot || undefined} data-me={me || undefined} aria-hidden>
      {letters}
    </div>
  );
}

/** Groups are rebuilt on every list change; re-render one only when its own messages changed. */
function sameGroup(a: GroupProps, b: GroupProps) {
  if (a.variant !== b.variant || a.meId !== b.meId || a.group.day !== b.group.day) return false;
  const x = a.group.messages;
  const y = b.group.messages;
  return x.length === y.length && x.every((m, i) => m === y[i]);
}

type GroupProps = { group: Group; variant: MessageListVariant; meId?: string };

const GroupView = memo(function GroupView({ group, variant, meId }: GroupProps) {
  const first = group.messages[0];
  const author = usePlay((s) => s.users[first.author.id] ?? first.author);
  const forUser = first.interaction_metadata?.user;
  const name = displayName(author);
  const header = variant === "cozy";
  return (
    <>
      {group.day && variant !== "hand" && (
        <div className={classes.day} role="separator">
          <span>{dayLabel(group.day)}</span>
        </div>
      )}
      <div className={classes.group} data-variant={variant} data-ephemeral={first.ephemeral || undefined}>
        {group.messages.map((m, i) => (
          <div key={m.id} id={`msg-${m.id}`} data-mid={m.id} className={classes.message} data-ephemeral={m.ephemeral || undefined}>
            {variant === "cozy" && i === 0 && <Monogram name={name} bot={author.bot} me={author.id === meId} />}
            {variant !== "hand" && (i > 0 || variant === "log") && (
              <time className={classes.gutterTime} dateTime={m.timestamp} title={new Date(m.timestamp).toLocaleString()}>
                {shortTime(m.timestamp)}
              </time>
            )}
            <div className={classes.main}>
              {header && i === 0 && (
                <div className={classes.header}>
                  <span className={classes.author} data-me={author.id === meId || undefined}>
                    {name}
                  </span>
                  {author.bot && <span className={classes.botTag}>BOT</span>}
                  {forUser && <span className={classes.forUser}>for {forUser.id === meId ? "you" : displayName(forUser)}</span>}
                  <time className={classes.time} dateTime={m.timestamp} title={new Date(m.timestamp).toLocaleString()}>
                    {messageTime(m.timestamp)}
                  </time>
                </div>
              )}
              {variant === "log" && (!author.bot || (forUser && i === 0)) && (
                <div className={classes.logAuthor}>
                  {!author.bot && <span className={classes.author}>{name}</span>}
                  {author.bot && forUser && <span className={classes.forUser}>for {forUser.id === meId ? "you" : displayName(forUser)}</span>}
                </div>
              )}
              <MessageBody m={m} />
              {variant === "cozy" && !m.ephemeral && <ReplyAction m={m} />}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}, sameGroup);

/**
 * Scrolling message list. Renders a window of the newest messages and grows it (then pages history from
 * the server) as the reader scrolls up; sticks to the bottom while the reader is there.
 */
export function MessageList({ channelId, variant = "cozy", filter, empty }: Props) {
  const conn = usePlayConnection();
  const data = useChannelMessages(channelId);
  const meId = usePlay((s) => s.me?.id);
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [startId, setStartId] = useState<Snowflake | null>(null);
  /** Last rendered message, or null while the window is pinned to the live tail. */
  const [endId, setEndId] = useState<Snowflake | null>(null);
  /** The message at the top of the viewport and its offset, re-pinned whenever content above it changes. */
  const anchor = useRef<{ id: string; offset: number } | null>(null);

  const allIds = data.ids;
  const endIdx = endId ? allIds.indexOf(endId) : -1;
  const end = endIdx >= 0 ? endIdx + 1 : allIds.length;
  const start = startId ? Math.max(0, Math.min(allIds.indexOf(startId), end - 1)) : Math.max(0, end - WINDOW);
  const messages = useMemo(() => {
    const list = allIds.slice(start, end).map((id) => data.byId[id]).filter(Boolean);
    return filter ? list.filter(filter) : list;
  }, [data.byId, allIds, start, end, filter]);
  const groups = useMemo(() => buildGroups(messages, variant), [messages, variant]);

  useEffect(() => {
    setStartId(null);
    setEndId(null);
    stick.current = true;
    setAtBottom(true);
  }, [channelId]);

  const extendUp = useCallback(() => {
    if (start > 0) {
      const nextStart = Math.max(0, start - WINDOW);
      setStartId(allIds[nextStart]);
      if (end - nextStart > MAX_RENDERED) setEndId(allIds[nextStart + MAX_RENDERED - 1]);
      return;
    }
    if (data.hasMore && !data.loading && data.loaded) conn.loadHistory(channelId);
  }, [start, end, allIds, data.hasMore, data.loading, data.loaded, conn, channelId]);

  const extendDown = useCallback(() => {
    if (end >= allIds.length) return;
    const nextEnd = Math.min(allIds.length, end + WINDOW);
    setEndId(nextEnd >= allIds.length ? null : allIds[nextEnd - 1]);
    if (nextEnd - start > MAX_RENDERED) setStartId(allIds[nextEnd - MAX_RENDERED]);
  }, [start, end, allIds]);

  const captureAnchor = () => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop;
    const nodes = el.querySelectorAll<HTMLElement>("[data-mid]");
    for (const n of nodes) {
      if (n.offsetTop + n.offsetHeight <= top) continue;
      anchor.current = { id: n.dataset.mid ?? "", offset: n.offsetTop - top };
      return;
    }
  };

  /** Follow the bottom when the reader is there; otherwise keep the anchored message where it was. */
  const restore = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const a = anchor.current;
    const node = a ? el.querySelector<HTMLElement>(`[data-mid="${a.id}"]`) : null;
    if (a && node) el.scrollTop = node.offsetTop - a.offset;
  }, []);

  useLayoutEffect(restore, [messages, restore]);

  useEffect(() => {
    const content = inner.current;
    if (!content) return;
    const ro = new ResizeObserver(restore);
    ro.observe(content);
    return () => ro.disconnect();
  }, [restore]);

  // A page just landed while the reader sits at the top: show it.
  useEffect(() => {
    const el = scroller.current;
    if (el && !stick.current && el.scrollTop < 200 && start > 0) extendUp();
  }, [allIds.length, start, extendUp]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = distance < 48 && end >= allIds.length;
    if (stick.current !== bottom) {
      stick.current = bottom;
      setAtBottom(bottom);
      if (!bottom && !startId) setStartId(allIds[start] ?? null);
    }
    captureAnchor();
    if (el.scrollTop < 200) extendUp();
    else if (distance < 200) extendDown();
  };

  const jumpToLatest = () => {
    stick.current = true;
    setAtBottom(true);
    setStartId(null);
    setEndId(null);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const showLoader = data.loading && (start === 0 || !data.loaded);
  const beginning = data.loaded && !data.hasMore && start === 0;

  return (
    <div className={classes.wrap}>
      <div ref={scroller} className={classes.scroller} onScroll={onScroll} data-variant={variant}>
        <div ref={inner} className={classes.inner}>
          {showLoader && (
            <div className={classes.loading}>
              <Loader size="xs" color="gray" type="dots" />
            </div>
          )}
          {beginning && variant !== "hand" && messages.length > 0 && <div className={classes.beginning}>Beginning of channel</div>}
          {data.loaded && messages.length === 0 && (empty ?? <div className={classes.empty}>No messages yet.</div>)}
          {groups.map((g) => (
            <GroupView key={g.key} group={g} variant={variant} meId={meId} />
          ))}
        </div>
      </div>
      {!atBottom && (
        <button type="button" className={classes.jump} onClick={jumpToLatest}>
          Jump to latest <IconArrowDown size={13} />
        </button>
      )}
    </div>
  );
}
