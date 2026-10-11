import { useEffect, useRef, useState, type CSSProperties } from "react";
import { HoverCard, Modal, Tabs, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useGameData } from "@/state/useGameContext";
import { useCoversBoard } from "@/state/boardCover";
import { filterPlayersWithAssignedFaction } from "@/entities/game/playerUtils";
import PlayerCard from "@/domains/player/components/composition/PlayerCard";
import { FactionSheet } from "@/faction";
import { openTradeWith } from "@/trade";
import { PlayerSeat, PlayerStats } from "./PlayerBoard";
import type { PlayerData } from "@/entities/data/types";
import { useEngineState } from "@/engine";
import { summarizeEnginePlayer } from "@/engine/board";
import { summarizePlayer, type PlayerSummary } from "./playerSummary";
import classes from "./PlayerRail.module.css";

type Props = {
  gameName: string;
  myUserId?: string;
  /** "Passed" only means something in the action phase (the bot keeps it set until the next strategy phase). */
  actionPhase?: boolean;
  /** Opens every player's board side by side. */
  onAllPlayers?: () => void;
};

/**
 * Every seat at the table in one slim, non-scrolling row: faction, score, strategy cards and whose turn it is.
 * Hovering a seat (tapping, on touch screens) shows its full readout; clicking opens the player's whole area.
 */
type Seat = { summary: PlayerSummary; isMe: boolean; legacy?: PlayerData };

export function PlayerRail({ gameName, myUserId, actionPhase = true, onAllPlayers }: Props) {
  const data = useGameData();
  const engineState = useEngineState(gameName);
  const [openColor, setOpenColor] = useState<string | null>(null);
  const [peekColor, setPeekColor] = useState<string | null>(null);
  const [tab, setTab] = useState<"board" | "faction">("board");
  const touch = useMediaQuery("(hover: none)") ?? false;
  const railRef = useRef<HTMLDivElement>(null);
  const players = filterPlayersWithAssignedFaction(data?.playerData ?? []);
  /* Engine flag on and live: seats come from the engine's state; the full player area still opens the web-data board. */
  const seats: Seat[] = engineState
    ? engineState.players
        .filter((p) => p.faction)
        .map((p) => ({
          summary: { ...summarizeEnginePlayer(p, engineState), passed: p.passed && actionPhase },
          isMe: !!myUserId && p.userId === myUserId,
          legacy: players.find((l) => l.discordId === p.userId),
        }))
    : players.map((p) => ({
        summary: { ...summarizePlayer(p, data?.strategyCardIdMap), passed: p.passed && actionPhase },
        isMe: !!myUserId && p.discordId === myUserId,
        legacy: p,
      }));
  const myIndex = seats.findIndex((s) => s.isMe);

  // When the seats overflow (many players on a phone), start the strip at your own seat.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || myIndex < 0 || rail.scrollWidth <= rail.clientWidth) return;
    const seat = rail.children[myIndex] as HTMLElement | undefined;
    if (seat) rail.scrollLeft = seat.offsetLeft - rail.offsetLeft - 12;
  }, [myIndex]);
  const opened = seats.find((s) => s.summary.key === openColor)?.legacy;
  useCoversBoard(!!opened);

  if (!seats.length) return null;
  const vpsToWin = data?.vpsToWin || 10;

  return (
    <>
      <div
        ref={railRef}
        className={classes.rail}
        style={{ "--seats": seats.length } as CSSProperties}
        role="list"
        aria-label="Players"
      >
        {seats.map(({ summary, isMe }) => {
          const open = (which: "board" | "faction" = "board") => {
            setPeekColor(null);
            setTab(which);
            setOpenColor(summary.key);
          };
          return (
            <div role="listitem" key={summary.key} className={classes.seat}>
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
                  opened: peekColor === summary.key,
                  onChange: (o: boolean) => !o && setPeekColor(null),
                })}
              >
                <HoverCard.Target>
                  <UnstyledButton
                    className={classes.seatButton}
                    onClick={() =>
                      touch ? setPeekColor((c) => (c === summary.key ? null : summary.key)) : open("board")
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
                        {myUserId && !isMe && (
                          <UnstyledButton className={classes.more} onClick={() => openTradeWith(summary.faction)}>
                            Trade
                          </UnstyledButton>
                        )}
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
