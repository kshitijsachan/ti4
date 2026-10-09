import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { UnstyledButton } from "@mantine/core";
import {
  IconLayoutSidebarRightExpand,
  IconListNumbers,
  IconMessages,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import GameMapPage, { type GameViewTab } from "@/pages/GameMapPage";
import { DraftView } from "@/draft";
import { usePressButton } from "@/play/usePressButton";
import { usePlayerData } from "@/api/usePlayerData";
import { ActionLog, usePlay } from "@/discord";
import { findGame } from "@/play/games";
import { PlaySidebar } from "@/play/PlaySidebar";
import { AttentionTray } from "@/play/AttentionTray";
import { useAttention } from "@/play/attention";
import { useTurn, useTurnAlerts } from "@/play/turn";
import classes from "./GamePage.module.css";

const NARROW = 900;

/** Before the galaxy is built there is no board: the action channel is the game. */
function SetupView({ gameName }: { gameName: string }) {
  const channels = usePlay((s) => s.channels);
  const status = usePlay((s) => s.status);
  const game = findGame(channels, gameName);

  return (
    <div className={classes.setup}>
      <div className={classes.setupBar}>
        <span className={classes.setupLabel}>Setup</span>
        <span className={classes.setupNote}>
          Draft and build the galaxy below — the map takes over this space once
          it exists.
        </span>
      </div>
      <div className={classes.setupLog}>
        {game ? (
          <ActionLog gameName={game.name} />
        ) : (
          <div className={classes.setupEmpty}>
            {status === "open"
              ? "This game has no action channel you can see."
              : "Connecting…"}
          </div>
        )}
      </div>
    </div>
  );
}

type DraftStatus = "none" | "drafting" | "finished";

type DraftSummary = {
  status: DraftStatus;
  /** Who is on the clock while drafting. */
  picking?: { userId: string; name: string };
};

/**
 * Whether the game has a setup draft running (the draft takes the board's
 * place while it does) and who is picking. Refetched whenever the action log
 * moves until the draft is over, so every seat flips to the draft at once.
 */
function useDraftStatus(gameName: string, hasBoard: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["draftStatus", gameName],
    queryFn: async (): Promise<DraftSummary> => {
      const res = await fetch(`/bot/api/public/game/${gameName}/draft`);
      if (!res.ok) return { status: "none" };
      const body = (await res.json()) as {
        status?: DraftStatus;
        players?: { userId: string; name: string; current: boolean }[];
      };
      const current = body.players?.find((p) => p.current);
      return {
        status: body.status ?? "none",
        picking:
          body.status === "drafting" && current
            ? { userId: current.userId, name: current.name }
            : undefined,
      };
    },
    refetchInterval: (query) =>
      query.state.data?.status === "drafting" || !hasBoard ? 5000 : 60000,
    retry: false,
  });
  const actionsId = usePlay((s) => findGame(s.channels, gameName)?.actions.id);
  const lastAction = usePlay((s) =>
    actionsId
      ? (s.messages[actionsId]?.ids.at(-1) ??
        s.channels[actionsId]?.last_message_id)
      : undefined,
  );
  const finished = query.data?.status === "finished";
  useEffect(() => {
    if (!lastAction || finished) return;
    void queryClient.invalidateQueries({ queryKey: ["draftStatus", gameName] });
  }, [lastAction, finished, gameName, queryClient]);
  return query.data ?? { status: "none" as const };
}

function Draft({ gameName }: { gameName: string }) {
  const me = usePlay((s) => s.me);
  const press = usePressButton();
  const actionsId = usePlay((s) => findGame(s.channels, gameName)?.actions.id);
  const lastAction = usePlay((s) =>
    actionsId
      ? (s.messages[actionsId]?.ids.at(-1) ??
        s.channels[actionsId]?.last_message_id)
      : undefined,
  );
  if (!me) return null;

  return (
    <div className={classes.draft}>
      <DraftView
        gameName={gameName}
        myUserId={me.id}
        botBase="/bot"
        refreshSignal={lastAction}
        onPick={(customId, channelId, messageId) =>
          press(channelId, messageId, customId)
        }
      />
    </div>
  );
}

/** The game screen: the board (upstream view) with the play sidebar docked right. */
export default function GamePage() {
  const { mapid = "" } = useParams<{ mapid: string }>();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.innerWidth > NARROW,
  );
  const board = usePlayerData(mapid, {
    select: (data) => data.tilePositions.length > 0,
  });
  const hasBoard = board.data === true;
  const boardKnown = board.isError || board.data !== undefined;
  const draftSummary = useDraftStatus(mapid, hasBoard);
  const draft = draftSummary.status;
  const me = usePlay((s) => s.me);
  const turn = useTurn(
    mapid,
    me?.id,
    draftSummary.picking && {
      mine: draftSummary.picking.userId === me?.id,
      picking: draftSummary.picking.name,
    },
  );
  const attention = useAttention(mapid);
  useTurnAlerts(
    mapid,
    turn,
    attention.map((a) => a.message.id),
    () =>
      turn.mine
        ? `${turn.phase ?? "Your move"}: the table is waiting on you.`
        : `${attention.length} prompt(s) waiting for your answer.`,
  );

  const draftTab: GameViewTab = {
    value: "x-draft",
    label: "Draft",
    Icon: IconListNumbers,
    node: <Draft gameName={mapid} />,
  };
  const setupTab: GameViewTab = {
    value: "x-setup",
    label: "Setup",
    Icon: IconMessages,
    node: <SetupView gameName={mapid} />,
  };

  let mapOverride: GameViewTab | null = null;
  if (draft === "drafting") mapOverride = draftTab;
  else if (boardKnown && !hasBoard) mapOverride = setupTab;
  const extraTabs =
    draft !== "none" && mapOverride !== draftTab ? [draftTab] : [];
  const actionsInMain = mapOverride === setupTab;

  // Cards on /play prefetch this document; show it at once, refresh behind it.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["playerData", mapid] });
  }, [mapid, queryClient]);

  return (
    <div className={classes.shell}>
      <div className={classes.board}>
        <GameMapPage mapOverride={mapOverride} extraTabs={extraTabs} />
        <AttentionTray items={attention} turn={turn} />
      </div>
      <PlaySidebar
        gameName={mapid}
        actionsInMain={actionsInMain}
        open={sidebarOpen}
        onOpen={() => setSidebarOpen(true)}
        onClose={() => setSidebarOpen(false)}
      />
      {!sidebarOpen && (
        <UnstyledButton
          className={classes.reopen}
          onClick={() => setSidebarOpen(true)}
          aria-label="Show channels"
        >
          <IconLayoutSidebarRightExpand size={18} />
          <span>Channels</span>
        </UnstyledButton>
      )}
    </div>
  );
}
