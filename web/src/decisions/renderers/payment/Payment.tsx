import { useMemo, useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import cx from "clsx";
import { usePlay } from "@/discord";
import { baseId, type Choice } from "../../model/controls";
import { ChoiceButton, ChoiceButtons } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { useRunner } from "../strategy/runner";
import strategy from "../strategy/strategy.module.css";
import { freshBuild, usePaymentIntent } from "./intent";
import {
  alreadySpent,
  commOffer,
  discounts,
  isCommChoice,
  isDiscount,
  isDoneChoice,
  isPlanetChoice,
  isResetChoice,
  isTgChoice,
  payKind,
  payPlanets,
  statedCost,
  suggest,
  tgChunks,
  tgOffer,
  tgWorth,
  valueOf,
  type PayKind,
} from "./model";
import { showReceipt } from "./receipt";
import { pressOn, usePressPlan, type PlanStep } from "../../ui/pressPlan";
import { Quantity } from "../../ui/Quantity";
import { actionChoice, Meter, plural } from "./shared";
import classes from "./payment.module.css";

type Purpose = {
  key: "custodians" | "build" | "tech" | "other";
  title: string;
  sub?: string;
  cost?: number;
  /** Receipt headline once paid. */
  done: string;
};

const CUSTODIANS = /Influence_6|scored Custodians/i;

function purposeOf(props: RendererProps, content: string, kind: PayKind): Purpose {
  const { d } = props;
  const build = freshBuild(usePaymentIntent.getState().build);
  const stated = statedCost(content);
  if (kind === "influence" && CUSTODIANS.test(content)) {
    return {
      key: "custodians",
      title: "Remove the Custodians token: pay 6 influence (+1 VP)",
      sub: "Landing on Mecatol Rex while the Custodians token is there costs 6 influence. The game already gave you the planet and the point; pay now, or undo the landing.",
      cost: 6,
      done: "+1 VP — Custodians removed",
    };
  }
  if (/pay a cost of/i.test(content) || /preceding build cost/i.test(content)) {
    return {
      key: "build",
      title: build ? `Pay for ${build.units}` : "Pay for the units you produced",
      sub: build ? `Produced at ${build.where}.` : undefined,
      cost: stated,
      done: build ? `Built ${build.units} at ${build.where}` : "Paid for the production",
    };
  }
  if (/^Pay for /.test(d.title)) {
    const name = d.title.replace(/^Pay for (the )?/, "");
    const secondary = /Technology secondary: 4 resources/.test(d.text);
    const primary = /Technology primary/.test(d.text);
    return {
      key: "tech",
      title: `Research ${name}`,
      sub: primary
        ? "Technology primary: your first technology is free; a second costs 6 resources."
        : secondary
          ? "Technology secondary: 4 resources."
          : undefined,
      cost: stated ?? (secondary ? 4 : primary ? 0 : undefined),
      done: `Researched ${name}`,
    };
  }
  return {
    key: "other",
    title: kind === "influence" ? "Spend influence" : "Spend resources",
    cost: stated,
    done: "Paid",
  };
}

/**
 * Every bot spend prompt as one panel: what it is for and what it costs, a live "Paid X of N" meter, planets as
 * checkable tiles, trade goods (and commodities) as steppers, the bot's discounts as toggles, a Suggest that picks the
 * cheapest combination, and one Pay that presses the bot's buttons in order.
 */
export function PaymentBody(props: RendererProps) {
  const { d, data, onPress, pendingKey } = props;
  const live = usePlay((s) => s.messages[d.prompt.channelId]?.byId[d.id]) ?? d.prompt.message;
  const content = live.content ?? "";
  const kind = payKind(d.choices, content);
  const unit = kind === "influence" ? "influence" : "resources";
  const me = data.me;
  /* Fixed when the prompt first shows: the bot rewrites its text as things are spent. */
  const [purpose] = useState(() => purposeOf(props, content, kind));
  const planets = useMemo(() => payPlanets(d.choices, me), [d.choices, me]);
  const tgMax = tgOffer(d.choices, me);
  const commMax = commOffer(d.choices, me);
  const worth = tgWorth(me);
  const offers = discounts(d.choices);
  const spent = alreadySpent(content);
  const build = freshBuild(usePaymentIntent((s) => s.build));
  const run = usePressPlan();
  const runner = useRunner();

  const [costOverride, setCost] = useState<number | undefined>(undefined);
  const cost = costOverride ?? purpose.cost;
  const [on, setOn] = useState<Set<string>>(() => {
    const sarween = offers.find((o) => o.label === "Sarween Tools");
    return new Set(build?.sarween && sarween && purpose.key === "build" ? [sarween.key] : []);
  });
  const discount = offers.filter((o) => on.has(o.key)).reduce((n, o) => n + o.amount, 0);
  const auto = () => suggest(planets, kind, (cost ?? 0) - spent - discount, tgMax, commMax, worth);
  type Picked = { planets: Set<string>; tg: number; comm: number };
  /* Follows the cost and the discounts (Suggest) until I pick something myself. */
  const suggested = useMemo<Picked>(() => {
    const s = auto();
    return { planets: new Set(s.planets), tg: s.tg, comm: s.comm };
  }, [cost, discount, spent, planets, tgMax, commMax, worth, kind]); // auto reads exactly these
  const [manual, setManual] = useState<Picked | null>(null);
  const pick = manual ?? suggested;
  const setPick = (next: Picked | ((s: Picked) => Picked)) => setManual((prev) => (typeof next === "function" ? next(prev ?? suggested) : next));

  const planetPaid = planets.filter((p) => pick.planets.has(p.id)).reduce((n, p) => n + valueOf(p, kind), 0);
  const paid = spent + discount + planetPaid + (pick.tg + pick.comm) * worth;
  const busy = !!runner.running;
  const others = d.choices.filter(
    (c) => !isPlanetChoice(c) && !isTgChoice(c) && !isCommChoice(c) && !isResetChoice(c) && !isDoneChoice(c) && !isDiscount(c),
  );
  const done = d.choices.find(isDoneChoice);
  /* The bot takes the planet and the point on landing; "not now" is rolling the landing back. */
  const undoLanding = purpose.key === "custodians" ? d.choices.find((c) => /^ultimateUndo/.test(baseId(c.customId))) : undefined;
  const reset = d.choices.find(isResetChoice);
  const free = cost === 0 && paid === 0;

  const togglePlanet = (id: string) =>
    setPick((s) => {
      const next = new Set(s.planets);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...s, planets: next };
    });
  const toggleDiscount = (key: string) =>
    setOn((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const applySuggest = () => setManual(null);
  /* Trade goods still needed on top of what is picked. */
  const maxTgNeeded = cost === undefined ? 0 : Math.min(tgMax - pick.tg, Math.max(0, Math.ceil((cost - paid) / worth)));

  const pay = () => {
    const ch = d.prompt.channelId;
    const steps: PlanStep[] = [];
    for (const o of offers.filter((x) => on.has(x.key))) {
      steps.push(pressOn(ch, d.id, `Using ${o.label}`, (id) => id === baseId(o.choice.customId)));
    }
    for (const p of planets.filter((x) => pick.planets.has(x.id) && x.choice)) {
      steps.push(pressOn(ch, d.id, `Exhausting ${p.name}`, (id) => id === baseId(p.choice!.customId)));
    }
    for (const k of tgChunks(pick.tg)) {
      steps.push(pressOn(ch, d.id, `Spending ${plural(k, "trade good")}`, (id) => new RegExp(`^reduceTG_${k}_`).test(id)));
    }
    for (const k of tgChunks(pick.comm).flatMap((n) => (n === 3 ? [2, 1] : [n]))) {
      steps.push(pressOn(ch, d.id, `Spending ${plural(k, "commodity", "commodities")}`, (id) => new RegExp(`^reduceComm_${k}_`).test(id)));
    }
    if (done) steps.push(pressOn(ch, d.id, "Done", (id) => id === baseId(done.customId)));
    const names = planets.filter((x) => pick.planets.has(x.id)).map((p) => p.name);
    if (pick.tg) names.push(plural(pick.tg, "TG", "TG"));
    if (pick.comm) names.push(plural(pick.comm, "commodity", "commodities"));
    const used = offers.filter((x) => on.has(x.key)).map((o) => `${o.label} −${o.amount}`);
    void run(`pay:${d.id}`, steps, () => {
      const spentNow = paid - spent - discount;
      const detail = [names.length ? `${spentNow} ${unit} (${names.join(", ")})` : spentNow ? `${spentNow} ${unit}` : "nothing", ...used].join(" · ");
      showReceipt(purpose.done, `Paid ${detail}`);
      if (purpose.key === "build") usePaymentIntent.getState().setBuild(null);
    });
  };

  if (runner.running === `pay:${d.id}`) {
    return (
      <div className={strategy.panel}>
        <PurposeHead purpose={purpose} />
        <div className={strategy.progress}>
          <Loader size={14} /> {runner.label} ({runner.step}/{runner.total})
        </div>
      </div>
    );
  }

  const spending = paid - spent - discount;
  const withDiscount = discount ? ` + ${offers.filter((o) => on.has(o.key)).map((o) => o.label).join(", ")}` : "";
  const payLabel = free
    ? "Free — Done"
    : purpose.key === "custodians"
      ? `Pay ${spending} influence and take the Custodians`
      : spending === 0 && !discount
        ? "Done — pay nothing more"
        : `Pay ${spending} ${unit}${withDiscount}`;
  return (
    <div className={strategy.panel}>
      <PurposeHead purpose={purpose} />
      <Quantity
        label="To pay"
        value={cost ?? 0}
        max={99}
        onChange={setCost}
        unit={unit === "influence" ? "inf" : "res"}
        hint={cost === undefined ? "The game did not say — set it" : purpose.key === "other" ? "From the game's message; adjust if needed" : undefined}
        maxShortcut={false}
        busy={busy}
        dense
      />
      <Meter paid={paid} need={cost} unit={unit} />
      {spent > 0 && (
        <span className={strategy.sub}>
          {spent} already spent on this prompt.{" "}
          {reset && (
            <UnstyledButton className={strategy.textLink} onClick={() => onPress(reset)} disabled={busy || !!pendingKey}>
              Start over
            </UnstyledButton>
          )}
        </span>
      )}
      {offers.length > 0 && (
        <div className={classes.toggles}>
          {offers.map((o) => (
            <Toggle key={o.key} on={on.has(o.key)} onClick={() => toggleDiscount(o.key)} label={o.label} meta={`−${o.amount}`} disabled={busy} />
          ))}
        </div>
      )}
      {planets.length > 0 && (
        <div className={classes.planetGrid} role="group" aria-label="Planets to exhaust">
          {planets.map((p) => {
            const checked = pick.planets.has(p.id);
            return (
              <UnstyledButton
                key={p.id}
                role="checkbox"
                aria-checked={checked}
                className={cx(classes.planet, p.exhausted && classes.exhausted)}
                onClick={() => togglePlanet(p.id)}
                disabled={busy || p.exhausted}
                title={p.exhausted ? `${p.name} is exhausted` : undefined}
              >
                <span className={strategy.checkBox}>{checked && <IconCheck size={12} />}</span>
                <span className={classes.planetName}>{p.name}</span>
                <span className={cx(classes.value, kind === "resources" ? classes.res : classes.inf)}>{valueOf(p, kind)}</span>
              </UnstyledButton>
            );
          })}
        </div>
      )}
      {tgMax > 0 && (
        <Quantity
          label="Trade goods"
          value={pick.tg}
          max={tgMax}
          onChange={(n) => setPick((s) => ({ ...s, tg: n }))}
          unit="TG"
          maxShortcut={false}
          busy={busy}
          hint={
            <>
              you have {tgMax}
              {worth > 1 ? " · worth 2 each (Mirror Computing)" : ""}
              {maxTgNeeded > 0 && (
                <>
                  {" · "}
                  <UnstyledButton className={strategy.textLink} onClick={() => setPick((s) => ({ ...s, tg: Math.min(tgMax, s.tg + maxTgNeeded) }))} disabled={busy}>
                    +{maxTgNeeded} to cover the rest
                  </UnstyledButton>
                </>
              )}
            </>
          }
        />
      )}
      {commMax > 0 && (
        <Quantity
          label="Commodities"
          value={pick.comm}
          max={Math.min(2, commMax)}
          onChange={(n) => setPick((s) => ({ ...s, comm: n }))}
          hint={`you have ${commMax}`}
          busy={busy}
        />
      )}
      <div className={classes.suggestRow}>
        <UnstyledButton className={strategy.textLink} onClick={applySuggest} disabled={busy}>
          Suggest
        </UnstyledButton>
        <UnstyledButton className={strategy.textLink} onClick={() => setPick({ planets: new Set(), tg: 0, comm: 0 })} disabled={busy}>
          Clear
        </UnstyledButton>
      </div>
      <ChoiceButtons
        choices={others.filter((c) => c !== undoLanding)}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        trailing={
          <ChoiceButton
            choice={actionChoice("payment-pay", payLabel, 3, !done)}
            onPress={pay}
            pending={false}
            busy={busy || !!pendingKey}
            emphasis
          />
        }
      />
      {undoLanding && (
        <ChoiceButton
          choice={{ ...undoLanding, label: "Not now — undo the landing", style: 2, rank: "secondary" }}
          onPress={onPress}
          pending={pendingKey === undoLanding.key}
          busy={busy || !!pendingKey}
        />
      )}
      {runner.error && <span className={strategy.error}>{runner.error}</span>}
    </div>
  );
}

function PurposeHead({ purpose }: { purpose: Purpose }) {
  return (
    <div className={classes.purpose}>
      <span className={classes.purposeTitle}>{purpose.title}</span>
      {purpose.sub && <span className={strategy.sub}>{purpose.sub}</span>}
    </div>
  );
}

export function Toggle({ on, onClick, label, meta, disabled }: { on: boolean; onClick: () => void; label: string; meta?: string; disabled?: boolean }) {
  return (
    <UnstyledButton role="switch" aria-checked={on} className={classes.toggle} onClick={onClick} disabled={disabled}>
      <span className={strategy.checkBox}>{on && <IconCheck size={12} />}</span>
      <span className={classes.toggleLabel}>{label}</span>
      {meta && <span className={strategy.checkMeta}>{meta}</span>}
    </UnstyledButton>
  );
}

export const isPaymentChoice = (c: Choice) => isPlanetChoice(c) || isTgChoice(c);
