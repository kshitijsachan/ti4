import { UnstyledButton } from "@mantine/core";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import type { GameState, Option, PlayerState } from "../../../../../shim/src/engine/types";
import classes from "./production.module.css";

/** Whole-decision answer: the commit option plus the typed payload the engine executes atomically. */
export type ProductionAnswer = string | ({ optionId: string; payload: Record<string, unknown> } & Record<string, unknown>);

export type AreaRendererProps<D> = {
  decision: D;
  state: GameState | null;
  answer: (optionIdOrPayload: ProductionAnswer) => void;
  pendingOptionId?: string | null;
};

export function selfOf(state: GameState | null): PlayerState | undefined {
  return state?.players.find((p) => p.self);
}

/** Options outside the kind's vocabulary (agents, abilities the engine offers alongside): plain buttons. */
export function ExtraOptions({
  options,
  answer,
  busy,
}: {
  options: Option<unknown>[];
  answer: (id: string) => void;
  busy: boolean;
}) {
  if (!options.length) return null;
  return (
    <div className={classes.extras}>
      {options.map((o) => (
        <UnstyledButton key={o.id} className={classes.extra} onClick={() => answer(o.id)} disabled={busy || o.disabled}>
          {o.label}
        </UnstyledButton>
      ))}
    </div>
  );
}

export function Meter({ have, need, unit }: { have: number; need: number | null; unit: string }) {
  if (need === null) {
    return (
      <div className={classes.meterLine}>
        <span>
          Selected <span className={classes.num}>{have}</span> {unit}
        </span>
        <span className={classes.muted}>you choose how much</span>
      </div>
    );
  }
  const pct = need <= 0 ? 100 : Math.min(100, (have / need) * 100);
  const state = have < need ? "short" : have === need ? "exact" : "over";
  return (
    <div className={classes.meter}>
      <div className={classes.meterLine}>
        <span>
          <span className={classes.num}>{have}</span> of <span className={classes.num}>{need}</span> {unit}
        </span>
        <span className={classes[state]}>{state === "short" ? `${need - have} short` : state === "exact" ? "exact" : `${have - need} over`}</span>
      </div>
      <div className={classes.bar}>
        <div className={cx(classes.fill, state !== "short" && classes.covered)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Stepper({
  label,
  value,
  max,
  step = 1,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className={classes.stepper}>
      <span className={classes.stepLabel}>{label}</span>
      {hint && <span className={classes.muted}>{hint}</span>}
      <div className={classes.stepControls}>
        <UnstyledButton className={classes.stepBtn} aria-label={`less ${label}`} onClick={() => onChange(Math.max(0, value - step))} disabled={disabled || value <= 0}>
          <IconMinus size={12} />
        </UnstyledButton>
        <span className={classes.num}>{value}</span>
        <UnstyledButton className={classes.stepBtn} aria-label={`more ${label}`} onClick={() => onChange(Math.min(max, value + step))} disabled={disabled || value + step > max}>
          <IconPlus size={12} />
        </UnstyledButton>
      </div>
    </div>
  );
}
