import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePlay } from "@/discord";
import { fetchPendingTrades } from "@/trade";
import { getToken } from "@/play/session";
import { findGame, gameOfChannel } from "@/play/games";
import { useChannelJump } from "@/play/channelJump";
import type { TurnState } from "@/play/turn";
import { useGameData } from "@/state/useGameContext";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import { MapLoadingState } from "@/domains/map/components/MapLoadingState";
import { BoardTable } from "./BoardTable";
import { GameDrawers } from "./GameDrawers";
import { DecisionSlot, HandSlot, LogSlot } from "./Mounts";
import { OPEN_TRADE_EVENT } from "@/decisions";
import { ObjectivesModal } from "./ObjectivesModal";
import { PlayerRail } from "./PlayerRail";
import { PlayersView } from "./PlayersView";
import { TopBar, type DrawerName } from "./TopBar";
import { useExternalFocus } from "./useExternalFocus";
import classes from "./GameScreen.module.css";

/** Trades waiting on me, refreshed whenever my hand thread moves. */
function useIncomingTrades(gameName: string, handId: string | undefined, signal: string | undefined) {
  const token = getToken();
  return (
    useQuery({
      queryKey: ["tradesPending", gameName, signal],
      queryFn: () => fetchPendingTrades("/bot", gameName, token!),
      enabled: !!token && !!handId,
      refetchInterval: 15000,
      retry: false,
      select: (data) => data.incoming.length,
    }).data ?? 0
  );
}

/** Opens the right drawer when something (a bot link, a toast) jumps to one of this game's channels. */
function useJumps(
  gameName: string,
  open: (drawer: DrawerName, channelId?: string) => void,
) {
  const target = useChannelJump((s) => s.target);
  const clear = useChannelJump((s) => s.clear);
  const channels = usePlay((s) => s.channels);
  useEffect(() => {
    if (!target) return;
    const game = gameOfChannel(channels, target);
    if (game?.name !== gameName) return;
    clear();
    if (target === game.tableTalk?.id) open("talk");
    else open("raw", target);
  });
}

/** Whether a decision popup is open (not minimised) on the table, so the board can keep clear of it. */
function useDocked(stageRef: RefObject<HTMLElement | null>) {
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const check = () => setDocked(!!stage.querySelector('[role="dialog"][aria-modal="false"]'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(stage, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [stageRef]);
  return docked;
}

type Props = {
  gameName: string;
  turn: TurnState;
  /** Replaces the table, e.g. the draft or the pre-galaxy setup screen. */
  takeover?: ReactNode;
  /** No board will come: don't show a map loader in the meantime. */
  boardMissing?: boolean;
};

/** The game, laid out like a table: header, seats, the map, your hand, and drawers for the rest. */
export function GameScreen({ gameName, turn, takeover, boardMissing }: Props) {
  const data = useGameData();
  const me = usePlay((s) => s.me);
  const channels = usePlay((s) => s.channels);
  const game = findGame(channels, gameName);
  const [drawer, setDrawer] = useState<DrawerName | null>(null);
  const [rawChannel, setRawChannel] = useState<string | null>(null);
  const [objectivesOpen, setObjectivesOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const docked = useDocked(stageRef);
  useExternalFocus();

  const handId = game?.hand?.id;
  const handSignal = usePlay((s) =>
    handId ? (s.messages[handId]?.ids.at(-1) ?? (s.channels[handId]?.last_message_id ?? undefined)) : undefined,
  );
  const incomingTrades = useIncomingTrades(gameName, handId, handSignal);
  const talkId = game?.tableTalk?.id;
  // Table talk shows people's chat only, so the bot's posts there are not "unread".
  const talkUnread = usePlay((s) => {
    const n = talkId ? (s.unread[talkId] ?? 0) : 0;
    const c = talkId ? s.messages[talkId] : undefined;
    return n && c ? c.ids.slice(-n).filter((id) => !c.byId[id]?.author?.bot).length : n;
  });

  useJumps(gameName, (name, channelId) => {
    if (channelId) setRawChannel(channelId);
    setDrawer(name);
  });

  // "Counter" on a trade offer in the decision popup opens the trade drawer.
  useEffect(() => {
    const openTrade = () => setDrawer("trade");
    window.addEventListener(OPEN_TRADE_EVENT, openTrade);
    return () => window.removeEventListener(OPEN_TRADE_EVENT, openTrade);
  }, []);

  const players = data?.playerData ?? [];
  const active = players.find((p) => p.active);
  const mine = players.find((p) => me && p.discordId === me.id);
  let myNote: string | undefined;
  if (mine?.passed) myNote = "You passed";
  const revealed = data?.objectives?.allObjectives?.filter((o) => o.revealed).length ?? 0;

  let stage: ReactNode = takeover;
  if (!stage) {
    stage = data ? <BoardTable gameName={gameName} docked={docked} /> : boardMissing ? null : <MapLoadingState gameId={gameName} />;
  }

  return (
    <div className={classes.screen}>
      <TopBar
        gameName={gameName}
        round={data?.gameRound}
        turn={turn}
        activeColor={active ? getPrimaryColorCSS(active.color) : undefined}
        myNote={myNote}
        objectives={revealed}
        drawer={drawer}
        onDrawer={setDrawer}
        onObjectives={data && !takeover ? () => setObjectivesOpen(true) : undefined}
        onPlayers={data && !takeover ? () => setPlayersOpen(true) : undefined}
        talkUnread={talkUnread}
        incomingTrades={incomingTrades}
      />
      {!takeover && <PlayerRail myUserId={me?.id} onAllPlayers={() => setPlayersOpen(true)} />}
      <main ref={stageRef} className={classes.stage}>
        {stage}
        {!takeover && (
          <div className={classes.ticker}>
            <LogSlot gameName={gameName} variant="ticker" transient onOpen={() => setDrawer("log")} />
          </div>
        )}
        {!takeover && (
          <div className={classes.hand}>
            <HandSlot gameName={gameName} />
          </div>
        )}
        <DecisionSlot gameName={gameName} className={classes.decision} rightInset={drawer ? (drawer === "raw" ? 560 : 460) : 0} />
      </main>
      <GameDrawers
        game={game}
        drawer={drawer}
        onClose={() => setDrawer(null)}
        rawChannel={rawChannel}
        onRawChannel={setRawChannel}
        tradeSignal={handSignal}
      />
      <ObjectivesModal opened={objectivesOpen} onClose={() => setObjectivesOpen(false)} />
      <PlayersView opened={playersOpen} onClose={() => setPlayersOpen(false)} />
    </div>
  );
}
