import { Loader, UnstyledButton } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButton, ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose } from "../ui/parts";
import type { RendererProps } from "./types";
import classes from "./renderers.module.css";

const PLANET = /^spend_/;
const DONE = /^(deleteButtons|done|finish)/i;
const PAY = /^(reduceTG_|reduceComm_)/;

/** "Ylir Keleres (0/2)" → name and resource / influence values. */
function planetOf(c: Choice) {
  const m = c.label.match(/^(.*?)\s*\((\d+)\/(\d+)\)\s*$/);
  return m ? { name: m[1], res: Number(m[2]), inf: Number(m[3]) } : { name: c.label, res: undefined, inf: undefined };
}

/** "Spend 2 Trade Goods" → "2 TG". */
function payLabel(c: Choice) {
  const [, kind, n] = baseId(c.customId).match(/^reduce(TG|Comm)_(\d+)/) ?? [];
  if (!kind) return c.label;
  return kind === "TG" ? `${n} TG` : `${n} commodit${n === "1" ? "y" : "ies"}`;
}

/** What the payment is for, from the `_inf` / `_res` suffix the bot puts on its spend buttons. */
export function spendFor(choices: Choice[]): "influence" | "resources" | "both" {
  const ids = choices.map((c) => baseId(c.customId)).filter((id) => /^(spend_|reduceTG_|reduceComm_|resetSpend_)/.test(id));
  if (ids.some((id) => /_inf(_|$)/.test(id))) return "influence";
  if (ids.some((id) => /_(res\w*|\w*tech|build\w*)$/.test(id))) return "resources";
  return "both";
}

/** Paying for something: my ready planets as tiles with the value that counts, trade goods, Done. */
export function SpendBody({ d, data, onPress, pendingKey }: RendererProps) {
  const what = spendFor(d.choices);
  const planets = d.choices.filter((c) => PLANET.test(baseId(c.customId)));
  const done = d.choices.find((c) => DONE.test(baseId(c.customId)) || /^done/i.test(c.label));
  const rest = d.choices.filter((c) => !PLANET.test(baseId(c.customId)) && c !== done);
  const pay = rest.filter((c) => PAY.test(baseId(c.customId)));
  const others = rest.filter((c) => !pay.includes(c));
  const total = d.text.match(/total spend of ([^.\n]+)/i)?.[1];
  const ready = what === "resources" ? data.me?.resources : data.me?.influence;
  return (
    <div className={classes.stack}>
      <p className={classes.hint}>
        {total ? `Spent so far: ${total}.` : "Nothing spent yet."}
        {ready !== undefined && ` ${ready} ${what === "resources" ? "resources" : "influence"} ready, ${data.me?.tg ?? 0} TG.`}
      </p>
      {planets.length > 0 && (
        <div className={classes.planetGrid}>
            {planets.map((c) => {
              const p = planetOf(c);
              return (
                <UnstyledButton
                  key={c.key}
                  className={classes.planetTile}
                  onClick={() => onPress(c)}
                  disabled={!!pendingKey || c.disabled}
                  aria-label={`Exhaust ${p.name}`}
                >
                  <span className={classes.planetName}>{p.name}</span>
                  <span className={classes.planetValues}>
                    {p.res !== undefined && (
                      <span className={cx(classes.res, what === "influence" && classes.faint)} title="Resources">
                        {p.res}
                      </span>
                    )}
                    {p.inf !== undefined && (
                      <span className={cx(classes.inf, what === "resources" && classes.faint)} title="Influence">
                        {p.inf}
                      </span>
                    )}
                  </span>
                  {pendingKey === c.key && <Loader size={14} className={classes.tileSpinnerSmall} />}
                </UnstyledButton>
              );
            })}
        </div>
      )}
      {pay.length > 0 && (
        <div className={classes.payRow}>
            {pay.map((c) => (
              <ChoiceButton
                key={c.key}
                choice={{ ...c, style: 2, label: payLabel(c) }}
                onPress={onPress}
                pending={pendingKey === c.key}
                busy={!!pendingKey}
                compact
              />
            ))}
        </div>
      )}
      <ChoiceButtons
        choices={others}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        trailing={
          done && (
            <ChoiceButton
              choice={{ ...done, style: 3, label: /exhausting/i.test(done.label) ? "Done paying" : done.label }}
              onPress={onPress}
              pending={pendingKey === done.key}
              busy={!!pendingKey}
              emphasis
            />
          )
        }
      />
    </div>
  );
}

const POOLS = [
  { key: "tactic", label: "Tactic", id: /increase_tactic_cc/ },
  { key: "fleet", label: "Fleet", id: /increase_fleet_cc/ },
  { key: "strategy", label: "Strategy", id: /increase_strategy_cc/ },
] as const;

/** Gaining command tokens: the three pools with a "+1" under each, Done. */
export function GainTokensBody({ d, data, onPress, pendingKey }: RendererProps) {
  const fromText = [...d.text.matchAll(/(\d+)\/(\d+)\/(\d+)/g)].pop();
  const values = fromText
    ? [Number(fromText[1]), Number(fromText[2]), Number(fromText[3])]
    : [data.me?.tacticalCC, data.me?.fleetCC, data.me?.strategicCC];
  const done = d.choices.find((c) => DONE.test(baseId(c.customId)) || /^done/i.test(c.label));
  const rest = d.choices.filter((c) => !POOLS.some((p) => p.id.test(c.customId ?? "")) && c !== done);
  const note = d.text.replace(/^.*command tokens are [\d/]+\.?\s*(use buttons to gain command tokens\.?)?/i, "").trim();
  return (
    <div className={classes.stack}>
      <div className={classes.pools}>
        {POOLS.map((p, i) => {
          const c = d.choices.find((x) => p.id.test(x.customId ?? ""));
          return (
            <div key={p.key} className={classes.pool}>
              <span className={classes.poolValue}>{values[i] ?? "–"}</span>
              <span className={classes.poolLabel}>{p.label}</span>
              {c && (
                <UnstyledButton
                  className={classes.poolPlus}
                  onClick={() => onPress(c)}
                  disabled={!!pendingKey || c.disabled}
                  aria-label={c.label}
                >
                  {pendingKey === c.key ? <Loader size={12} color="currentColor" /> : <IconPlus size={14} />}
                  Gain 1
                </UnstyledButton>
              )}
            </div>
          );
        })}
      </div>
      {note && <Prose text={note} clamp={1} muted />}
      <ChoiceButtons
        choices={rest}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        trailing={
          done && (
            <ChoiceButton
              choice={{ ...done, style: 3, label: "Done" }}
              onPress={onPress}
              pending={pendingKey === done.key}
              busy={!!pendingKey}
              emphasis
            />
          )
        }
      />
    </div>
  );
}
