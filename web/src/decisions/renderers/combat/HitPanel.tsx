import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import { cdnImage } from "@/entities/data/cdnImage";
import { getColorAlias } from "@/entities/lookup/colors";
import { describePlan, planTotal, unitName, type Plan, type UnitRowModel } from "./units";
import { useCombatRun } from "./run";
import classes from "./combat.module.css";

function Stepper({ label, value, max, onChange, busy, title }: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  busy?: boolean;
  title?: string;
}) {
  const off = busy || max <= 0;
  return (
    <span className={cx(classes.stepCell, off && value === 0 && classes.stepOff, value > 0 && classes.stepOn)} title={title}>
      <span className={classes.stepLabel}>{label}</span>
      <span className={classes.stepper}>
        <UnstyledButton className={classes.step} onClick={() => onChange(value - 1)} disabled={busy || value <= 0} aria-label={`${label} one fewer`}>
          <IconMinus size={12} />
        </UnstyledButton>
        <span className={classes.stepValue} aria-label={`${label}: ${value}`}>
          {value}
        </span>
        <UnstyledButton className={classes.step} onClick={() => onChange(value + 1)} disabled={busy || value >= max} aria-label={`${label} one more`}>
          <IconPlus size={12} />
        </UnstyledButton>
      </span>
    </span>
  );
}

/** Unit art with its count, damaged ones marked. */
export function UnitTile({ unit, color, count, damaged, lost }: { unit: string; color?: string; count: number; damaged?: number; lost?: number }) {
  const alias = getColorAlias(color);
  return (
    <span className={classes.tile} title={`${count} × ${unitName(unit)}${damaged ? `, ${damaged} damaged` : ""}`}>
      <img src={cdnImage(`/units/${alias}_${unit}.png`)} alt="" className={classes.tileImg} draggable={false} />
      <span className={classes.tileCount}>{count}</span>
      {!!damaged && <span className={classes.tileDamaged} title={`${damaged} damaged`}>{damaged}</span>}
      {!!lost && <span className={classes.tileLost}>−{lost}</span>}
    </span>
  );
}

export type HitPanelProps = {
  rows: UnitRowModel[];
  color?: string;
  /** Hits to assign exactly; undefined: remove as many as the player likes. */
  hits?: number;
  /** "combat": sustain or destroy; "remove": take units off the board (no sustain). */
  mode: "combat" | "remove";
  initial: Plan;
  /** Planet names, for units not in space. */
  holderNames?: Record<string, string>;
  /** Heading ("Assign 4 hits", "Remove units"). */
  heading: string;
  note?: string;
  runKey: string;
  onConfirm: (plan: Plan) => void;
  /** At least this many must go (fleet pool / capacity overflow). */
  minimum?: number;
  /** The loss column's word ("Destroy", "Remove", "Retreat"). */
  verb?: string;
};

/**
 * Hits as a plan, not a ladder of buttons: one tile per kind of unit with "Sustain" and "Destroy" (or "Remove")
 * steppers, prefilled with the cheapest assignment, and one Confirm that presses the bot's buttons in order.
 */
export function HitPanel({ rows, color, hits, mode, initial, holderNames, heading, note, runKey, onConfirm, minimum, verb: verbWord }: HitPanelProps) {
  const [plan, setPlan] = useState<Plan>(initial);
  const run = useCombatRun();
  const busy = !!run.running;
  const total = planTotal(plan);
  const left = hits !== undefined ? hits - total : undefined;
  const capacity = rows.reduce((n, r) => n + r.count + (r.canSustain && mode === "combat" ? r.count - r.damaged : 0), 0);
  /* Fewer units than hits: everything goes, and that is all that can be assigned. */
  const needed = hits !== undefined ? Math.min(hits, capacity) : undefined;
  const set = (key: string, field: "sustain" | "destroy", v: number) =>
    setPlan((p) => ({ ...p, [key]: { sustain: p[key]?.sustain ?? 0, destroy: p[key]?.destroy ?? 0, [field]: Math.max(0, v) } }));
  const room = (extra: number) => (left === undefined ? extra : Math.min(extra, left));
  const Verb = verbWord ?? (mode === "remove" ? "Remove" : "Destroy");
  const verb = Verb.toLowerCase();
  const summary = describePlan(plan, rows, verb);
  const anySustain = rows.some((r) => r.canSustain);

  let reason: string | undefined;
  if (needed !== undefined && total < needed) reason = `${needed - total} more to assign`;
  else if (needed !== undefined && total > needed) reason = `${total - needed} too many`;
  else if (minimum !== undefined && total < minimum) reason = `Remove at least ${minimum}`;
  else if (total === 0) reason = mode === "remove" ? `Pick the units to ${verb}` : "Nothing assigned";

  if (run.running === runKey) {
    return (
      <div className={classes.progress} role="status">
        <Loader size={14} color="currentColor" />
        <span>{run.label || "Working"}</span>
        {run.total > 1 && <span className={classes.mono}>{run.step}/{run.total}</span>}
      </div>
    );
  }

  return (
    <div className={classes.hitPanel}>
      <div className={classes.hitHead}>
        <span className={classes.hitTitle}>{heading}</span>
        {left !== undefined && (
          <span className={cx(classes.hitLeft, left === 0 && classes.good, left < 0 && classes.warn)}>
            {left > 0 ? `${left} left` : left === 0 ? "all assigned" : `${-left} too many`}
          </span>
        )}
      </div>
      {note && <p className={classes.note}>{note}</p>}
      <div className={classes.rows}>
        {rows.map((r) => {
          const p = plan[r.key] ?? { sustain: 0, destroy: 0 };
          const healthy = r.count - r.damaged;
          const where = r.holder === "space" ? undefined : (holderNames?.[r.holder] ?? r.holder);
          const meta = [where && `on ${where}`, r.damaged ? `${r.damaged} already damaged` : undefined].filter(Boolean).join(" · ");
          return (
            <div key={r.key} className={classes.unitRow}>
              <UnitTile unit={r.unit} color={color} count={r.count} damaged={r.damaged + p.sustain} lost={verbWord === "Retreat" ? undefined : p.destroy} />
              <span className={classes.unitText}>
                <span className={classes.unitName}>{unitName(r.unit, r.count)}</span>
                {meta && <span className={classes.unitMeta}>{meta}</span>}
              </span>
              {mode === "combat" && anySustain && !r.canSustain && (
                <span className={cx(classes.stepCell, classes.stepBlank)} aria-hidden>
                  <span className={classes.stepLabel}>Sustain</span>
                  <span className={classes.stepper}>
                    <span className={classes.step} />
                    <span className={classes.stepValue}>0</span>
                    <span className={classes.step} />
                  </span>
                </span>
              )}
              {mode === "combat" && anySustain && r.canSustain && (
                <Stepper
                  label="Sustain"
                  value={p.sustain}
                  max={r.canSustain ? Math.min(healthy, p.sustain + room(healthy - p.sustain)) : 0}
                  onChange={(v) => set(r.key, "sustain", v)}
                  busy={busy}
                  title={!r.canSustain ? "Cannot sustain damage" : healthy === 0 ? "All already damaged" : undefined}
                />
              )}
              <Stepper
                label={Verb}
                value={p.destroy}
                max={Math.min(r.count, p.destroy + room(r.count - p.destroy))}
                onChange={(v) => set(r.key, "destroy", v)}
                busy={busy}
              />
            </div>
          );
        })}
      </div>
      <div className={classes.confirmRow}>
        <UnstyledButton className={classes.confirm} onClick={() => onConfirm(plan)} disabled={!!reason || busy}>
          {reason ? (mode === "remove" ? `${Verb} units` : "Confirm hits") : `Confirm: ${summary}`}
        </UnstyledButton>
        {reason && <span className={classes.reason}>{reason}</span>}
        <UnstyledButton className={classes.link} onClick={() => setPlan(initial)} disabled={busy}>
          Reset
        </UnstyledButton>
      </div>
      {run.error && <span className={classes.error}>Did not go through: {run.error}</span>}
    </div>
  );
}
