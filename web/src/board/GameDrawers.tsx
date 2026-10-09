import { useEffect, useState, type ReactNode } from "react";
import { Drawer, UnstyledButton } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { ChannelList, ChannelView, usePlay } from "@/discord";
import { TradePanel } from "@/trade";
import { getToken } from "@/play/session";
import { usePressButton } from "@/play/usePressButton";
import type { GameChannels } from "@/play/games";
import { HandFallbackPanel, LogSlot } from "./Mounts";
import type { DrawerName } from "./TopBar";
import classes from "./GameDrawers.module.css";

function Empty({ children }: { children: ReactNode }) {
  return <div className={classes.empty}>{children}</div>;
}

type RawProps = { game: GameChannels; channelId: string | null; onChannel: (id: string | null) => void };

/** The bot's own channels and threads, as Discord would show them. For when a prompt isn't recognised. */
function RawChannels({ game, channelId, onChannel }: RawProps) {
  if (channelId) {
    return (
      <div className={classes.column}>
        <UnstyledButton className={classes.back} onClick={() => onChannel(null)}>
          <IconArrowLeft size={14} />
          <span>All channels</span>
        </UnstyledButton>
        <div className={classes.fill}>
          <ChannelView key={channelId} channelId={channelId} />
        </div>
      </div>
    );
  }
  return (
    <div className={classes.scroll}>
      <p className={classes.hint}>
        The bot&apos;s raw channels. Everything here is also handled on the table; use these only if a prompt
        doesn&apos;t show up there.
      </p>
      <ChannelList gameName={game.name} onSelect={onChannel} />
    </div>
  );
}

const TITLES: Record<DrawerName, string> = {
  log: "Game log",
  talk: "Table talk",
  trade: "Trade",
  raw: "Raw bot channels",
  hand: "Your hand",
};

type Props = {
  game: GameChannels | undefined;
  drawer: DrawerName | null;
  onClose: () => void;
  /** A channel to show in the raw view (e.g. from a "jump to" link). */
  rawChannel: string | null;
  onRawChannel: (id: string | null) => void;
  tradeSignal?: string;
};

/** The side drawers: everything off the table that you only look at sometimes. */
export function GameDrawers({ game, drawer, onClose, rawChannel, onRawChannel, tradeSignal }: Props) {
  const status = usePlay((s) => s.status);
  const press = usePressButton();
  const token = getToken();
  // Keep the last drawer's content while it slides out.
  const [shown, setShown] = useState<DrawerName | null>(drawer);
  useEffect(() => {
    if (drawer) setShown(drawer);
  }, [drawer]);

  const body = () => {
    if (!game) return <Empty>{status === "open" ? "You are not seated in this game." : "Connecting…"}</Empty>;
    switch (shown) {
      case "log":
        return <LogSlot gameName={game.name} variant="full" />;
      case "talk":
        return game.tableTalk ? (
          <ChannelView
            channelId={game.tableTalk.id}
            header={false}
            empty={<Empty>Say hello to the table.</Empty>}
            className={classes.fill}
          />
        ) : (
          <Empty>This game has no table-talk channel.</Empty>
        );
      case "trade":
        return token && game.hand ? (
          <div className={classes.scroll}>
            <TradePanel gameName={game.name} token={token} onPress={press} refreshSignal={tradeSignal} />
          </div>
        ) : (
          <Empty>Trading opens once you have a seat in a started game.</Empty>
        );
      case "hand":
        return <HandFallbackPanel gameName={game.name} />;
      case "raw":
        return <RawChannels game={game} channelId={rawChannel} onChannel={onRawChannel} />;
      default:
        return null;
    }
  };

  return (
    <Drawer
      opened={!!drawer}
      onClose={onClose}
      position="right"
      size={shown === "raw" ? 560 : 460}
      title={shown ? TITLES[shown] : ""}
      withOverlay={false}
      zIndex={2450}
      lockScroll={false}
      trapFocus={false}
      classNames={{ inner: classes.inner, content: classes.content, body: classes.body, header: classes.header }}
    >
      {body()}
    </Drawer>
  );
}
