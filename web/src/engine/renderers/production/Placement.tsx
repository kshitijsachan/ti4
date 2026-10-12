import { UnstyledButton } from "@mantine/core";
import type { CommoditiesGain, FreePlacementValue, ProductionPlace } from "../../../../../shim/src/engine/kinds/production";
import type { AreaRendererProps } from "./shared";
import classes from "./production.module.css";

const UNIT_NAME: Record<string, string> = {
  ws: "War Sun",
  fs: "Flagship",
  dn: "Dreadnought",
  cv: "Carrier",
  ca: "Cruiser",
  dd: "Destroyer",
  ff: "Fighter",
  gf: "Infantry",
  mf: "Mech",
  sd: "Space Dock",
  pd: "PDS",
};

function label(v: FreePlacementValue): string {
  if (v.op === "done") return "Done";
  const unit = UNIT_NAME[v.unit] ?? v.unit;
  return `${v.count > 1 ? `${v.count} ` : ""}${unit} ${v.holder === "space" ? `in ${v.tile ?? "space"}` : `on ${v.holder}`}`;
}

/** Free placements (Mitosis, Parasite, commanders, heroes, action cards): one press places the unit. */
export function PlacementRenderer({ decision, answer, pendingOptionId }: AreaRendererProps<ProductionPlace>) {
  const options = decision.options.filter((o) => !o.disabled && o.value);
  const free = options.some((o) => o.value!.op === "place" && o.value!.free);
  return (
    <div className={classes.panel}>
      <div className={classes.head}>
        <span className={classes.title}>{free ? "Place units" : "Produce a unit"}</span>
      </div>
      <div className={classes.lines}>
        {options.map((o) => (
          <UnstyledButton key={o.id} className={classes.link} onClick={() => answer(o.id)} disabled={!!pendingOptionId}>
            {label(o.value!)}
          </UnstyledButton>
        ))}
      </div>
    </div>
  );
}

/** Gain / convert commodities: one press. */
export function CommoditiesRenderer({ decision, answer, pendingOptionId }: AreaRendererProps<CommoditiesGain>) {
  const options = decision.options.filter((o) => !o.disabled && o.value);
  return (
    <div className={classes.panel}>
      <div className={classes.head}>
        <span className={classes.title}>Commodities</span>
      </div>
      <div className={classes.lines}>
        {options.map((o) => {
          const v = o.value!;
          const text = v.op === "done" ? "Done" : v.op === "gain" ? `Gain ${v.amount} commodit${v.amount === 1 ? "y" : "ies"}` : `Convert ${v.amount} commodit${v.amount === 1 ? "y" : "ies"} into trade goods`;
          return (
            <UnstyledButton key={o.id} className={classes.link} onClick={() => answer(o.id)} disabled={!!pendingOptionId}>
              {text}
            </UnstyledButton>
          );
        })}
      </div>
    </div>
  );
}
