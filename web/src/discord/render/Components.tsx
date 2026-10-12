import { createContext, useContext, useState } from "react";
import { Loader } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";
import type { Attachment, Component, Snowflake } from "../types";
import { ComponentType } from "../types";
import { usePlayConnection } from "../client/PlayProvider";
import { usePendingKey } from "../client/hooks";
import { ComponentEmoji } from "./Emoji";
import { SelectControl } from "./SelectControl";
import classes from "./Components.module.css";

export type MessageTarget = {
  channelId: Snowflake;
  messageId: Snowflake;
  attachments: Attachment[];
};

/** Upstream's drag-to-move map ("Move on Map", BETA) is not part of this site; the bot's buttons do the same. */
const UNSUPPORTED_LINK = /asyncti4\.com\/game\/[^/?#]+\/newui\?[^#]*targetPositionId=/i;

export const MessageTargetContext = createContext<MessageTarget | null>(null);

export function useMessageTarget(): MessageTarget {
  const t = useContext(MessageTargetContext);
  if (!t) throw new Error("message components need a MessageTargetContext");
  return t;
}

const STYLE_CLASS: Record<number, string> = {
  1: classes.primary,
  2: classes.secondary,
  3: classes.success,
  4: classes.danger,
  5: classes.secondary,
};

/** Discord message button. Shows a spinner from click until the bot acknowledges. */
export function DiscordButton({ c }: { c: Component }) {
  const target = useMessageTarget();
  const conn = usePlayConnection();
  const pending = usePendingKey(`${target.messageId}:${c.custom_id ?? ""}`);
  if (c.style === 6) return null;
  if (c.style === 5 && c.url && UNSUPPORTED_LINK.test(c.url)) return null;
  const body = (
    <>
      {pending ? <Loader size={12} color="currentColor" className={classes.spinner} /> : <ComponentEmoji emoji={c.emoji} />}
      {c.label && <span className={classes.label}>{c.label}</span>}
      {c.style === 5 && <IconExternalLink size={12} className={classes.ext} />}
    </>
  );
  const cls = `${classes.button} ${STYLE_CLASS[c.style ?? 2] ?? classes.secondary}`;
  if (c.style === 5 && c.url) {
    if (c.disabled) return <span className={cls} aria-disabled>{body}</span>;
    return (
      <a className={cls} href={c.url} target="_blank" rel="noreferrer noopener">
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      disabled={c.disabled}
      data-pending={pending || undefined}
      aria-busy={pending}
      title={c.label ? undefined : (c.emoji?.name ?? undefined)}
      onClick={() => {
        if (pending || !c.custom_id) return;
        conn.click(target.channelId, target.messageId, c.custom_id);
      }}
    >
      {body}
    </button>
  );
}

function MessageSelect({ c }: { c: Component }) {
  const target = useMessageTarget();
  const conn = usePlayConnection();
  const pending = usePendingKey(`${target.messageId}:${c.custom_id ?? ""}`);
  const initial = c.options?.filter((o) => o.default).map((o) => o.value) ?? c.default_values?.map((d) => d.id) ?? [];
  const [value, setValue] = useState<string[]>(initial);
  return (
    <div className={classes.selectRow}>
      <SelectControl
        component={c}
        channelId={target.channelId}
        value={value}
        onChange={setValue}
        pending={pending}
        onCommit={(values) => {
          if (!c.custom_id) return;
          conn.select(target.channelId, target.messageId, c.custom_id, values, c.type);
        }}
      />
    </div>
  );
}

/** One component in a message's legacy component area (action rows of buttons or a select). */
export function ActionRow({ row }: { row: Component }) {
  const children = row.components ?? [];
  const select = children.find((c) => isSelect(c.type));
  if (select) return <MessageSelect c={select} />;
  return (
    <div className={classes.row}>
      {children.map((c, i) => (c.type === ComponentType.Button ? <DiscordButton key={c.custom_id ?? c.url ?? i} c={c} /> : null))}
    </div>
  );
}

export function isSelect(type: number) {
  return type === 3 || (type >= 5 && type <= 8);
}

export function ComponentRows({ rows }: { rows: Component[] }) {
  if (!rows.length) return null;
  return (
    <div className={classes.rows}>
      {rows.map((r, i) =>
        r.type === ComponentType.ActionRow ? <ActionRow key={i} row={r} /> : isSelect(r.type) ? <MessageSelect key={i} c={r} /> : null,
      )}
    </div>
  );
}
