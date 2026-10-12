import { IconTrophy } from "@tabler/icons-react";
import cx from "clsx";
import { CircularFactionIcon } from "@/shared/ui/CircularFactionIcon";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import type { CSSProperties } from "react";
import type { GameEnd } from "../../contract";
import { gameOverHeadline, type GameOverView } from "../../gameOver";
import type { AnswerPayload } from "../../link";
import { factionName } from "../../names";
import { EndActions } from "./EndActions";
import classes from "./game.module.css";

type Props = {
  view: GameOverView;
  answer: (d: GameEnd, choice: string | AnswerPayload) => void;
  pendingOptionId?: string | null;
};

/** The winner screen's body: who won, the final standings, and End Game / Rematch. */
export function WinnerPanel({ view, answer, pendingOptionId }: Props) {
  const target = view.victoryPointsToWin;
  return (
    <div className={classes.root} data-engine-game-over={view.finish}>
      <div className={classes.headline}>
        <IconTrophy size={20} stroke={1.8} className={classes.trophy} aria-hidden />
        <span>{gameOverHeadline(view)}</span>
      </div>
      <p className={classes.sub}>
        {view.finish === "ended" ? "The game has been ended." : "The game is over. End it when the table is done, or start a rematch."}
      </p>
      <ol className={classes.standings} aria-label="Final standings">
        {view.standings.map((s) => (
          <li
            key={s.userId}
            className={cx(classes.row, s.winner && classes.rowWinner, s.self && classes.rowSelf)}
          >
            <span className={classes.rank}>{s.rank}</span>
            <span
              className={classes.seat}
              style={s.color ? ({ "--seat": getPrimaryColorCSS(s.color) } as CSSProperties) : undefined}
              title={s.color ?? undefined}
            />
            {s.faction ? <CircularFactionIcon faction={s.faction} size={22} /> : <span className={classes.noFaction} />}
            <span className={classes.who}>
              <span className={classes.name}>
                {s.name}
                {s.self && <span className={classes.you}> (you)</span>}
              </span>
              {s.faction && <span className={classes.faction}>{factionName(s.faction)}</span>}
            </span>
            {s.winner && (
              <span className={classes.winnerTag}>
                <IconTrophy size={12} aria-hidden />
                Winner
              </span>
            )}
            <span className={classes.vp}>
              {s.victoryPoints}
              {target ? <span className={classes.vpOf}>/{target}</span> : null} VP
            </span>
          </li>
        ))}
      </ol>
      <EndActions prompt={view.endPrompt} finish={view.finish} answer={answer} pendingOptionId={pendingOptionId} />
    </div>
  );
}
