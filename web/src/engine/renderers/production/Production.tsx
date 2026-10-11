import { useState } from "react";
import { UnstyledButton } from "@mantine/core";
import type { Option } from "../../../../../shim/src/engine/types";
import type { ProductionPayload, ProductionPlaceValue, ProductionProduce, ProductionValue } from "../../../../../shim/src/engine/kinds/production";
import { isPlacement, isProductionDone } from "./model";
import { ExtraOptions, Stepper, type AreaRendererProps } from "./shared";
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

type Line = { key: string; unit: string; holder: string; tile: string | null; cost: number | null; step: number };

/** One line per unit + place; the engine's "2 at once" buttons only change the step, not the line. */
function linesOf(options: Option<ProductionValue>[]): Line[] {
  const byKey = new Map<string, Line>();
  for (const o of options) {
    if (o.disabled || !isPlacement(o.value)) continue;
    const v: ProductionPlaceValue = o.value;
    const key = `${v.unit}@${v.holder}@${v.tile ?? ""}`;
    const prev = byKey.get(key);
    const perUnit = v.cost === null ? null : v.cost;
    if (!prev) byKey.set(key, { key, unit: v.unit, holder: v.holder, tile: v.tile, cost: perUnit, step: 1 });
    else if (prev.cost === null) prev.cost = perUnit;
  }
  return [...byKey.values()];
}

/**
 * production.produce: how many of each unit where, against the production limit the engine applies, answered as
 * ONE payload (empty = build nothing); Done then opens the payment.
 */
export function ProductionRenderer({ decision, answer, pendingOptionId }: AreaRendererProps<ProductionProduce>) {
  const options = decision.options;
  const doneOpt = options.find((o) => isProductionDone(o.value));
  const done = doneOpt && isProductionDone(doneOpt.value) ? doneOpt.value : undefined;
  const lines = linesOf(options);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const busy = !!pendingOptionId;

  const already = done?.unitCount ?? 0;
  const limit = done?.productionLimit ?? null;
  const picked = lines.reduce((n, l) => n + (counts[l.key] ?? 0), 0);
  const cost = Math.ceil(lines.reduce((n, l) => n + (counts[l.key] ?? 0) * (l.cost ?? 0), 0) + (done?.cost ?? 0));
  const over = limit !== null && already + picked > limit;
  const room = limit === null ? 20 : Math.max(0, limit - already - picked);
  const extras = options.filter((o) => !o.value && !o.disabled);

  const commit = (units: ProductionPayload["units"]) => {
    if (!doneOpt) return;
    answer({ optionId: doneOpt.id, payload: { units } });
  };
  const produce = () => {
    if (over) return;
    commit(lines.filter((l) => counts[l.key]).map((l) => ({ unit: l.unit, count: counts[l.key], holder: l.holder, ...(l.tile ? { tile: l.tile } : {}) })));
  };

  return (
    <div className={classes.panel}>
      <div className={classes.head}>
        <span className={classes.title}>Produce units{done?.tile ? ` in ${done.tile}` : ""}</span>
        <span className={classes.muted}>
          {limit === null ? "" : `Production ${already + picked} / ${limit} · `}cost {cost} resources
        </span>
      </div>
      <div className={classes.lines}>
        {lines.map((l) => (
          <Stepper
            key={l.key}
            label={`${UNIT_NAME[l.unit] ?? l.unit}${l.holder === "space" ? "" : ` on ${l.holder}`}`}
            value={counts[l.key] ?? 0}
            max={(counts[l.key] ?? 0) + room}
            onChange={(n) => setCounts((c) => ({ ...c, [l.key]: n }))}
            hint={l.cost === null ? undefined : `${l.cost} each`}
            disabled={busy}
          />
        ))}
      </div>
      {over && <span className={classes.short}>Over the production limit of {limit}.</span>}
      <ExtraOptions options={extras} answer={answer} busy={busy} />
      <div className={classes.row}>
        <UnstyledButton className={classes.link} onClick={() => commit([])} disabled={busy || !doneOpt}>
          Build nothing
        </UnstyledButton>
      </div>
      <UnstyledButton className={classes.commit} onClick={produce} disabled={busy || !doneOpt || over || picked === 0}>
        {picked ? `Produce ${picked} unit${picked === 1 ? "" : "s"} · ${cost} resources` : "Choose units"}
      </UnstyledButton>
    </div>
  );
}
