import { Button } from "@mantine/core";
import cx from "clsx";
import type { CombatAssignUnits, CombatRetreat } from "../../../../../shim/src/engine/kinds/combat";
import { holderName, live, unitName, type RendererProps } from "./types";
import classes from "./combat.module.css";

/**
 * The engine's manual assignment menu, one press per unit. The header reports hits owed and assigned so far from
 * the decision's progress (engine state), so it stays right across reloads.
 */
export function CombatAssignUnitsPanel({ decision: d, answer }: RendererProps<CombatAssignUnits>) {
  const p = d.progress;
  const owed = Number(p?.required.owed ?? NaN);
  const left = Number(p?.required.hits ?? NaN);
  const options = d.options.filter(live);
  const picks = options.filter((o) => o.value?.action === "sustain" || o.value?.action === "destroy");
  const rest = options.filter((o) => !picks.includes(o));
  return (
    <div className={classes.panel}>
      <div className={classes.head}>
        Assign hits
        {Number.isFinite(owed) && (
          <span className={cx(classes.sub, classes.mono)}>
            {owed - left}/{owed} assigned
          </span>
        )}
      </div>
      {p?.canCommit && <p className={cx(classes.status, classes.good)}>All hits assigned.</p>}
      <div className={classes.actions}>
        {picks.map((o) => {
          const v = o.value as Extract<CombatAssignUnits["options"][number]["value"], { action: "sustain" | "destroy" }>;
          return (
            <Button key={o.id} size="xs" variant={v.action === "sustain" ? "default" : "light"} color={v.action === "sustain" ? undefined : "red"} onClick={() => answer(o.id)}>
              {v.action === "sustain" ? "Sustain" : "Destroy"} {v.count} {v.damaged ? "damaged " : ""}
              {unitName(v.unit)}
              {v.holder !== "space" ? ` (${holderName(v.holder)})` : ""}
            </Button>
          );
        })}
        {rest.map((o) => (
          <Button key={o.id} size="xs" variant={o.value?.action === "done" ? "filled" : "subtle"} onClick={() => answer(o.id)}>
            {o.value?.action === "done" ? "Done" : o.value?.action === "destroy_all_ships" ? "Destroy all ships" : "Destroy all units"}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Retreat destination, then which ground forces come along. */
export function CombatRetreatPanel({ decision: d, answer }: RendererProps<CombatRetreat>) {
  const options = d.options.filter(live);
  const ground = options.some((o) => o.value?.action === "retreat_ground");
  return (
    <div className={classes.panel}>
      <div className={classes.head}>{ground ? "Retreat ground forces" : "Retreat to"}</div>
      <div className={classes.actions}>
        {options.map((o) => {
          const v = o.value!;
          if (v.action === "retreat_to")
            return (
              <Button key={o.id} size="xs" variant="default" onClick={() => answer(o.id)}>
                {v.to}
              </Button>
            );
          if (v.action === "retreat_ground")
            return (
              <Button key={o.id} size="xs" variant="default" onClick={() => answer(o.id)}>
                {v.count} {unitName(v.unit)}
                {v.holder ? ` from ${holderName(v.holder)}` : ""}
              </Button>
            );
          return (
            <Button key={o.id} size="xs" onClick={() => answer(o.id)}>
              Done
            </Button>
          );
        })}
      </div>
    </div>
  );
}
