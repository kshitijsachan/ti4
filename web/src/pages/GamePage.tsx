import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import GameMapPage from "@/pages/GameMapPage";
import { DraftView } from "@/draft";
import { usePressButton } from "@/play/usePressButton";
import { usePlayerData } from "@/api/usePlayerData";
import { usePlay } from "@/discord";
import { findGame } from "@/play/games";
import { useAttention } from "@/play/attention";
import { useTurn, useTurnAlerts } from "@/play/turn";
import { GameScreen } from "@/board/GameScreen";
import { SetupScreen } from "@/board/SetupScreen";
import classes from "./GamePage.module.css";

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

/**
 * The game screen: a table (the map) with the seats around it and your hand in
 * front of you. While the setup draft runs it takes the table's place; before
 * the galaxy exists a quiet setup screen does.
 */
export default function GamePage() {
  const { mapid = "" } = useParams<{ mapid: string }>();
  const queryClient = useQueryClient();
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
  const attention = useAttention(mapid, turn.mine);
  useTurnAlerts(
    mapid,
    turn,
    attention.map((a) => a.message.id),
    () =>
      turn.mine
        ? `${turn.phase ?? "Your move"}: the table is waiting on you.`
        : `${attention.length} prompt(s) waiting for your answer.`,
  );

  // Cards on /play prefetch this document; show it at once, refresh behind it.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["playerData", mapid] });
  }, [mapid, queryClient]);

  let takeover = null;
  if (draft === "drafting") takeover = <Draft gameName={mapid} />;
  else if (boardKnown && !hasBoard)
    takeover = <SetupScreen gameName={mapid} waitingOn={turn.waitingOn} />;

  return (
    <GameMapPage gameId={mapid}>
      <GameScreen
        gameName={mapid}
        turn={turn}
        takeover={takeover}
        boardMissing={boardKnown && !hasBoard}
      />
    </GameMapPage>
  );
}
