import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { UnstyledButton } from "@mantine/core";
import { IconLayoutSidebarRightExpand } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import GameMapPage from "@/pages/GameMapPage";
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
  const inSetup = board.isError || board.data === false;

  // Cards on /play prefetch this document; show it at once, refresh behind it.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["playerData", mapid] });
  }, [mapid, queryClient]);

  return (
    <div className={classes.shell}>
      <div className={classes.board}>
        <GameMapPage setupView={<SetupView gameName={mapid} />} />
      </div>
      <PlaySidebar
        gameName={mapid}
        actionsInMain={inSetup}
        open={sidebarOpen}
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
