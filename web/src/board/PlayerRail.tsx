import { useEffect, useRef, useState, type CSSProperties } from "react";
import { HoverCard, Modal, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useGameData } from "@/state/useGameContext";
import { filterPlayersWithAssignedFaction } from "@/entities/game/playerUtils";
import PlayerCard from "@/domains/player/components/composition/PlayerCard";
import { PlayerSeat, PlayerStats } from "./PlayerBoard";
import { summarizePlayer } from "./playerSummary";
import classes from "./PlayerRail.module.css";

type Props = { myUserId?: string };

/**
 * Every seat at the table in one slim, non-scrolling row: faction, score, strategy cards and whose turn it is.
 * Hovering a seat (tapping, on touch screens) shows its full readout; clicking opens the player's whole area.
 */
export function PlayerRail({ myUserId }: Props) {
  const data = useGameData();
  const [openColor, setOpenColor] = useState<string | null>(null);
  const [peekColor, setPeekColor] = useState<string | null>(null);
  const touch = useMediaQuery("(hover: none)") ?? false;
  const railRef = useRef<HTMLDivElement>(null);
  const players = filterPlayersWithAssignedFaction(data?.playerData ?? []);
  const myIndex = players.findIndex((p) => !!myUserId && p.discordId === myUserId);

  // When the seats overflow (many players on a phone), start the strip at your own seat.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || myIndex < 0 || rail.scrollWidth <= rail.clientWidth) return;
    const seat = rail.children[myIndex] as HTMLElement | undefined;
    if (seat) rail.scrollLeft = seat.offsetLeft - rail.offsetLeft - 12;
  }, [myIndex]);

  if (!data || !players.length) return null;
  const opened = players.find((p) => p.color === openColor);
  const vpsToWin = data.vpsToWin || 10;

  return (
    <>
      <div
        ref={railRef}
        className={classes.rail}
        style={{ "--seats": players.length } as CSSProperties}
        role="list"
        aria-label="Players"
      >
        {players.map((player) => {
          const summary = summarizePlayer(player, data.strategyCardIdMap);
          const isMe = !!myUserId && player.discordId === myUserId;
          const open = () => {
            setPeekColor(null);
            setOpenColor(player.color);
          };
          return (
            <div role="listitem" key={player.color} className={classes.seat}>
              <HoverCard
                position="bottom"
                openDelay={touch ? 0 : 250}
                closeDelay={80}
                shadow="md"
                withinPortal
                zIndex={3200}
                {...(touch && {
                  opened: peekColor === player.color,
                  onChange: (o: boolean) => !o && setPeekColor(null),
                })}
              >
                <HoverCard.Target>
                  <UnstyledButton
                    className={classes.seatButton}
                    onClick={() =>
                      touch ? setPeekColor((c) => (c === player.color ? null : player.color)) : open()
                    }
                    aria-label={`${summary.name} (${summary.factionName}), ${summary.vp} victory points`}
                  >
                    <PlayerSeat player={summary} vpsToWin={vpsToWin} isMe={isMe} />
                  </UnstyledButton>
                </HoverCard.Target>
                <HoverCard.Dropdown className={classes.card}>
                  <PlayerStats
                    player={summary}
                    vpsToWin={vpsToWin}
                    isMe={isMe}
                    hint={
                      touch ? (
                        <UnstyledButton className={classes.more} onClick={open}>
                          Open player area
                        </UnstyledButton>
                      ) : (
                        "Click the seat for the full player area"
                      )
                    }
                  />
                </HoverCard.Dropdown>
              </HoverCard>
            </div>
          );
        })}
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
