import cx from "clsx";
import type { DraftState } from "../types";
import { playerById } from "../model";
import { playerAccent } from "./PlayerTag";
import classes from "../Draft.module.css";

type Props = { draft: DraftState; myUserId: string };

/** The snake: every pick slot in order, grouped by round, with the live slot lit. */
export function PickTracker({ draft, myUserId }: Props) {
  const n = Math.max(1, draft.players.length);
  const rounds: string[][] = [];
  draft.pickOrder.forEach((uid, i) => {
    const r = Math.floor(i / n);
    (rounds[r] ??= []).push(uid);
  });

  return (
    <div className={classes.tracker} aria-label="Pick order">
      {rounds.map((round, r) => (
        <div key={r} className={classes.trackerRound}>
          <span className={classes.trackerRoundLabel}>
            R{r + 1} <span aria-hidden>{r % 2 === 0 ? "→" : "←"}</span>
          </span>
          <div className={classes.trackerCells}>
            {round.map((uid, j) => {
              const index = r * n + j;
              const player = playerById(draft, uid);
              const done = index < draft.pickIndex;
              const live =
                index === draft.pickIndex && draft.status === "drafting";
              return (
                <span
                  key={index}
                  className={cx(
                    classes.trackerCell,
                    done && classes.trackerDone,
                    live && classes.trackerLive,
                    uid === myUserId && classes.trackerMine,
                  )}
                  style={
                    player
                      ? { ["--player-accent" as string]: playerAccent(player) }
                      : undefined
                  }
                  title={`Pick ${index + 1}: ${player?.name ?? uid}`}
                >
                  <span className={classes.trackerIndex}>{index + 1}</span>
                  <span className={classes.trackerName}>
                    {player?.name ?? "?"}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
