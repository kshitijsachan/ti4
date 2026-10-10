import { UnstyledButton } from "@mantine/core";
import { getPlanetData } from "@/entities/lookup/planets";
import type { Decision } from "../../model/classify";
import { baseId, type Choice } from "../../model/controls";
import { useDecisionFocus } from "../../model/focus";
import type { RendererProps } from "../types";
import { HitPanel } from "./HitPanel";
import { useRunFlow, doneOf } from "./run";
import { suggestPlan, type UnitRowModel } from "./units";
import classes from "./combat.module.css";

const SPACE = /^retreatUnitsFrom_([^_]+)_([^_]+)/;
const GROUND = /^retreatGroundUnits_([^_]+)_([^_]+)_(\d+)_([a-z]+)_(.+)$/;
const GROUND_UNIT: Record<string, string> = { infantry: "gf", mech: "mf", pds: "pd", spacedock: "sd" };

/** "Please choose a system to move to" (retreat destinations) or "which ground forces you wish to retreat". */
export function isRetreatPrompt(d: Decision) {
  return d.choices.some((c) => SPACE.test(baseId(c.customId)) || GROUND.test(baseId(c.customId)));
}

/** Where my ships may retreat to: one card per legal destination (the bot only offers legal ones); hovering lights it on the map. */
export function RetreatPicker({ d, data, pressOn, pendingKey }: Pick<RendererProps, "d" | "data" | "pressOn" | "pendingKey">) {
  const setFocus = useDecisionFocus((s) => s.set);
  const space = d.choices.filter((c) => SPACE.test(baseId(c.customId)));
  if (!space.length) return <GroundRetreat d={d} data={data} />;
  const from = baseId(space[0].customId).match(SPACE)?.[1];
  const press = (c: Choice) => pressOn(d)(c);
  return (
    <div className={classes.stack}>
      <p className={classes.status}>
        <strong>Retreat</strong> — pick where your ships go. Only systems you may legally retreat to are listed (hover one to find it on the map).
      </p>
      <div className={classes.dests}>
        {space.map((c) => {
          const to = baseId(c.customId).match(SPACE)?.[2] ?? "";
          /* "Retreat to 307 (Moll Primus - Mentak)" → "Moll Primus - Mentak". */
          const rest = c.label.replace(/^retreat to\s*/i, "");
          const name = rest.match(/^\w+\s*\((.+)\)\s*$/)?.[1] ?? (rest || to);
          return (
            <UnstyledButton
              key={c.key}
              className={classes.dest}
              onClick={() => press(c)}
              disabled={!!pendingKey}
              onMouseEnter={() => setFocus(to, "hover", "Retreat here")}
              onMouseLeave={() => setFocus(from ?? null, "prompt", "Combat")}
              onFocus={() => setFocus(to, "hover", "Retreat here")}
            >
              <span className={classes.destName}>{name}</span>
              <span className={classes.destPos}>{to}</span>
            </UnstyledButton>
          );
        })}
      </div>
    </div>
  );
}

/** Which ground forces go along with the retreat: steppers per planet, then the bot's buttons pressed one by one. */
function GroundRetreat({ d, data }: Pick<RendererProps, "d" | "data">) {
  const runFlow = useRunFlow();
  const rows = new Map<string, UnitRowModel>();
  const ids = new Map<string, string>();
  for (const c of d.choices) {
    const m = baseId(c.customId).match(GROUND);
    if (!m) continue;
    const [, , , n, type, planet] = m;
    const unit = GROUND_UNIT[type] ?? type;
    const key = `${unit}@${planet}`;
    const live = data.web?.tileUnitData?.[m[1]]?.planets?.[planet]?.entities?.[data.me?.faction ?? ""]?.find((u) => u.entityId === unit);
    const row = rows.get(key) ?? { key, unit, holder: planet, count: live?.count ?? Number(n), damaged: 0, canSustain: false };
    row.count = Math.max(row.count, Number(n));
    rows.set(key, row);
    if (n === "1") ids.set(key, c.customId!);
  }
  const list = [...rows.values()];
  const names = Object.fromEntries(list.map((r) => [r.holder, getPlanetData(r.holder)?.name ?? r.holder]));
  const all = Object.fromEntries(list.map((r) => [r.key, { sustain: 0, destroy: r.count }]));
  const runKey = `retreat-ground:${d.id}`;
  return (
    <HitPanel
      key={d.id}
      rows={list}
      color={data.me?.color}
      mode="remove"
      verb="Retreat"
      initial={list.length ? all : suggestPlan(list, 0, false)}
      holderNames={names}
      heading="Ground forces that retreat with your ships"
      note="Units left behind stay on their planets. Confirm with none chosen is not possible — use Done below to keep them all."
      runKey={runKey}
      onConfirm={(plan) =>
        void runFlow({
          key: runKey,
          target: { channelId: d.prompt.channelId, messageId: d.id },
          ids: list.flatMap((r) => Array.from({ length: plan[r.key]?.destroy ?? 0 }, () => ({ customId: ids.get(r.key) ?? "", label: `Retreating ${r.unit === "gf" ? "infantry" : r.unit}` }))).filter((p) => p.customId),
          finish: doneOf,
        })
      }
    />
  );
}
