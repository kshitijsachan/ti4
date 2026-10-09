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

/** Whether the game has a setup draft running; the draft takes the board's place while it does. */
function useDraftStatus(gameName: string, hasBoard: boolean) {
  return useQuery({
    queryKey: ["draftStatus", gameName],
    queryFn: async (): Promise<DraftStatus> => {
      const res = await fetch(`/bot/api/public/game/${gameName}/draft`);
      if (!res.ok) return "none";
      const body = (await res.json()) as { status?: DraftStatus };
      return body.status ?? "none";
    },
    refetchInterval: (query) =>
      query.state.data === "drafting" || !hasBoard ? 5000 : 60000,
    retry: false,
  });
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
  const draft = useDraftStatus(mapid, hasBoard).data ?? "none";

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
