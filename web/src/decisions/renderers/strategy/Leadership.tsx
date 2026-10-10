import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconCheck, IconMinus, IconPlus } from "@tabler/icons-react";
import { usePlay } from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { baseId, choicesOf, type Choice } from "../../model/controls";
import { ChoiceButton } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { cardSpec } from "./cards";
import { useRunner, useRunSequence, type Press } from "./runner";
import { CardHeader, holderOf } from "./shared";
import classes from "./strategy.module.css";

const DONE = /^deleteButtons_leadership$/;
const SPEND = /^spend_(\w+?)_inf$/;
const TG = /^reduceTG_(\d+)_inf$/;
const POOLS = [
  { key: "tactic", label: "Tactic", id: "increase_tactic_cc" },
  { key: "fleet", label: "Fleet", id: "increase_fleet_cc" },
  { key: "strategy", label: "Strategy", id: "increase_strategy_cc" },
] as const;

const isLeadershipSpend = (cs: Choice[]) => cs.some((c) => DONE.test(baseId(c.customId))) && cs.some((c) => SPEND.test(baseId(c.customId)) || TG.test(baseId(c.customId)));
const isLeadershipGain = (cs: Choice[]) => cs.some((c) => DONE.test(baseId(c.customId))) && cs.some((c) => /^increase_\w+_cc$/.test(baseId(c.customId)));

/** Leadership's two follow-up prompts in my hand thread (exhaust planets; gain tokens), whichever one is shown. */
export function isLeadershipStep(choices: Choice[]) {
  return isLeadershipSpend(choices) || isLeadershipGain(choices);
}

type Msg = { id: string; channelId: string; choices: Choice[] };

function useLeadershipPrompts(channelId: string, shownId: string) {
  const data = usePlay((s) => s.messages[channelId]);
  let spend: Msg | undefined;
  let gain: Msg | undefined;
  if (!data) return { spend, gain };
  for (let i = data.ids.length - 1; i >= 0 && (!spend || !gain); i--) {
    const m = data.byId[data.ids[i]];
    if (!m?.author.bot) continue;
    const choices = choicesOf(m);
    if (!gain && isLeadershipGain(choices)) gain = { id: m.id, channelId, choices };
    else if (!spend && isLeadershipSpend(choices)) spend = { id: m.id, channelId, choices };
    if (compareSnowflakes(m.id, shownId) < 0 && (spend || gain)) break;
  }
  return { spend, gain };
}

/** "Mez Lo Orz Fei Zsha (2/1)" → name and influence. */
function planetOf(c: Choice) {
  const m = c.label.match(/^(.*?)\s*\((\d+)\/(\d+)\)\s*$/);
  return m ? { name: m[1], inf: Number(m[3]) } : { name: c.label, inf: 0 };
}

function Stepper({ value, onMinus, onPlus, label, now, disabled }: {
  value: number;
  now?: number;
  label: string;
  onMinus?: () => void;
  onPlus?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={classes.pool}>
      <span className={classes.numberLabel}>
        {label} <span className={classes.poolValue}>{now !== undefined ? `${now} → ${now + value}` : value}</span>
      </span>
      <span className={classes.stepper}>
        <UnstyledButton className={classes.stepBtn} onClick={onMinus} disabled={disabled || !onMinus} aria-label={`One less ${label}`}>
          <IconMinus size={12} />
        </UnstyledButton>
        <span className={classes.stepValue}>+{value}</span>
        <UnstyledButton className={classes.stepBtn} onClick={onPlus} disabled={disabled || !onPlus} aria-label={`One more ${label}`}>
          <IconPlus size={12} />
        </UnstyledButton>
      </span>
    </div>
  );
}

/**
 * Leadership in one panel: the planets to exhaust (influence), trade goods to add, the running total and how many
 * tokens it buys (plus 3 free on the primary), then where the tokens go. One confirm presses the bot's planet / trade
 * good buttons, "Done Exhausting Planets", one "Gain 1 … Token" per token and "Done Gaining Command Tokens".
 */
export function LeadershipBody({ d, data }: RendererProps) {
  const { spend, gain } = useLeadershipPrompts(d.prompt.channelId, d.id);
  const run = useRunSequence();
  const runner = useRunner();
  const me = data.me;
  const primary = !!me && holderOf(1, data)?.faction === me.faction;
  const free = primary ? 3 : 0;

  const planets = (spend?.choices ?? []).filter((c) => SPEND.test(baseId(c.customId)) && !c.disabled);
  const tgButtons = (spend?.choices ?? []).filter((c) => TG.test(baseId(c.customId)));
  const maxTg = Math.min(me?.tg ?? 0, Math.max(0, ...tgButtons.map((c) => Number(baseId(c.customId).match(TG)?.[1] ?? 0))));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tg, setTg] = useState(0);
  const influence = planets.filter((c) => picked.has(c.key)).reduce((n, c) => n + planetOf(c).inf, 0) + tg;
  const bought = Math.floor(influence / 3);
  const total = free + bought;
  const [alloc, setAlloc] = useState<Record<string, number>>({ tactic: 0, fleet: 0, strategy: 0 });
  const placed = alloc.tactic + alloc.fleet + alloc.strategy;
  const left = total - placed;
  const busy = !!runner.running;
  const now: Record<string, number | undefined> = { tactic: me?.tacticalCC, fleet: me?.fleetCC, strategy: me?.strategicCC };

  const toggle = (k: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  /* Shrinking the budget takes tokens back from the last pools first. */
  const fit = (a: Record<string, number>, budget: number) => {
    const out = { ...a };
    for (const k of ["strategy", "fleet", "tactic"]) {
      while (out.tactic + out.fleet + out.strategy > budget && out[k] > 0) out[k]--;
    }
    return out;
  };
  const shown = fit(alloc, total);

  const confirm = () => {
    const presses: Press[] = [];
    if (spend) {
      for (const c of planets.filter((p) => picked.has(p.key))) {
        presses.push({ channelId: spend.channelId, messageId: spend.id, customId: c.customId!, label: `Exhausting ${planetOf(c).name}` });
      }
      const tgChoice = tgButtons.find((c) => Number(baseId(c.customId).match(TG)?.[1]) === tg);
      if (tg > 0 && tgChoice) presses.push({ channelId: spend.channelId, messageId: spend.id, customId: tgChoice.customId!, label: `Spending ${tg} trade goods` });
      const done = spend.choices.find((c) => DONE.test(baseId(c.customId)));
      if (done) presses.push({ channelId: spend.channelId, messageId: spend.id, customId: done.customId!, label: "Done exhausting" });
    }
    if (gain) {
      for (const p of POOLS) {
        const c = gain.choices.find((x) => baseId(x.customId) === p.id);
        for (let i = 0; c && i < shown[p.key]; i++) presses.push({ channelId: gain.channelId, messageId: gain.id, customId: c.customId!, label: `Gaining a ${p.label.toLowerCase()} token` });
      }
      const done = gain.choices.find((c) => DONE.test(baseId(c.customId)));
      if (done) presses.push({ channelId: gain.channelId, messageId: gain.id, customId: done.customId!, label: "Done gaining" });
    }
    void run(`leadership:${d.id}`, presses, (dismiss) => {
      if (spend) dismiss(spend.id);
      if (gain) dismiss(gain.id);
    });
  };

  const spec = cardSpec(1);
  if (runner.running?.startsWith("leadership:")) {
    return (
      <div className={classes.panel}>
        <CardHeader sc={1} data={data} sub={primary ? "Your strategy card" : "Following"} />
        <div className={classes.progress}>
          <Loader size={14} /> {runner.label} ({runner.step}/{runner.total})
        </div>
      </div>
    );
  }
  return (
    <div className={classes.panel}>
      <CardHeader sc={1} data={data} sub={primary ? "Your strategy card" : "Following"}>
        <p className={classes.effect}>{primary ? spec?.primary : spec?.secondary}</p>
      </CardHeader>
      {planets.length > 0 && (
        <>
          <span className={classes.sectionLabel}>Exhaust planets for influence</span>
          <div className={classes.checklist} role="group" aria-label="Planets to exhaust">
            {planets.map((c) => {
              const p = planetOf(c);
              const on = picked.has(c.key);
              return (
                <UnstyledButton key={c.key} role="checkbox" aria-checked={on} className={classes.checkItem} onClick={() => toggle(c.key)} disabled={busy}>
                  <span className={classes.checkBox}>{on && <IconCheck size={12} />}</span>
                  <span className={classes.checkName}>{p.name}</span>
                  <span className={classes.checkMeta}>{p.inf} influence</span>
                </UnstyledButton>
              );
            })}
          </div>
        </>
      )}
      {maxTg > 0 && (
        <div className={classes.inlineRow}>
          <span className={classes.checkName}>Trade goods as influence</span>
          <span className={classes.stepper}>
            <UnstyledButton className={classes.stepBtn} onClick={() => setTg(tg - 1)} disabled={busy || tg <= 0} aria-label="One less trade good">
              <IconMinus size={12} />
            </UnstyledButton>
            <span className={classes.stepValue}>{tg}</span>
            <UnstyledButton className={classes.stepBtn} onClick={() => setTg(tg + 1)} disabled={busy || tg >= maxTg} aria-label="One more trade good">
              <IconPlus size={12} />
            </UnstyledButton>
          </span>
          <span className={classes.checkMeta}>of {me?.tg ?? 0}</span>
        </div>
      )}
      <p className={classes.effect}>
        <span className={classes.costValue}>{influence}</span> influence
        {influence % 3 ? <span className={classes.sub}> ({3 - (influence % 3)} more buys another)</span> : null}
        {" → "}
        <span className={classes.costValue}>{total}</span> token{total === 1 ? "" : "s"}
        {primary && <span className={classes.sub}> (3 free + {bought} bought)</span>}
      </p>
      {gain && total > 0 && (
        <>
          <span className={classes.sectionLabel}>Place them{left > 0 ? ` · ${left} left` : ""}</span>
          <div className={classes.pools}>
            {POOLS.map((p) => (
              <Stepper
                key={p.key}
                label={p.label}
                value={shown[p.key]}
                now={now[p.key]}
                onMinus={shown[p.key] > 0 ? () => setAlloc({ ...shown, [p.key]: shown[p.key] - 1 }) : undefined}
                onPlus={left > 0 ? () => setAlloc({ ...shown, [p.key]: shown[p.key] + 1 }) : undefined}
                disabled={busy}
              />
            ))}
          </div>
        </>
      )}
      {runner.running?.startsWith("leadership:") ? (
        <div className={classes.progress}>
          <Loader size={14} /> {runner.label} ({runner.step}/{runner.total})
        </div>
      ) : (
        <ChoiceButton
          choice={{
            key: "leadership-confirm",
            kind: "button",
            customId: "leadership-confirm",
            label: total > 0 ? `Gain ${placed || total} token${(placed || total) === 1 ? "" : "s"}` : "Done — gain nothing",
            style: 3,
            disabled: total > 0 && left > 0,
            rank: "primary",
            component: { type: 2 },
          }}
          onPress={confirm}
          pending={false}
          busy={busy}
          emphasis
        />
      )}
      {total > 0 && left > 0 && <span className={classes.sub}>Put every token in a pool to continue.</span>}
      {runner.error && <span className={classes.error}>{runner.error}</span>}
      {!gain && <span className={classes.sub}>Waiting for the game's token prompt…</span>}
    </div>
  );
}
