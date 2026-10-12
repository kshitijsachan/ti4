import { Markdown } from "@/discord";
import type { GameEnd } from "../../contract";
import type { EngineRendererProps } from "../../registry";
import { EndActions } from "./EndActions";
import classes from "./game.module.css";

/**
 * The victory prompt while the engine does not (yet) call the game over (e.g. a tie the victory rules can't
 * separate): its text and End Game / Rematch. Once the game is over the winner screen carries the same actions.
 */
export function GameEndRenderer({ decision, answer, pendingOptionId }: EngineRendererProps<GameEnd>) {
  return (
    <div className={classes.root}>
      {decision.prompt && <Markdown content={decision.prompt} className={classes.sub} />}
      <EndActions prompt={decision} finish="won" answer={(_, c) => answer(c)} pendingOptionId={pendingOptionId} />
    </div>
  );
}
