import cx from "clsx";
import type { DraftPlayer, DraftState } from "../types";
import { factionIcon } from "./FactionCard";
import { playerAccent } from "./PlayerTag";
import classes from "../Draft.module.css";

type Props = {
  draft: DraftState;
  myUserId: string;
  onFocusSlice: (name: string) => void;
  onFocusFaction: (alias: string) => void;
};

/** Who holds what. One row per player in first-round order. */
export function DraftBoard({
  draft,
  myUserId,
  onFocusSlice,
  onFocusFaction,
}: Props) {
  const hasSeats = draft.seats.length > 0;
  return (
    <div className={classes.board} role="table">
      <div className={cx(classes.boardRow, classes.boardHead)} role="row">
        <span>#</span>
        <span>Player</span>
        <span>Faction</span>
        <span>Slice</span>
        <span>{hasSeats ? "Seat" : "Order"}</span>
        {hasSeats && <span>Order</span>}
      </div>
      {draft.players.map((p) => (
        <BoardRow
          key={p.userId}
          draft={draft}
          player={p}
          mine={p.userId === myUserId}
          hasSeats={hasSeats}
          onFocusSlice={onFocusSlice}
          onFocusFaction={onFocusFaction}
        />
      ))}
    </div>
  );
}

type RowProps = {
  draft: DraftState;
  player: DraftPlayer;
  mine: boolean;
  hasSeats: boolean;
  onFocusSlice: (name: string) => void;
  onFocusFaction: (alias: string) => void;
};

function BoardRow({
  draft,
  player,
  mine,
  hasSeats,
  onFocusSlice,
  onFocusFaction,
}: RowProps) {
  const faction = draft.factions.find((f) => f.alias === player.faction);
  return (
    <div
      role="row"
      className={cx(
        classes.boardRow,
        player.current && classes.boardLive,
        mine && classes.boardMine,
      )}
      style={{ ["--player-accent" as string]: playerAccent(player) }}
    >
      <span className={classes.boardPos}>{player.draftPosition}</span>
      <span className={classes.boardName}>
        <span className={classes.playerTagDot} />
        <span className={classes.boardNameText}>{player.name}</span>
        {player.current && <span className={classes.liveBadge}>Picking</span>}
        {!player.current && player.next && (
          <span className={classes.deckBadge}>Next</span>
        )}
      </span>
      <span className={classes.boardCell}>
        {faction ? (
          <button
            type="button"
            className={classes.boardLink}
            onClick={() => onFocusFaction(faction.alias)}
            title={faction.name}
          >
            <img
              src={factionIcon(faction)}
              alt=""
              className={classes.boardFactionIcon}
            />
            <span className={classes.boardFactionName}>
              {faction.shortName}
            </span>
          </button>
        ) : (
          <span className={classes.socket} />
        )}
      </span>
      <span className={classes.boardCell}>
        {player.slice ? (
          <button
            type="button"
            className={cx(classes.boardLink, classes.boardSlice)}
            onClick={() => onFocusSlice(player.slice!)}
          >
            {player.slice}
          </button>
        ) : (
          <span className={classes.socket} />
        )}
      </span>
      <span className={classes.boardCell}>
        {(hasSeats ? player.seat : player.speakerOrder) != null ? (
          <span className={classes.boardOrder}>
            {hasSeats ? player.seat : player.speakerOrder}
          </span>
        ) : (
          <span className={classes.socket} />
        )}
      </span>
      {hasSeats && (
        <span className={classes.boardCell}>
          {player.speakerOrder != null ? (
            <span className={classes.boardOrder}>{player.speakerOrder}</span>
          ) : (
            <span className={classes.socket} />
          )}
        </span>
      )}
    </div>
  );
}
