import { Loader, UnstyledButton } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import cx from "clsx";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButton, ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose, ResourceStrip, Section } from "../ui/parts";
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

/** What the payment is for, from the `_inf` / `_res` suffix the bot puts on its spend buttons. */
export function spendFor(choices: Choice[]): "influence" | "resources" | "both" {
  const ids = choices.map((c) => baseId(c.customId)).filter((id) => /^(spend_|reduceTG_|reduceComm_|resetSpend_)/.test(id));
  if (ids.some((id) => /_inf$|_inf_/.test(id))) return "influence";
  if (ids.some((id) => /_res$|_res_|_tech|_build/.test(id))) return "resources";
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
  const summary = /used the following|exhausted the following|spent/i.test(d.text) ? d.text : "";
  return (
    <div className={classes.stack}>
      <ResourceStrip me={data.me} show={["tg", "comm", what === "resources" ? "resources" : "influence"]} />
      {summary ? (
        <Section label="Spent so far">
          <Prose text={summary} clamp={6} muted />
        </Section>
      ) : (
        <Prose text={d.text.replace(/^.*please choose the planets you wish to exhaust\.?/i, "").trim()} clamp={3} muted />
      )}
      {planets.length > 0 && (
        <Section label="Exhaust planets">
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
        </Section>
      )}
      {pay.length > 0 && (
        <Section label="Or spend">
          <div className={classes.payRow}>
            {pay.map((c) => (
              <ChoiceButton
                key={c.key}
                choice={{ ...c, style: 2 }}
                onPress={onPress}
                pending={pendingKey === c.key}
                busy={!!pendingKey}
                compact
              />
            ))}
          </div>
        </Section>
      )}
      {done && (
        <ChoiceButton
          choice={{ ...done, style: 3, label: /exhausting/i.test(done.label) ? "Done paying" : done.label }}
          onPress={onPress}
          pending={pendingKey === done.key}
          busy={!!pendingKey}
          emphasis
        />
      )}
      <ChoiceButtons choices={others} onPress={onPress} pendingKey={pendingKey} channelId={d.prompt.channelId} />
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
  const fromText = d.text.match(/(\d+)\/(\d+)\/(\d+)/);
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
      {note && <Prose text={note} clamp={3} muted />}
      {done && (
        <ChoiceButton
          choice={{ ...done, style: 3, label: "Done" }}
          onPress={onPress}
          pending={pendingKey === done.key}
          busy={!!pendingKey}
          emphasis
        />
      )}
      <ChoiceButtons choices={rest} onPress={onPress} pendingKey={pendingKey} channelId={d.prompt.channelId} />
    </div>
  );
}
