import { useState } from "react";
import { Modal } from "@mantine/core";
import { useGameData } from "@/state/useGameContext";
import { filterPlayersWithAssignedFaction } from "@/entities/game/playerUtils";
import PlayerCard from "@/domains/player/components/composition/PlayerCard";
import { PlayerBoard } from "./PlayerBoard";
import { summarizePlayer } from "./playerSummary";
import classes from "./PlayerRail.module.css";

type Props = { myUserId?: string };

/**
 * Every seat at the table in one row: no scrolling, no tabs. A seat opens the
 * player's full area in a popup.
 */
export function PlayerRail({ myUserId }: Props) {
  const data = useGameData();
  const [openColor, setOpenColor] = useState<string | null>(null);
  if (!data) return null;

  const players = filterPlayersWithAssignedFaction(data.playerData);
  if (!players.length) return null;
  const opened = players.find((p) => p.color === openColor);

  return (
    <>
      <div
        className={classes.rail}
        style={{ "--seats": players.length } as React.CSSProperties}
        role="list"
        aria-label="Players"
      >
        {players.map((player) => (
          <div role="listitem" key={player.color} className={classes.seat}>
            <PlayerBoard
              player={summarizePlayer(player, data.strategyCardIdMap)}
              vpsToWin={data.vpsToWin || 10}
              isMe={!!myUserId && player.discordId === myUserId}
              onOpen={() => setOpenColor(player.color)}
            />
          </div>
        ))}
      </div>
      <Modal
        opened={!!opened}
        onClose={() => setOpenColor(null)}
        size="auto"
        centered
        title={opened ? `${opened.userName} · ${summarizePlayer(opened).factionName}` : ""}
        classNames={{ content: classes.detail, body: classes.detailBody }}
      >
        {opened && <PlayerCard playerData={opened} />}
      </Modal>
    </>
  );
}
