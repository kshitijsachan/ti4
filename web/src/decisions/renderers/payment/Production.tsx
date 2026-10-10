import { useMemo, useState } from "react";
import { Loader } from "@mantine/core";
import cx from "clsx";
import { usePlay } from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { baseId, choicesOf, type Choice } from "../../model/controls";
import { ChoiceButton, ChoiceButtons } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { useRunner } from "../strategy/runner";
import strategy from "../strategy/strategy.module.css";
import { usePaymentIntent } from "./intent";
import { Toggle } from "./Payment";
import { buildCost, buildSummary, productionRows, productionValue, type ProduceRow } from "./production";
import { pressOn, usePressPlan, type PlanStep } from "../../ui/pressPlan";
import { Quantity } from "../../ui/Quantity";
import { actionChoice } from "./shared";
import classes from "./payment.module.css";

type Counts = Record<string, number>;

const sum = (c: Counts) => Object.values(c).reduce((n, v) => n + v, 0);

/** The bot's messages just before the prompt (the "You have 5 PRODUCTION value in this system." note). */
function useRecentTexts(channelId: string, messageId: string) {
  const data = usePlay((s) => s.messages[channelId]);
  return useMemo(() => {
    if (!data) return [];
    const i = data.ids.indexOf(messageId);
    const from = i < 0 ? data.ids.length : i;
    return data.ids.slice(Math.max(0, from - 4), from).reverse().map((id) => data.byId[id]?.content ?? "");
  }, [data, messageId]);
}

/** Presses for `n` units of a row: the bot's 2-unit button where it has one, then single presses. */
function rowSteps(ch: string, messageId: string, r: ProduceRow, n: number): PlanStep[] {
  const steps: PlanStep[] = [];
  let left = n;
  while (left >= 2 && r.two) {
    const two = r.two;
    steps.push(pressOn(ch, messageId, `Placing 2 ${r.name}${r.where === "space" ? "" : ` on ${r.where}`}`, (id) => id === baseId(two.customId)));
    left -= 2;
  }
  for (; left > 0 && r.one; left--) {
    const one = r.one;
    steps.push(pressOn(ch, messageId, `Placing 1 ${r.name}${r.where === "space" ? "" : ` on ${r.where}`}`, (id) => id === baseId(one.customId)));
  }
  return steps;
}

/**
 * The bot asks after each ship with capacity whether to use Bellum Gloriosum. The panel already asked (its toggle),
 * so the run answers each of those prompts with its Decline: the extra units were part of this build.
 */
function declineBellum(since: string, answered: Set<string>): PlanStep {
  return {
    label: "Answering Bellum Gloriosum",
    optional: true,
    waitMs: 3000,
    find: (s) => {
      for (const [channelId, data] of Object.entries(s.messages)) {
        for (let i = data.ids.length - 1; i >= 0; i--) {
          const id = data.ids[i];
          if (compareSnowflakes(id, since) <= 0) break;
          if (answered.has(id)) continue;
          const m = data.byId[id];
          const cs = m ? choicesOf(m) : [];
          if (!cs.some((c) => /^solBtBuild_/.test(baseId(c.customId)))) continue;
          const decline = cs.find((c) => baseId(c.customId) === "deleteButtons");
          if (!decline?.customId) continue;
          answered.add(id);
          return { channelId, messageId: id, customId: decline.customId };
        }
      }
      return null;
    },
  };
}

/**
 * Producing units in one panel: a stepper per unit and place, the running count against the system's PRODUCTION and
 * the cost, the production-time abilities as toggles (Sarween Tools, Bellum Gloriosum) — then one Build that presses
 * the bot's buttons and lands on the payment with the right cost. Prompts the bot asks after the build (Bellum
 * Gloriosum) are answered from the toggle.
 */
export function ProductionBody({ d, data, onPress, pendingKey }: RendererProps) {
  const live = usePlay((s) => s.messages[d.prompt.channelId]?.byId[d.id]) ?? d.prompt.message;
  const me = data.me;
  const rows = useMemo(() => productionRows(d.choices, me), [d.choices, me]);
  const recent = useRecentTexts(d.prompt.channelId, d.id);
  const capacity = productionValue([live.content ?? "", ...recent]);
  const run = usePressPlan();
  const runner = useRunner();
  const busy = !!runner.running;

  const [counts, setCounts] = useState<Counts>({});
  const [bg, setBg] = useState<Counts>({});
  const hasSarween = !!me?.techs?.some((t) => t === "st" || t === "absol_st") && !me?.exhaustedTechs?.includes("absol_st");
  /* Unset until I touch it: on by default once the game data says I have it. */
  const [sarweenPick, setSarween] = useState<boolean | null>(null);
  const sarween = hasSarween && (sarweenPick ?? true);
  const hasBellum = me?.breakthrough?.breakthroughId === "solbt" && me.breakthrough.unlocked;
  const [bellum, setBellum] = useState(true);

  const done = d.choices.find((c) => /^deleteButtons_\w+/.test(baseId(c.customId)) && /done producing/i.test(c.label));
  const reset = d.choices.find((c) => baseId(c.customId) === "resetProducedThings");
  const pos = baseId(done?.customId).split("_").pop() ?? "";
  const started = /is producing units|Produced \d|PRODUCTION limit is/i.test(live.content ?? "");
  const shipRows = rows.filter((r) => r.capacity > 0 && r.ship);
  const bellumLimit = hasBellum && bellum ? shipRows.reduce((n, r) => n + r.capacity * (counts[r.key] ?? 0), 0) : 0;
  const bgRows = rows.filter((r) => r.unit === "fighter" || r.unit === "infantry");
  const bgUsed = Math.min(sum(bg), bellumLimit);
  const total: Counts = Object.fromEntries(rows.map((r) => [r.key, (counts[r.key] ?? 0) + (bellumLimit ? (bg[r.key] ?? 0) : 0)]));
  const units = sum(counts);
  const cost = buildCost(rows, total);
  const discount = sarween && cost > 0 ? 1 : 0;
  const toPay = cost - discount;
  const summary = buildSummary(rows, total);
  const planetsHere = [...new Set(rows.map((r) => r.where).filter((w) => w !== "space"))];
  const where = planetsHere.length ? `${planetsHere.join(", ")} (${pos})` : pos;
  const others = d.choices.filter((c) => !/^place_/.test(baseId(c.customId)) && c !== done && c !== reset);

  const setCount = (r: ProduceRow, n: number) => setCounts((c) => ({ ...c, [r.key]: Math.max(0, n) }));
  const setBgCount = (r: ProduceRow, n: number) => setBg((c) => ({ ...c, [r.key]: Math.max(0, n) }));

  const build = () => {
    if (!done) return;
    const ch = d.prompt.channelId;
    const steps: PlanStep[] = [];
    if (started && reset) steps.push(pressOn(ch, d.id, "Clearing the earlier build", (id) => id === baseId(reset.customId)));
    for (const r of rows) steps.push(...rowSteps(ch, d.id, r, total[r.key] ?? 0));
    const capacityShips = shipRows.reduce((n, r) => n + (total[r.key] ?? 0), 0);
    if (hasBellum) {
      const answered = new Set<string>();
      for (let i = 0; i < capacityShips; i++) steps.push(declineBellum(d.id, answered));
    }
    steps.push(pressOn(ch, d.id, "Done producing", (id) => id === baseId(done.customId)));
    usePaymentIntent.getState().setBuild({ at: Date.now(), units: summary || "nothing", where, cost, sarween: discount > 0 });
    void run(`build:${d.id}`, steps);
  };

  if (runner.running === `build:${d.id}`) {
    return (
      <div className={strategy.panel}>
        <span className={classes.purposeTitle}>Producing {summary}</span>
        <div className={strategy.progress}>
          <Loader size={14} /> {runner.label} ({runner.step}/{runner.total})
        </div>
      </div>
    );
  }

  const over = capacity !== undefined && units > capacity;
  return (
    <div className={strategy.panel}>
      <div className={classes.purpose}>
        <span className={classes.purposeTitle}>Produce at {where}</span>
        <span className={strategy.sub}>
          {capacity !== undefined ? `PRODUCTION ${capacity} here. ` : ""}
          Ready to spend: {me?.resources ?? "?"} resources, {me?.tg ?? 0} TG.
        </span>
      </div>
      {started && <span className={strategy.sub}>Units placed earlier in this build are cleared and placed again from this list.</span>}
      <div className={classes.unitList}>
        {rows.map((r) => (
          <Quantity
            key={r.key}
            label={r.name}
            hint={`${r.where === "space" ? "in space" : `on ${r.where}`} · ${r.unit === "fighter" || r.unit === "infantry" ? "2 for 1" : `costs ${r.cost}`}${r.left !== undefined ? ` · ${r.left} left` : ""}`}
            value={counts[r.key] ?? 0}
            max={r.left ?? 20}
            allowed={r.one ? undefined : Array.from({ length: 11 }, (_, i) => i * 2)}
            onChange={(n) => setCount(r, n)}
            maxReason={r.left !== undefined ? "None left in reinforcements" : undefined}
            maxShortcut={false}
            busy={busy}
            dense
          />
        ))}
      </div>
      {(hasSarween || hasBellum) && (
        <div className={classes.toggles}>
          {hasSarween && <Toggle on={sarween} onClick={() => setSarween(!sarween)} label="Sarween Tools" meta="−1" disabled={busy} />}
          {hasBellum && (
            <Toggle
              on={bellum}
              onClick={() => setBellum(!bellum)}
              label="Bellum Gloriosum"
              meta={bellumLimit ? `up to ${bellumLimit} free of PRODUCTION` : "with a ship that has capacity"}
              disabled={busy}
            />
          )}
        </div>
      )}
      {bellumLimit > 0 && bgRows.length > 0 && (
        <div className={classes.bellum}>
          <span className={strategy.sectionLabel}>
            Bellum Gloriosum · {bgUsed} of {bellumLimit} · these do not count against PRODUCTION (they still cost)
          </span>
          {bgRows.map((r) => (
            <Quantity
              key={r.key}
              label={`${r.name} (Bellum Gloriosum)`}
              hint={r.where === "space" ? "in space" : `on ${r.where}`}
              value={bg[r.key] ?? 0}
              max={(bg[r.key] ?? 0) + Math.max(0, bellumLimit - sum(bg))}
              onChange={(n) => setBgCount(r, n)}
              maxReason={`Bellum Gloriosum allows ${bellumLimit} (the capacity of the ships built)`}
              maxShortcut={false}
              busy={busy}
              dense
            />
          ))}
        </div>
      )}
      <div className={classes.summary}>
        <span>
          <span className={cx(classes.num, over && classes.short)}>{units}</span>
          {capacity !== undefined && (
            <>
              {" "}
              of <span className={classes.num}>{capacity}</span>
            </>
          )}{" "}
          production used{bgUsed ? ` + ${bgUsed} free (Bellum Gloriosum)` : ""}
        </span>
        <span>
          Cost <span className={classes.num}>{cost}</span>
          {discount ? (
            <>
              {" "}
              − 1 Sarween = <span className={classes.num}>{toPay}</span>
            </>
          ) : null}
        </span>
      </div>
      {over && <span className={classes.short}>More units than this system's PRODUCTION ({capacity}).</span>}
      <ChoiceButtons
        choices={others}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        trailing={
          <ChoiceButton
            choice={actionChoice("production-build", summary ? `Build ${summary} — pay ${toPay}` : "Build nothing", 3, !done)}
            onPress={build}
            pending={false}
            busy={busy || !!pendingKey}
            emphasis
          />
        }
      />
      {runner.error && <span className={strategy.error}>{runner.error}</span>}
    </div>
  );
}

export const isBuildChoice = (c: Choice) => /^place_/.test(baseId(c.customId));
