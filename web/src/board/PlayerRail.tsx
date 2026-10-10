import { useEffect, useRef, useState, type CSSProperties } from "react";
import { HoverCard, Modal, Tabs, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useGameData } from "@/state/useGameContext";
import { filterPlayersWithAssignedFaction } from "@/entities/game/playerUtils";
import PlayerCard from "@/domains/player/components/composition/PlayerCard";
import { FactionSheet } from "@/faction";
import { PlayerSeat, PlayerStats } from "./PlayerBoard";
import { summarizePlayer } from "./playerSummary";
import classes from "./PlayerRail.module.css";

type Props = {
  myUserId?: string;
  /** Opens every player's board side by side. */
  onAllPlayers?: () => void;
};

/**
 * Every seat at the table in one slim, non-scrolling row: faction, score, strategy cards and whose turn it is.
 * Hovering a seat (tapping, on touch screens) shows its full readout; clicking opens the player's whole area.
 */
export function PlayerRail({ myUserId, onAllPlayers }: Props) {
  const data = useGameData();
  const [openColor, setOpenColor] = useState<string | null>(null);
  const [peekColor, setPeekColor] = useState<string | null>(null);
  const [tab, setTab] = useState<"board" | "faction">("board");
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
          const open = (which: "board" | "faction" = "board") => {
            setPeekColor(null);
            setTab(which);
            setOpenColor(player.color);
          };
          return (
            <div role="listitem" key={player.color} className={classes.seat}>
              <HoverCard
                position="bottom"
                openDelay={touch ? 0 : 120}
                closeDelay={60}
                disabled={!!openColor}
                transitionProps={{ transition: "fade", duration: 90 }}
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
                      touch ? setPeekColor((c) => (c === player.color ? null : player.color)) : open("board")
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
                      <span className={classes.hintRow}>
                        {touch ? (
                          <UnstyledButton className={classes.more} onClick={() => open("board")}>
                            Open player area
                          </UnstyledButton>
                        ) : (
                          <span>Click the seat for the full player area</span>
                        )}
                        <UnstyledButton className={classes.more} onClick={() => open("faction")}>
                          Faction sheet
                        </UnstyledButton>
                      </span>
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
        {opened && (
          <Tabs value={tab} onChange={(v) => setTab(v === "faction" ? "faction" : "board")} keepMounted={false}>
            <Tabs.List className={classes.detailTabs}>
              <Tabs.Tab value="board">Board</Tabs.Tab>
              <Tabs.Tab value="faction">Faction</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="board">
              <PlayerCard playerData={opened} />
            </Tabs.Panel>
            <Tabs.Panel value="faction">
              <FactionSheet faction={opened.faction} player={opened} playerColor={opened.color} />
            </Tabs.Panel>
          </Tabs>
        )}
        {onAllPlayers && (
          <div className={classes.detailFoot}>
            <UnstyledButton
              className={classes.more}
              onClick={() => {
                setOpenColor(null);
                onAllPlayers();
              }}
            >
              Compare all players side by side
            </UnstyledButton>
          </div>
        )}
      </Modal>
    </>
  );
}
