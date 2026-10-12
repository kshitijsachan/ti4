import { memo, useMemo, useState, type ReactNode } from "react";
import { Tooltip } from "@mantine/core";
import { usePlay, usePlayNavigate } from "../client/PlayProvider";
import { displayName } from "../client/hooks";
import { parseInline, parseMarkdown, type Block, type Inline } from "./markdownParser";
import { Emoji } from "./Emoji";
import { formatTimestamp } from "../shared/time";
import classes from "./Markdown.module.css";

type Props = {
  content: string;
  /** Inline-only rendering (button labels, embed titles, field names): no block structure. */
  inline?: boolean;
  className?: string;
};

/** Discord-flavoured markdown. Parsing is memoised per content string. */
export const Markdown = memo(function Markdown({ content, inline, className }: Props) {
  const blocks = useMemo(() => (inline ? null : parseMarkdown(content)), [content, inline]);
  const inlines = useMemo(() => (inline ? parseInline(content) : null), [content, inline]);
  const jumbo = useMemo(() => !inline && isEmojiOnly(content), [content, inline]);
  if (inlines) return <span className={className}>{renderInlines(inlines)}</span>;
  return (
    <div className={[classes.md, jumbo ? classes.jumbo : "", className ?? ""].join(" ")}>
      {blocks!.map((b, i) => renderBlock(b, i))}
    </div>
  );
});

function isEmojiOnly(s: string): boolean {
  const stripped = s.replace(/<a?:\w+:\d+>/g, "").trim();
  const count = (s.match(/<a?:\w+:\d+>/g) ?? []).length;
  return stripped === "" && count > 0 && count <= 10;
}

function renderBlock(b: Block, key: number): ReactNode {
  switch (b.k) {
    case "p":
      return (
        <p key={key} className={classes.p}>
          {renderInlines(b.c)}
        </p>
      );
    case "h": {
      const cls = b.level === 1 ? classes.h1 : b.level === 2 ? classes.h2 : classes.h3;
      return (
        <div key={key} className={cls} role="heading" aria-level={b.level + 2}>
          {renderInlines(b.c)}
        </div>
      );
    }
    case "sub":
      return (
        <div key={key} className={classes.sub}>
          {renderInlines(b.c)}
        </div>
      );
    case "quote":
      return (
        <blockquote key={key} className={classes.quote}>
          {b.c.map((x, i) => renderBlock(x, i))}
        </blockquote>
      );
    case "codeblock":
      return (
        <pre key={key} className={classes.pre}>
          <code>{b.v}</code>
        </pre>
      );
    case "list": {
      const items = b.items.map((item, i) => <li key={i}>{item.map((x, j) => renderBlock(x, j))}</li>);
      if (b.ordered)
        return (
          <ol key={key} className={classes.list} start={b.start}>
            {items}
          </ol>
        );
      return (
        <ul key={key} className={classes.list}>
          {items}
        </ul>
      );
    }
  }
}

function renderInlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => renderInline(n, i));
}

function renderInline(n: Inline, key: number): ReactNode {
  switch (n.k) {
    case "text":
      return n.v;
    case "br":
      return <br key={key} />;
    case "strong":
      return <strong key={key}>{renderInlines(n.c)}</strong>;
    case "em":
      return <em key={key}>{renderInlines(n.c)}</em>;
    case "u":
      return <u key={key}>{renderInlines(n.c)}</u>;
    case "s":
      return <s key={key}>{renderInlines(n.c)}</s>;
    case "spoiler":
      return <Spoiler key={key}>{renderInlines(n.c)}</Spoiler>;
    case "code":
      return (
        <code key={key} className={classes.code}>
          {n.v}
        </code>
      );
    case "link":
      return <Link key={key} href={n.href}>{renderInlines(n.c)}</Link>;
    case "user":
      return <UserMention key={key} id={n.id} />;
    case "role":
      return <RoleMention key={key} id={n.id} />;
    case "channel":
      return <ChannelMention key={key} id={n.id} />;
    case "everyone":
      return (
        <span key={key} className={classes.mention}>
          {n.v}
        </span>
      );
    case "slash":
      return (
        <span key={key} className={classes.mention}>
          /{n.name}
        </span>
      );
    case "emoji":
      return <Emoji key={key} id={n.id} name={n.name} animated={n.animated} />;
    case "time":
      return <Timestamp key={key} unix={n.unix} fmt={n.fmt} />;
  }
}

const DISCORD_CHANNEL_LINK = /^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(?:\d+|@me)\/(\d+)(?:\/(\d+))?/;

/** Discord channel/message links become in-app channel jumps; other Discord links render as plain text. */
function Link({ href, children }: { href: string; children: ReactNode }) {
  const jump = DISCORD_CHANNEL_LINK.exec(href);
  if (jump) return <ChannelMention id={jump[1]} />;
  if (/^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\//.test(href)) {
    return <span className={classes.deadLink}>{children}</span>;
  }
  return (
    <a className={classes.link} href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={open ? classes.spoilerOpen : classes.spoiler}
      role="button"
      tabIndex={open ? -1 : 0}
      aria-label={open ? undefined : "Spoiler, click to reveal"}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(true)}
    >
      <span className={classes.spoilerInner}>{children}</span>
    </span>
  );
}

function UserMention({ id }: { id: string }) {
  const user = usePlay((s) => s.users[id]);
  const isMe = usePlay((s) => s.me?.id === id);
  return <span className={isMe ? classes.mentionMe : classes.mention}>@{displayName(user)}</span>;
}

function RoleMention({ id }: { id: string }) {
  const role = usePlay((s) => s.roles[id]);
  const mine = usePlay((s) => (s.me ? (s.users[s.me.id]?.roles ?? []).includes(id) : false));
  return <span className={mine ? classes.mentionMe : classes.mention}>@{role?.name ?? "role"}</span>;
}

function ChannelMention({ id }: { id: string }) {
  const channel = usePlay((s) => s.channels[id]);
  const navigate = usePlayNavigate();
  if (!channel) return <span className={classes.mentionMuted}>#unknown</span>;
  return (
    <button type="button" className={classes.mentionButton} onClick={() => navigate(id)}>
      #{channel.name}
    </button>
  );
}

function Timestamp({ unix, fmt }: { unix: number; fmt: string }) {
  const date = new Date(unix * 1000);
  return (
    <Tooltip label={formatTimestamp(date, "F")} withArrow openDelay={300}>
      <time className={classes.time} dateTime={date.toISOString()}>
        {formatTimestamp(date, fmt)}
      </time>
    </Tooltip>
  );
}
