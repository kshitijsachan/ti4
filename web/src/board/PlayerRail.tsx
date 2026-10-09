import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  const railRef = useRef<HTMLDivElement>(null);
  const players = filterPlayersWithAssignedFaction(data?.playerData ?? []);
  const myIndex = players.findIndex((p) => !!myUserId && p.discordId === myUserId);

  // On a phone the seats are a swipe strip: start it at your own seat.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || myIndex < 0 || rail.scrollWidth <= rail.clientWidth) return;
    const seat = rail.children[myIndex] as HTMLElement | undefined;
    if (seat) rail.scrollLeft = seat.offsetLeft - rail.offsetLeft - 12;
  }, [myIndex]);

  if (!data) return null;
  if (!players.length) return null;
  const opened = players.find((p) => p.color === openColor);

  return (
    <>
      <div
        ref={railRef}
        className={classes.rail}
        style={{ "--seats": players.length } as CSSProperties}
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
