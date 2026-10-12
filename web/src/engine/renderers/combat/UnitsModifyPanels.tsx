import { Button } from "@mantine/core";
import type { CombatAutomate, CombatModifier, UnitsModify } from "../../../../../shim/src/engine/kinds/combat";
import type { GameState } from "../../../../../shim/src/engine/types";
import { holderName, live, me, playerName, unitName, type RendererProps } from "./types";
import classes from "./combat.module.css";

/** My units in a system, from GameState (never from labels): "2 Carrier, 3 Infantry (planet)". */
function myUnits(state: GameState | null, tile: string): string {
  const self = me(state);
  const t = state?.tiles.find((x) => x.position === tile);
  if (!self?.faction || !t) return "";
  return t.holders
    .flatMap((h) => h.units.filter((u) => u.owner === self.faction && u.count > 0).map((u) => `${u.count} ${unitName(u.unit)}${h.name !== "space" ? ` (${holderName(h.name)})` : ""}`))
    .join(", ");
}

/**
 * Modify Units (manual board edit): pick a system (yours, or any with "Show all systems"), then add units (opens the
 * production menu) or remove / damage them (opens the per-unit menu).
 */
export function UnitsModifyPanel({ decision: d, state, answer }: RendererProps<UnitsModify>) {
  const options = d.options.filter(live);
  const tiles = options.filter((o) => o.value?.action === "tile");
  const steps = options.filter((o) => o.value?.action === "build" || o.value?.action === "remove");
  const all = options.find((o) => o.value?.action === "all_tiles");
  const done = options.find((o) => o.value?.action === "done");
  const tile = steps[0]?.value && "tile" in steps[0].value ? steps[0].value.tile : null;
  return (
    <div className={classes.panel}>
      <div className={classes.head}>
        Modify units
        {tile && <span className={classes.sub}>{tile}</span>}
      </div>
      {tile && <p className={classes.note}>{myUnits(state, tile) || "No units of yours here."}</p>}
      {tiles.length > 0 && <p className={classes.note}>Choose the system.</p>}
      <div className={classes.actions}>
        {steps.map((o) => (
          <Button key={o.id} size="xs" variant={o.value!.action === "build" ? "filled" : "light"} color={o.value!.action === "remove" ? "red" : undefined} onClick={() => answer(o.id)}>
            {o.value!.action === "build" ? "Add units" : "Remove or damage units"}
          </Button>
        ))}
        {tiles.map((o) => {
          const v = o.value as Extract<UnitsModify["options"][number]["value"], { action: "tile" }>;
          const units = myUnits(state, v.tile);
          return (
            <Button key={o.id} size="xs" variant="default" title={units || undefined} onClick={() => answer(o.id)}>
              {v.tile}
              {v.units > 0 ? ` · ${v.units} unit${v.units === 1 ? "" : "s"}` : ""}
            </Button>
          );
        })}
        {all && (
          <Button size="xs" variant="subtle" onClick={() => answer(all.id)}>
            Show all systems
          </Button>
        )}
        {done && (
          <Button size="xs" variant="subtle" onClick={() => answer(done.id)}>
            Close
          </Button>
        )}
      </div>
    </div>
  );
}

/** Automate the whole ground combat: a combatant's vote, or my confirmation of my opponent's vote. */
export function CombatAutomatePanel({ decision: d, state, answer }: RendererProps<CombatAutomate>) {
  const self = me(state);
  const options = d.options.filter(live);
  return (
    <div className={classes.panel}>
      <div className={classes.head}>Automate ground combat</div>
      {options.map((o) => {
        const v = o.value!;
        const mine = !!self?.faction && v.factions.includes(self.faction);
        const vs = v.factions.map((f) => playerName(state, f)).join(" vs ");
        return (
          <div key={o.id} className={classes.row}>
            <span>
              {holderName(v.planet)} <span className={classes.sub}>{vs}</span>
            </span>
            <span className={classes.note}>{v.confirmed ? "Your opponent wants to roll the whole combat at once." : "Both sides must agree."}</span>
            <Button size="xs" variant={v.confirmed ? "filled" : "default"} disabled={!mine} onClick={() => answer(o.id)}>
              {v.confirmed ? "Agree and automate" : "Propose automating"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

const MODIFIER_NAMES: Record<string, string> = { sc: "Supercharge" };

/** Apply a temporary combat modifier (an action card just played, Supercharge) to my next combat roll. */
export function CombatModifierPanel({ decision: d, answer }: RendererProps<CombatModifier>) {
  const options = d.options.filter(live);
  return (
    <div className={classes.panel}>
      <div className={classes.head}>Combat modifier</div>
      <p className={classes.note}>Applies to your next combat roll.</p>
      <div className={classes.actions}>
        {options.map((o) => (
          <Button key={o.id} size="xs" onClick={() => answer(o.id)}>
            Apply {MODIFIER_NAMES[o.value!.card] ?? o.value!.card}
            {o.value!.source === "action_cards" ? " (action card)" : ""}
          </Button>
        ))}
      </div>
    </div>
  );
}
