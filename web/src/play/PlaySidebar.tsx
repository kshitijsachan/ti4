import { useState, type ReactNode } from "react";
import { UnstyledButton } from "@mantine/core";
import {
  IconArrowLeft,
  IconCards,
  IconChevronsRight,
  IconMessage,
  IconMessages,
  IconSubtask,
} from "@tabler/icons-react";
import cx from "clsx";
import {
  ActionLog,
  ChannelList,
  ChannelView,
  HandPanel,
  usePlay,
} from "@/discord";
import { findGame, type GameChannels } from "@/play/games";
import { useResizableWidth } from "@/play/useResizableWidth";
import classes from "./PlaySidebar.module.css";

type TabValue = "actions" | "talk" | "hand" | "threads";

type Props = {
  gameName: string;
  /** During setup the action channel is the main view, so it leaves the sidebar. */
  actionsInMain: boolean;
  open: boolean;
  onClose: () => void;
};

function Empty({ children }: { children: ReactNode }) {
  return <div className={classes.empty}>{children}</div>;
}

function Threads({ game }: { game: GameChannels }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = game.threads.find((t) => t.id === openId);

  if (open) {
    return (
      <div className={classes.thread}>
        <UnstyledButton
          className={classes.back}
          onClick={() => setOpenId(null)}
        >
          <IconArrowLeft size={14} />
          <span className={classes.threadName}>All threads</span>
        </UnstyledButton>
        <div className={classes.fill}>
          <ChannelView key={open.id} channelId={open.id} />
        </div>
      </div>
    );
  }

  if (!game.threads.length) return <Empty>No open threads.</Empty>;

  return (
    <div className={classes.fill}>
      <ChannelList
        gameName={game.name}
        onSelect={setOpenId}
        className={classes.list}
      />
    </div>
  );
}

/**
 * The play side of the game screen: action log, table talk, the player's hand
 * and any side threads, next to the board.
 */
export function PlaySidebar({ gameName, actionsInMain, open, onClose }: Props) {
  const channels = usePlay((s) => s.channels);
  const status = usePlay((s) => s.status);
  const game = findGame(channels, gameName);
  const { width, handleProps, dragging } = useResizableWidth();
  const [chosen, setChosen] = useState<TabValue>("actions");
  const unread = usePlay((s) => s.unread);
  const mentions = usePlay((s) => s.mentions);
  const unreadIn = (ids: (string | undefined)[]) =>
    ids.reduce((sum, id) => sum + (id ? (unread[id] ?? 0) : 0), 0);
  const mentionedIn = (ids: (string | undefined)[]) =>
    ids.some((id) => id && mentions[id]);
  const threadIds = game?.threads.map((t) => t.id) ?? [];

  const tabs: {
    value: TabValue;
    label: string;
    icon: ReactNode;
    ids: (string | undefined)[];
  }[] = [
    ...(actionsInMain
      ? []
      : [
          {
            value: "actions" as const,
            label: "Actions",
            icon: <IconMessages size={14} />,
            ids: [game?.actions.id],
          },
        ]),
    {
      value: "talk",
      label: "Table talk",
      icon: <IconMessage size={14} />,
      ids: [game?.tableTalk?.id],
    },
    {
      value: "hand",
      label: "Hand",
      icon: <IconCards size={14} />,
      ids: [game?.hand?.id],
    },
    {
      value: "threads",
      label: "Threads",
      icon: <IconSubtask size={14} />,
      ids: threadIds,
    },
  ];
  const active = tabs.some((t) => t.value === chosen) ? chosen : tabs[0].value;

  /* Only the visible tab is mounted: a mounted channel counts as read, so the
     others keep accruing unread badges. Messages stay in the store, so
     switching back is immediate. */
  const panel = (value: TabValue, content: ReactNode) =>
    active === value ? (
      <div key={value} className={classes.panel}>
        {content}
      </div>
    ) : null;

  const body = !game ? (
    <Empty>
      {status === "open"
        ? "You are not seated in this game, or it no longer exists."
        : "Connecting…"}
    </Empty>
  ) : (
    <>
      {!actionsInMain && panel("actions", <ActionLog gameName={game.name} />)}
      {panel(
        "talk",
        game.tableTalk ? (
          <ChannelView channelId={game.tableTalk.id} />
        ) : (
          <Empty>No table-talk channel.</Empty>
        ),
      )}
      {panel("hand", <HandPanel gameName={game.name} />)}
      {panel("threads", <Threads game={game} />)}
    </>
  );

  return (
    <aside
      className={cx(
        classes.sidebar,
        open && classes.open,
        dragging && classes.dragging,
      )}
      style={{ width }}
    >
      <div className={classes.handle} {...handleProps} />
      <div className={classes.tabs} role="tablist">
        {tabs.map((tab) => (
          <UnstyledButton
            key={tab.value}
            role="tab"
            aria-selected={active === tab.value}
            className={cx(
              classes.tab,
              active === tab.value && classes.tabActive,
            )}
            onClick={() => setChosen(tab.value)}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {active !== tab.value && unreadIn(tab.ids) > 0 && (
              <span
                className={cx(
                  classes.count,
                  mentionedIn(tab.ids) && classes.mention,
                )}
              >
                {unreadIn(tab.ids)}
              </span>
            )}
          </UnstyledButton>
        ))}
        <UnstyledButton
          className={classes.close}
          onClick={onClose}
          aria-label="Hide sidebar"
        >
          <IconChevronsRight size={16} />
        </UnstyledButton>
      </div>
      <div className={classes.body}>{body}</div>
    </aside>
  );
}
