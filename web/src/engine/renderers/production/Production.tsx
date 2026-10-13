import { planetName } from "../tactical/names";
import { UnstyledButton } from "@mantine/core";
import type { HolderName, Option, TilePosition, UnitId } from "../../../../../shim/src/engine/types";
import type { ProductionPayload, ProductionPlaceValue, ProductionProduce, ProductionValue } from "../../../../../shim/src/engine/kinds/production";
import { capExcludes, capRoom, isPlacement, isProductionDone } from "./model";
import { ExtraOptions, Stepper, type AreaRendererProps } from "./shared";
import classes from "./production.module.css";
import { useDecisionState } from "../../draftState";
import { DecisionFooter } from "../../ui/Popup";

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
} satisfies Partial<Record<UnitId, string>>;

/** remaining: units of this type left in reinforcements (component limit), null = not limited. */
type Line = { key: string; unit: UnitId; holder: HolderName; tile: TilePosition | null; cost: number | null; step: number; remaining: number | null; fleetRoom: number | null };

/** Tiles where the ships picked go over the fleet room the engine reported (tile, ships over). */
function fleetOver(lines: Line[], counts: Record<string, number>): [string, number][] {
  const byTile = new Map<string, { room: number; picked: number }>();
  for (const l of lines) {
    if (l.fleetRoom === null || !l.tile) continue;
    const t = byTile.get(l.tile) ?? { room: l.fleetRoom, picked: 0 };
    t.picked += counts[l.key] ?? 0;
    byTile.set(l.tile, t);
  }
  return [...byTile.entries()].filter(([, t]) => t.picked > 0 && t.picked > t.room).map(([tile, t]) => [tile, t.picked - t.room] as [string, number]);
}

/** One line per unit + place; the engine's "2 at once" buttons only change the step, not the line. */
function linesOf(options: Option<ProductionValue>[]): Line[] {
  const byKey = new Map<string, Line>();
  for (const o of options) {
    if (o.disabled || !isPlacement(o.value)) continue;
    const v: ProductionPlaceValue = o.value;
    const key = `${v.unit}@${v.holder}@${v.tile ?? ""}`;
    const prev = byKey.get(key);
    const perUnit = v.cost === null ? null : v.cost;
    if (!prev) byKey.set(key, { key, unit: v.unit, holder: v.holder, tile: v.tile, cost: perUnit, step: 1, remaining: v.remaining ?? null, fleetRoom: v.fleetRoom ?? null });
    else if (prev.cost === null) prev.cost = perUnit;
  }
  /* Ground forces: onto a planet first, into space after (both are legal; the planet is the usual choice). */
  const rank = (l: Line) => (GROUND.has(l.unit) ? (l.holder === "space" ? 2 : 1) : 0);
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b));
}

/** Ground forces may be produced onto a planet or into space (carried by ships); ships only say their name. */
const GROUND = new Set<string>(["gf", "mf"]);

function lineLabel(l: Line): string {
  const name = UNIT_NAME[l.unit] ?? l.unit;
  if (l.holder !== "space") return `${name} on ${planetName(l.holder)}`;
  return GROUND.has(l.unit) ? `${name} in space (on a ship)` : name;
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
  const [counts, setCounts] = useDecisionState<Record<string, number>>(decision.id, "counts", {});
  const busy = !!pendingOptionId;

  const already = done?.unitCount ?? 0;
  const limit = done?.productionLimit ?? null;
  const picked = lines.reduce((n, l) => n + (counts[l.key] ?? 0), 0);
  const cost = Math.ceil(lines.reduce((n, l) => n + (counts[l.key] ?? 0) * (l.cost ?? 0), 0) + (done?.cost ?? 0));
  // A capped production (Umbat, riders, Maximus, Availyn, Flaah Hyphae): the engine refuses anything past it.
  const cap = done?.limit ?? null;
  const pickedCost = lines.reduce((n, l) => n + (counts[l.key] ?? 0) * (l.cost ?? 0), 0);
  const capUnits = already + picked;
  const capSpent = (done?.cost ?? 0) + pickedCost;
  const overCap =
    !!cap &&
    (capUnits > cap.maxUnits ||
      (cap.maxTotalCost != null && capSpent > cap.maxTotalCost + 1e-6) ||
      lines.some((l) => (counts[l.key] ?? 0) > 0 && capExcludes(cap, l.unit, l.cost) !== null));
  const over = (limit !== null && already + picked > limit) || overCap;
  const room = limit === null ? 20 : Math.max(0, limit - already - picked);
  /* Fleet pool: ships picked beyond the room left in their system are allowed (removed afterwards), but said. */
  const fleetWarnings = fleetOver(lines, counts).map(([tile, n]) => `This will exceed your fleet pool in ${tile} by ${n}: you will have to remove ${n === 1 ? "a ship" : `${n} ships`} before the turn ends.`);
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
          {cap ? `${cap.label} · ${capUnits} / ${cap.maxUnits} · ` : ""}
          {limit === null ? "" : `Production ${already + picked} / ${limit} · `}cost {cost} resources
        </span>
      </div>
      <div className={classes.lines}>
        {lines.map((l) => {
          const n = counts[l.key] ?? 0;
          const excluded = capExcludes(cap, l.unit, l.cost);
          // Component limit: the same unit picked on other lines (ground forces on two planets) shares what is left.
          const elsewhere = lines.reduce((t, o) => t + (o.key !== l.key && o.unit === l.unit ? (counts[o.key] ?? 0) : 0), 0);
          const left = l.remaining === null ? Infinity : Math.max(0, l.remaining - elsewhere - n);
          const fits = excluded ? 0 : Math.min(room, capRoom(cap, l.cost, capUnits, capSpent), left);
          const noneLeft = !excluded && l.remaining !== null && l.remaining - elsewhere <= 0;
          const each = l.cost === null ? undefined : `${l.cost} each`;
          return (
            <Stepper
              key={l.key}
              label={lineLabel(l)}
              value={n}
              max={excluded ? n : n + fits}
              onChange={(v) => setCounts((c) => ({ ...c, [l.key]: v }))}
              hint={excluded && cap ? `${cap.label.split(":")[0]}: ${excluded}` : noneLeft ? "none left in reinforcements" : each}
              disabled={busy || ((!!excluded || noneLeft) && n === 0)}
            />
          );
        })}
      </div>
      {fleetWarnings.map((w) => (
        <span key={w} className={classes.short}>
          {w}
        </span>
      ))}
      {over && <span className={classes.short}>{overCap && cap ? `Over the cap — ${cap.label}.` : `Over the production limit of ${limit}.`}</span>}
      <ExtraOptions options={extras} answer={answer} busy={busy} />
      <div className={classes.row}>
        <UnstyledButton className={classes.link} onClick={() => commit([])} disabled={busy || !doneOpt}>
          Build nothing
        </UnstyledButton>
      </div>
      <DecisionFooter>
        <UnstyledButton className={classes.commit} onClick={produce} disabled={busy || !doneOpt || over || picked === 0}>
          {picked ? `Produce ${picked} unit${picked === 1 ? "" : "s"} · ${cost} resources` : "Choose units"}
        </UnstyledButton>
      </DecisionFooter>
    </div>
  );
}
