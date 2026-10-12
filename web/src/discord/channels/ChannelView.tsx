import type { ReactNode } from "react";
import { IconHash, IconMessages } from "@tabler/icons-react";
import type { Message, Snowflake } from "../types";
import { usePlay } from "../client/PlayProvider";
import { useViewingChannel } from "../client/hooks";
import { MessageList, type MessageListVariant } from "../render/MessageList";
import { Composer } from "../composer/Composer";
import { ConnectionStatus } from "./ConnectionStatus";
import classes from "./ChannelView.module.css";

export type ChannelViewProps = {
  channelId: Snowflake | null | undefined;
  /** Show the channel title bar. Default true. */
  header?: boolean;
  /** Extra controls rendered at the right of the title bar. */
  headerExtra?: ReactNode;
  /** Show the chat / slash-command composer. Default true. */
  composer?: boolean;
  composerPlaceholder?: string;
  variant?: MessageListVariant;
  filter?: (m: Message) => boolean;
  empty?: ReactNode;
  className?: string;
};

/** One channel: title bar, scrolling message list and composer. */
export function ChannelView({
  channelId,
  header = true,
  headerExtra,
  composer = true,
  composerPlaceholder,
  variant = "cozy",
  filter,
  empty,
  className,
}: ChannelViewProps) {
  const channel = usePlay((s) => (channelId ? s.channels[channelId] : undefined));
  const parent = usePlay((s) => (channel?.parent_id ? s.channels[channel.parent_id] : undefined));
  useViewingChannel(channelId);

  if (!channelId || !channel) {
    return (
      <section className={`ti4play ${classes.view} ${className ?? ""}`}>
        <div className={classes.placeholder}>{channelId ? "Channel unavailable." : "Pick a channel."}</div>
      </section>
    );
  }
  const thread = channel.type === 10 || channel.type === 11 || channel.type === 12;
  return (
    <section className={`ti4play ${classes.view} ${className ?? ""}`} aria-label={channel.name}>
      {header && (
        <header className={classes.header}>
          {thread ? <IconMessages size={15} className={classes.headIcon} /> : <IconHash size={16} className={classes.headIcon} />}
          {thread && parent && <span className={classes.parent}>{parent.name} ›</span>}
          <h2 className={classes.title}>{channel.name}</h2>
          {channel.topic && <span className={classes.topic}>{channel.topic}</span>}
          <span className={classes.spacer} />
          {headerExtra}
          <ConnectionStatus />
        </header>
      )}
      <MessageList key={channelId} channelId={channelId} variant={variant} filter={filter} empty={empty} />
      {composer && <Composer channelId={channelId} placeholder={composerPlaceholder} />}
    </section>
  );
}
