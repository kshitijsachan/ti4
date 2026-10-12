import { Button } from "@mantine/core";
import type { CombatBombard, UnitsRemove } from "../../../../../shim/src/engine/kinds/combat";
import { holderName, live, unitName, type RendererProps } from "./types";
import classes from "./combat.module.css";

const SOURCE_NAMES: Record<string, string> = { plasmascoring: "Plasma Scoring die", argentcommander: "Argent commander die" };
const sourceName = (source: string, galvanized: boolean) => `${galvanized ? "Galvanized " : ""}${SOURCE_NAMES[source] ?? unitName(source)}`;

/**
 * BOMBARDMENT target step: the current assignment (engine progress, from the stored assignment) and the
 * assign / unassign moves; Done rolls.
 */
export function CombatBombardPanel({ decision: d, answer }: RendererProps<CombatBombard>) {
  const assigned = (d.progress?.accumulated.assigned ?? []) as { source: string; planet: string; galvanized: boolean }[];
  const options = d.options.filter(live);
  return (
    <div className={classes.panel}>
      <div className={classes.head}>Bombardment targets</div>
      {assigned.length > 0 && (
        <ul>
          {assigned.map((a, i) => (
            <li key={i}>
              {sourceName(a.source, a.galvanized)} → {holderName(a.planet)}
            </li>
          ))}
        </ul>
      )}
      <div className={classes.actions}>
        {options.map((o) => {
          const v = o.value!;
          if (v.op === "done")
            return (
              <Button key={o.id} size="xs" onClick={() => answer(o.id)}>
                Roll bombardment
              </Button>
            );
          return (
            <Button key={o.id} size="xs" variant={v.op === "assign" ? "default" : "subtle"} onClick={() => answer(o.id)}>
              {v.op === "assign" ? "Assign" : "Unassign"} {sourceName(v.source, v.galvanized)} {v.op === "assign" ? "to" : "from"} {holderName(v.planet)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

const ASSIGN_TITLES: Record<string, string> = {
  remove: "Remove excess units",
  bombardment: "Assign bombardment hits",
  afb: "Assign anti-fighter barrage hits",
  pds: "Assign space cannon hits",
  spacecombat: "Assign space combat hits",
  groundcombat: "Assign ground combat hits",
  combat: "Assign hits",
};

/** Opener of the per-unit removal menu (fleet pool / capacity, rift, hits taken outside the combat controls). */
export function UnitsRemovePanel({ decision: d, answer }: RendererProps<UnitsRemove>) {
  const options = d.options.filter(live);
  const open = options.find((o) => o.value?.action === "open");
  const type = open?.value?.assignType ?? "remove";
  return (
    <div className={classes.panel}>
      <div className={classes.head}>{ASSIGN_TITLES[type] ?? "Remove units"}</div>
      <div className={classes.actions}>
        {options.map((o) => (
          <Button key={o.id} size="xs" variant={o.value!.action === "open" ? "filled" : "default"} onClick={() => answer(o.id)}>
            {o.value!.action === "open" ? `Choose units${o.value!.tile ? ` in ${o.value!.tile}` : ""}` : "Done"}
          </Button>
        ))}
      </div>
    </div>
  );
}
