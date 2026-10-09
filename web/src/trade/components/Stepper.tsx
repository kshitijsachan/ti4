import cx from "clsx";
import classes from "../Trade.module.css";

type Props = {
  value: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
  /** Shown after the readout, e.g. "of 3". Defaults to the max. */
  showMax?: boolean;
};

/** A − value + counter seated in a trough. Shift-click jumps to 0 / max. */
export function Stepper({ value, max, onChange, label, disabled, showMax = true }: Props) {
  const off = disabled || max <= 0;
  const step = (delta: number, jump: boolean) => {
    if (jump) return onChange(delta < 0 ? 0 : max);
    onChange(Math.max(0, Math.min(max, value + delta)));
  };
  return (
    <span className={cx(classes.stepper, value > 0 && classes.stepperActive)}>
      <button
        type="button"
        className={classes.stepBtn}
        aria-label={`Less ${label}`}
        disabled={off || value <= 0}
        onClick={(e) => step(-1, e.shiftKey)}
      >
        −
      </button>
      <span
        className={cx(classes.stepValue, value > 0 && classes.stepValueOn)}
        aria-label={`${label}: ${value} of ${max}`}
        role="status"
      >
        {value}
        {showMax && <span className={classes.stepMax}>/{Math.max(0, max)}</span>}
      </span>
      <button
        type="button"
        className={classes.stepBtn}
        aria-label={`More ${label}`}
        disabled={off || value >= max}
        onClick={(e) => step(1, e.shiftKey)}
      >
        +
      </button>
    </span>
  );
}
