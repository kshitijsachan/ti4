import { useSetupWaiting } from "@/decisions";
import { LogSlot } from "./Mounts";
import classes from "./SetupScreen.module.css";

type Props = { gameName: string; waitingOn?: string };

/**
 * Before there is a galaxy there is no table: say what's happening and let the prompts come to you. Never a dead
 * end: when nothing waits on me it says who (or what) the table is waiting for, from the latest prompts.
 */
export function SetupScreen({ gameName, waitingOn }: Props) {
  const waiting = useSetupWaiting(gameName);
  let note: string;
  if (waiting?.me) note = `${waiting.text} Your choice is in the popup.`;
  else if (waiting) note = waiting.text;
  else if (waitingOn) note = `Waiting on ${waitingOn}…`;
  else note = "Factions, seats and the map are chosen first.";
  return (
    <div className={classes.setup}>
      <div className={classes.card}>
        <div className={classes.kicker}>Setting up</div>
        <h1 className={classes.title}>The galaxy is being built</h1>
        <p className={classes.note} role="status">
          {note}
        </p>
        <p className={classes.note}>Anything you need to decide pops up here, and the table appears as soon as the map exists.</p>
        <div className={classes.ticker}>
          <LogSlot gameName={gameName} variant="ticker" max={3} />
        </div>
      </div>
    </div>
  );
}
