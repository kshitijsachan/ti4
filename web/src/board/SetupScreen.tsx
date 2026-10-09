import { hasGameLog, LogSlot } from "./Mounts";
import classes from "./SetupScreen.module.css";

type Props = { gameName: string; waitingOn?: string };

/** Before there is a galaxy there is no table: say what's happening and let the prompts come to you. */
export function SetupScreen({ gameName, waitingOn }: Props) {
  return (
    <div className={classes.setup}>
      <div className={classes.card}>
        <div className={classes.kicker}>Setting up</div>
        <h1 className={classes.title}>The galaxy is being built</h1>
        <p className={classes.note}>
          {waitingOn
            ? `Waiting on ${waitingOn}. `
            : "Factions, seats and the map are chosen first. "}
          Anything you need to decide will pop up here, and the table appears as soon as the map exists.
        </p>
        <div className={hasGameLog ? classes.ticker : classes.log}>
          <LogSlot gameName={gameName} variant={hasGameLog ? "ticker" : "full"} />
        </div>
      </div>
    </div>
  );
}
