import { useMemo } from "react";
import { ActionIcon, Button } from "@mantine/core";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import type { CombatHits, CombatHitsValue } from "../../../../../shim/src/engine/kinds/combat";
import type { Option } from "../../../../../shim/src/engine/types";
import { assigned, planProblem, rowKey, suggestPlan, toEntries, type PlanRow } from "./plan";
import { holderName, live, me, unitName, type RendererProps } from "./types";
import { ineligibleUnits } from "./combatView";
import classes from "./combat.module.css";
import { DecisionFooter } from "../../ui/Popup";
import { useDecisionState } from "../../draftState";

type Auto = Extract<CombatHitsValue, { action: "auto" }>;

const SOURCE: Record<string, string> = {
  space: "space combat",
  ground: "ground combat",
  afb: "anti-fighter barrage",
  spacecannonoffence: "space cannon",
};

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className={classes.stepper}>
      {label}
      <ActionIcon size="xs" variant="subtle" disabled={value <= 0} onClick={() => onChange(value - 1)} aria-label={`${label} one fewer`}>
        <IconMinus size={12} />
      </ActionIcon>
      <span className={classes.stepValue}>{value}</span>
      <ActionIcon size="xs" variant="subtle" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`${label} one more`}>
        <IconPlus size={12} />
      </ActionIcon>
    </span>
  );
}

function Row({ row, onChange }: { row: PlanRow; onChange: (r: PlanRow) => void }) {
  const u = row.unit;
  const undamaged = u.count - u.damaged;
  return (
    <div className={classes.row}>
      <span>
        {u.count} {unitName(u.unit)}
        {u.damaged > 0 && <span className={classes.warn}> ({u.damaged} damaged)</span>}
        {u.holder !== "space" && <span className={classes.sub}> on {holderName(u.holder)}</span>}
      </span>
      {u.sustain ? (
        <Stepper label="Sustain" value={row.sustain} max={undamaged - row.destroy} onChange={(v) => onChange({ ...row, sustain: v })} />
      ) : (
        <span />
      )}
      <span className={classes.actions}>
        <Stepper label="Destroy" value={row.destroy} max={undamaged - row.sustain} onChange={(v) => onChange({ ...row, destroy: v })} />
        {u.damaged > 0 && <Stepper label="Damaged" value={row.destroyDamaged} max={u.damaged} onChange={(v) => onChange({ ...row, destroyDamaged: v })} />}
      </span>
    </div>
  );
}

/**
 * Hits I must assign: how many and from what, my units there with Sustain / Destroy steppers (the engine's usual
 * choice prefilled), then Auto-assign or Assign (one call; the engine checks the plan against the hits owed).
 */
export function CombatHitsPanel({ decision: d, state, answer }: RendererProps<CombatHits>) {
  const self = me(state);
  const options = d.options.filter(live).filter((o) => !o.id.includes("dummyPlayerSpoof"));
  /* BOMBARDMENT hits have no auto option: their manual option carries hits / planet / units, answered by a plan. */
  const bombard = options.find(
    (o) => o.value?.action === "assign_manual" && typeof o.value.hits === "number" && !!o.value.units && !!o.value.holder,
  ) as Option<Extract<CombatHitsValue, { action: "assign_manual" }>> | undefined;
  const autoOpt = (options.find((o) => o.value?.action === "auto") ??
    (bombard
      ? {
          ...bombard,
          value: { action: "auto", tile: bombard.value!.tile, holder: bombard.value!.holder!, source: "ground", hits: bombard.value!.hits!, units: bombard.value!.units!, sustainCancels: bombard.value!.sustainCancels ?? 1 },
        }
      : undefined)) as Option<Auto> | undefined;
  const auto = autoOpt?.value ?? null;
  const isBombard = !!bombard && autoOpt?.id === bombard.id;
  const cancels = options.filter((o) => o.value?.action === "cancel");
  const initial = useMemo(() => (auto ? suggestPlan(auto.units, auto.hits, auto.sustainCancels) : []), [auto]);
  const [rows, setRows] = useDecisionState<PlanRow[]>(d.id, "rows", initial);
  const mineToAnswer = d.target?.userId === self?.userId;

  if (!auto || !autoOpt) return <p className={classes.note}>Hits to assign.</p>;
  const owner = state?.players.find((p) => p.userId === d.target?.userId)?.userName ?? d.target?.faction ?? "?";
  const problem = planProblem(rows, auto.hits, auto.sustainCancels);
  const total = assigned(rows, auto.sustainCancels);
  const update = (r: PlanRow) => setRows((rs) => rs.map((x) => (rowKey(x.unit) === rowKey(r.unit) ? r : x)));

  return (
    <div className={classes.panel}>
      <div className={classes.head}>
        <span className={classes.mono}>{auto.hits}</span> hit{auto.hits === 1 ? "" : "s"} from {SOURCE[auto.source] ?? auto.source}
        {!!auto.cancelled && <span className={classes.sub}>{auto.cancelled} cancelled (Shields Holding)</span>}
        <span className={classes.sub}>
          {mineToAnswer ? "yours to assign" : `${owner} assigns`} · {auto.tile}
        </span>
      </div>
      {!mineToAnswer && <p className={classes.note}>Waiting for {owner} to assign the hits.</p>}
      {mineToAnswer && (
        <>
          <div className={classes.rows}>
            {rows.map((r) => (
              <Row key={rowKey(r.unit)} row={r} onChange={update} />
            ))}
            {/* My other units there, greyed with why they cannot take these hits (never hidden). */}
            {ineligibleUnits(state, auto.tile, auto.holder, auto.source, self?.userId ?? null).map((u) => (
              <div key={`off-${u.holder}/${u.unit}`} className={cx(classes.row, classes.rowOff)} data-hit-ineligible={u.unit}>
                <span>
                  {u.count} {unitName(u.unit)}
                  {u.holder !== "space" && <span className={classes.sub}> on {holderName(u.holder)}</span>}
                </span>
                <span />
                <span className={classes.reason}>{u.reason}</span>
              </div>
            ))}
          </div>
          <p className={cx(classes.status, problem ? classes.warn : classes.good)}>
            <span className={classes.mono}>
              {total}/{auto.hits}
            </span>{" "}
            assigned{problem ? ` — ${problem}` : ""}
          </p>
          <DecisionFooter>
            <div className={classes.actions}>
              <Button size="xs" disabled={!!problem} onClick={() => answer({ action: "combat-plan", body: { plan: toEntries(rows) } })}>
                Assign
              </Button>
              {/* Auto-assign would assign every hit on the buttons, cancelled ones included: the engine refuses it then. */}
              {!isBombard && (
                <Button size="xs" variant="default" disabled={!!auto.cancelled} onClick={() => answer(autoOpt.id)} data-combat-auto>
                  Auto-assign
                </Button>
              )}
              <Button size="xs" variant="subtle" onClick={() => setRows(initial)}>
                Reset
              </Button>
              {auto.hits > 0 && cancels.map((o) => (
                <Button key={o.id} size="xs" variant="subtle" onClick={() => answer(o.id)}>
                  Cancel a hit (ability)
                </Button>
              ))}
            </div>
          </DecisionFooter>
        </>
      )}
    </div>
  );
}
