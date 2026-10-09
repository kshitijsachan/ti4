import { memo, useMemo } from "react";
import { IconCornerUpRight, IconEyeOff } from "@tabler/icons-react";
import type { Message as MessageT } from "../types";
import { MessageFlags } from "../types";
import { usePlay, usePlayConnection } from "../client/PlayProvider";
import { displayName } from "../client/hooks";
import { Markdown } from "./Markdown";
import { Embed } from "./Embed";
import { Attachments, ZoomImage } from "./Media";
import { ComponentRows, MessageTargetContext, type MessageTarget } from "./Components";
import { ComponentsV2 } from "./ComponentsV2";
import { toPlainText } from "./markdownParser";
import classes from "./Message.module.css";

/** A message that is nothing but an image link unfurls into the image, as Discord does. */
const IMAGE_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i;

export function isV2(m: MessageT) {
  return ((m.flags ?? 0) & MessageFlags.ComponentsV2) !== 0;
}

export function isLoading(m: MessageT) {
  return ((m.flags ?? 0) & MessageFlags.Loading) !== 0;
}

function ReplyPreview({ m }: { m: MessageT }) {
  const ref = m.referenced_message;
  if (!ref) return null;
  const jump = () => {
    const el = document.getElementById(`msg-${ref.id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.dataset.flash = "1";
    window.setTimeout(() => delete el.dataset.flash, 1200);
  };
  const firstLine = ref.content.split("\n").find((l) => l.trim()) ?? "";
  const snippet = toPlainText(firstLine) ? firstLine.replace(/^[#>\-\s]+/, "") : ref.attachments?.length ? "Attachment" : ref.embeds?.length ? "Embed" : "…";
  return (
    <button type="button" className={classes.reply} onClick={jump}>
      <IconCornerUpRight size={12} className={classes.replyIcon} />
      <span className={classes.replyAuthor}>{displayName(ref.author)}</span>
      <span className={classes.replyText}>
        <Markdown inline content={snippet} />
      </span>
    </button>
  );
}

function Thinking({ name }: { name: string }) {
  return (
    <div className={classes.thinking} role="status">
      <span className={classes.dots} aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {name} is thinking…
    </div>
  );
}

function EphemeralFooter({ m }: { m: MessageT }) {
  const conn = usePlayConnection();
  return (
    <div className={classes.ephemeral}>
      <IconEyeOff size={12} />
      <span>Only you can see this</span>
      <span className={classes.sep}>·</span>
      <button type="button" className={classes.dismiss} onClick={() => conn.dismiss(m.channel_id, m.id)}>
        Dismiss
      </button>
    </div>
  );
}

type BodyProps = { m: MessageT };

/** Everything inside one message: reply preview, content, V2 layout, attachments, embeds, components. */
export const MessageBody = memo(function MessageBody({ m }: BodyProps) {
  const botName = usePlay((s) => displayName(s.users[m.author.id] ?? m.author));
  const target = useMemo<MessageTarget>(
    () => ({ channelId: m.channel_id, messageId: m.id, attachments: m.attachments ?? [] }),
    [m.channel_id, m.id, m.attachments],
  );
  const v2 = isV2(m);
  const imageUrl = !v2 && IMAGE_URL.test(m.content.trim()) ? m.content.trim() : null;
  const empty =
    !m.content && !m.attachments?.length && !m.embeds?.length && !m.components?.length && !isLoading(m);
  return (
    <MessageTargetContext.Provider value={target}>
      <ReplyPreview m={m} />
      {isLoading(m) && <Thinking name={botName} />}
      {imageUrl && <ZoomImage src={imageUrl} alt={imageUrl.split("/").pop() ?? "image"} maxWidth={420} maxHeight={300} />}
      {!v2 && !imageUrl && m.content && (
        <div className={classes.content}>
          <Markdown content={m.content} />
          {m.edited_timestamp && <span className={classes.edited}>(edited)</span>}
        </div>
      )}
      {empty && <div className={classes.emptyBody}>(empty message)</div>}
      {v2 && <ComponentsV2 components={m.components ?? []} />}
      <Attachments attachments={v2 ? [] : (m.attachments ?? [])} />
      {m.embeds?.map((e, i) => <Embed key={i} embed={e} />)}
      {!v2 && m.components && <ComponentRows rows={m.components} />}
      {m.ephemeral && <EphemeralFooter m={m} />}
    </MessageTargetContext.Provider>
  );
});
