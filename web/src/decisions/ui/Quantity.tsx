import type { MouseEvent, ReactNode } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import { useRunner } from "../renderers/strategy/runner";
import classes from "./Quantity.module.css";

export type QuantityProps = {
  /** What is counted ("Trade goods", "Cultural fragments"). */
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  /**
   * Only these values can be chosen (a ladder the bot offers: "1 / 2 / 3"). −/+ jump between them; `min`/`max`
   * still bound them.
   */
  allowed?: number[];
  /** Short unit after the value ("TG", "votes"). */
  unit?: string;
  /** Second line under the label ("you have 4", "2 votes each"). */
  hint?: ReactNode;
  /** The whole row is off, and why (shown in place of the hint). */
  disabledReason?: string;
  /** Why the value cannot go higher (shown inline once the max is reached and the max is below what one might expect). */
  maxReason?: string;
  /** Why the value cannot go lower. */
  minReason?: string;
  /** Show a "Max" shortcut (default: when the range is wider than 2). */
  maxShortcut?: boolean;
  /** Leading art (fragment icon, faction icon). */
  icon?: ReactNode;
  /** A run is pressing the bot's buttons: freeze the control. */
  busy?: boolean;
  /** Compact row for long lists (a counter per strategy card). */
  dense?: boolean;
};

function options(min: number, max: number, allowed?: number[]) {
  if (!allowed) return undefined;
  return [...new Set(allowed)].filter((n) => n >= min && n <= max).sort((a, b) => a - b);
}

/** The next value up or down: one step, or the next value the ladder allows. */
function stepFrom(value: number, dir: 1 | -1, min: number, max: number, allowed?: number[]) {
  const list = options(min, max, allowed);
  if (!list) return Math.max(min, Math.min(max, value + dir));
  const next = dir > 0 ? list.find((n) => n > value) : [...list].reverse().find((n) => n < value);
  return next ?? value;
}

/**
 * A labelled −/+ counter for anything the bot asks as a ladder of buttons ("Spend 1 / 2 / 3 TG", repeated "Gain 1
 * commodity"). The value is a target the panel's confirm turns into the bot's presses (see `usePressPlan`).
 */
export function Quantity({
  label,
  value,
  onChange,
  min = 0,
  max,
  allowed,
  unit,
  hint,
  disabledReason,
  maxReason,
  minReason,
  maxShortcut,
  icon,
  busy,
  dense,
}: QuantityProps) {
  const off = !!disabledReason || busy || max <= min;
  const list = options(min, max, allowed);
  const top = list ? (list[list.length - 1] ?? min) : max;
  const bottom = list ? (list[0] ?? min) : min;
  const canUp = !off && stepFrom(value, 1, min, max, allowed) !== value;
  const canDown = !off && stepFrom(value, -1, min, max, allowed) !== value;
  const showMax = (maxShortcut ?? top - bottom > 2) && !off;
  const name = typeof label === "string" ? label : "amount";
  const atMax = !off && value >= top && !!maxReason;
  const atMin = !off && value <= bottom && value > 0 && !!minReason;
  return (
    <div className={cx(classes.row, dense && classes.dense, off && classes.off, value > 0 && classes.on)}>
      {icon && <span className={classes.icon}>{icon}</span>}
      <span className={classes.text}>
        <span className={classes.label}>{label}</span>
        {disabledReason ? (
          <span className={classes.reason}>{disabledReason}</span>
        ) : atMax ? (
          <span className={classes.reason}>{maxReason}</span>
        ) : atMin ? (
          <span className={classes.reason}>{minReason}</span>
        ) : (
          hint && <span className={classes.hint}>{hint}</span>
        )}
      </span>
      <span className={classes.stepper}>
        <UnstyledButton
          className={classes.step}
          onClick={(e: MouseEvent) => onChange(e.shiftKey ? bottom : stepFrom(value, -1, min, max, allowed))}
          disabled={!canDown}
          aria-label={`Fewer ${name}`}
          title={!canDown && !off ? minReason : undefined}
        >
          <IconMinus size={12} />
        </UnstyledButton>
        <span className={classes.value} role="status" aria-label={`${name}: ${value}`}>
          {value}
          {unit && <span className={classes.unit}>{unit}</span>}
        </span>
        <UnstyledButton
          className={classes.step}
          onClick={(e: MouseEvent) => onChange(e.shiftKey ? top : stepFrom(value, 1, min, max, allowed))}
          disabled={!canUp}
          aria-label={`More ${name}`}
          title={!canUp && !off ? maxReason : undefined}
        >
          <IconPlus size={12} />
        </UnstyledButton>
        {showMax && (
          <UnstyledButton className={classes.max} onClick={() => onChange(top)} disabled={value >= top} aria-label={`All ${name}`}>
            Max
          </UnstyledButton>
        )}
      </span>
    </div>
  );
}

/** A running total under a set of quantities: "Total 7 votes", optionally with a from → to readout. */
export function QuantityTotal({ label, value, unit, detail }: { label: string; value: ReactNode; unit?: string; detail?: ReactNode }) {
  return (
    <div className={classes.total}>
      <span className={classes.totalLabel}>{label}</span>
      {detail && <span className={classes.totalDetail}>{detail}</span>}
      <span className={classes.totalValue}>
        {value}
        {unit && <span className={classes.unit}>{unit}</span>}
      </span>
    </div>
  );
}

/** The one confirm of a quantity panel: says what it will do; when it cannot, says why next to it. */
export function QuantityConfirm({
  label,
  onConfirm,
  disabledReason,
  busy,
  secondary,
}: {
  label: string;
  onConfirm: () => void;
  disabledReason?: string;
  busy?: boolean;
  /** Quieter actions next to it (Reset, Change outcome). */
  secondary?: ReactNode;
}) {
  return (
    <div className={classes.confirmRow}>
      <UnstyledButton className={classes.confirm} onClick={onConfirm} disabled={!!disabledReason || busy}>
        {label}
      </UnstyledButton>
      {disabledReason && <span className={classes.reason}>{disabledReason}</span>}
      <span className={classes.grow} />
      {secondary}
    </div>
  );
}

/** A quiet text action next to the confirm (Reset, Change outcome). */
export function QuantityLink({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <UnstyledButton className={classes.link} onClick={onClick} disabled={disabled}>
      {children}
    </UnstyledButton>
  );
}

/**
 * While a run started by a quantity panel presses the bot's buttons: what it is doing ("Exhausting Arc Prime, 2/5").
 * `null` when no run of `keyPrefix` is going (then the error of the last run, if any, is the caller's to show via
 * `RunError`).
 */
export function RunProgress({ keyPrefix }: { keyPrefix: string }) {
  const runner = useRunner();
  if (!runner.running?.startsWith(keyPrefix)) return null;
  return (
    <div className={classes.progress} role="status">
      <Loader size={14} color="currentColor" />
      <span>{runner.label || "Working"}</span>
      {runner.total > 1 && (
        <span className={classes.progressCount}>
          {runner.step}/{runner.total}
        </span>
      )}
    </div>
  );
}

/** The last run's error, if it failed. */
export function RunError() {
  const error = useRunner((s) => s.error);
  if (!error) return null;
  return <span className={classes.error}>Did not go through: {error}</span>;
}

/** Whether a quantity run with this key prefix is pressing buttons now. */
export function useRunning(keyPrefix: string) {
  return useRunner((s) => !!s.running?.startsWith(keyPrefix));
}

/** Whether any run is pressing buttons (freeze every panel's controls). */
export function useAnyRunning() {
  return useRunner((s) => !!s.running && Date.now() - s.startedAt < 60_000);
}
