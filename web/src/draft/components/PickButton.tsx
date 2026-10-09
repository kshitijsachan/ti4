import cx from "clsx";
import type { PickAvailability } from "../model";
import classes from "../Draft.module.css";

type Props = {
  label: string;
  availability: PickAvailability;
  pending: boolean;
  onPick: () => void;
  size?: "sm" | "md";
};

/** The one place a pick is made. Disabled states say why, so the button doubles as a status readout. */
export function PickButton({
  label,
  availability,
  pending,
  onPick,
  size = "md",
}: Props) {
  if (pending) {
    return (
      <button
        type="button"
        className={cx(
          classes.pickButton,
          classes.pickPending,
          size === "sm" && classes.pickSm,
        )}
        disabled
      >
        <span className={classes.pickSpinner} aria-hidden />
        Sending pick…
      </button>
    );
  }
  if (!availability.ok && availability.taken) return null;
  const ok = availability.ok;
  return (
    <button
      type="button"
      className={cx(
        classes.pickButton,
        ok && classes.pickReady,
        size === "sm" && classes.pickSm,
      )}
      disabled={!ok}
      title={ok ? label : availability.reason}
      onClick={(e) => {
        e.stopPropagation();
        if (ok) onPick();
      }}
    >
      {ok ? label : availability.reason}
    </button>
  );
}
