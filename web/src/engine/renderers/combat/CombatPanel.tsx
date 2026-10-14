import { Button, Tooltip } from "@mantine/core";
import cx from "clsx";
import type { CombatAbilityValue } from "../../../../../shim/src/engine/kinds/combat";
import type { Decision, GameState } from "../../../../../shim/src/engine/types";
import type { AnswerPayload } from "../../link";
import { playerLabel } from "../../names";
import { planetName, systemName } from "../tactical/names";
import type { ComponentType } from "react";
import { rendererFor } from "../../registry";
import { renderers } from "./index";
import { optionsOf, retreatReason, ROLL_LABEL, type AbilityChoice, type CombatView, type FrontView, type RollChoice, type RollView, type SideView } from "./combatView";
import { unitName } from "./types";
import classes from "./combat.module.css";

type Answer = (d: Decision, choice: string | AnswerPayload) => void;

/** Combat kinds draw with the combat renderers; other steps of the combat (faction abilities, leaders) with theirs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rendererOf = (kind: string): ComponentType<any> | undefined => renderers[kind] ?? (kind.startsWith("combat.") ? undefined : rendererFor(kind));

type Props = {
  view: CombatView;
  state: GameState | null;
  /** My other open prompts of this combat (bombardment targets, Morale Boost / Supercharge modifiers, the manual menu…): shown under the step. */
  extras: Decision[];
  answer?: Answer;
  pendingOptionId?: string | null;
};

const SHORT: Record<string, string> = { ff: "FF", gf: "GF", mf: "MF", dd: "DD", ca: "CA", cv: "CV", dn: "DN", fs: "FS", ws: "WS", pd: "PDS", sd: "SD" };
const short = (u: string) => SHORT[u] ?? u.toUpperCase();
const PRE_SHORT: Record<string, string> = { afb: "AFB", spacecannonoffence: "SCO", bombardment: "BMB", spacecannondefence: "SCD" };

/** One roll: per unit type "DN 5+" and its dice faces, hits lit; then the hits it produced. */
export function RollDice({ roll }: { roll: RollView }) {
  const groups = new Map<string, RollView["dice"]>();
  for (const d of roll.dice) {
    const key = `${d.unit}|${d.threshold}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return (
    <span className={classes.dice}>
      {[...groups.entries()].map(([key, ds]) => (
        <span key={key} className={classes.dieGroup}>
          <span className={classes.dieUnit}>
            {short(ds[0].unit)} <span className={classes.mono}>{ds[0].threshold}+</span>
          </span>
          {ds.map((d, i) => (
            <span key={i} className={cx(classes.die, d.hit && classes.hit)} aria-label={`${d.value}${d.hit ? " hit" : " miss"}`}>
              {d.value}
            </span>
          ))}
        </span>
      ))}
      {!roll.dice.length && <span className={classes.note}>dice not recorded</span>}
      <span className={cx(classes.hitTotal, roll.hits > 0 && classes.good)}>
        <span className={classes.mono}>{roll.hits}</span> hit{roll.hits === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function sideName(state: GameState | null, s: SideView) {
  return s.self ? `You (${playerLabel(state, s.faction).replace(/^.*\((.*)\)$/, "$1")})` : playerLabel(state, s.faction);
}

function Units({ side }: { side: SideView }) {
  if (!side.units.length) return <span className={classes.note}>no units left</span>;
  return (
    <span className={classes.units}>
      {side.units.map((u) => (
        <span key={`${u.holder}/${u.unit}`} className={cx(classes.unit, u.damaged > 0 && classes.unitDamaged)} title={unitName(u.unit)}>
          <span className={classes.mono}>{u.count}</span> {short(u.unit)}
          {u.damaged > 0 && <span title="damaged"> ·{u.damaged}d</span>}
        </span>
      ))}
    </span>
  );
}

/** Both sides of one front and every roll so far, round by round. */
function Front({ front, state }: { front: FrontView; state: GameState | null }) {
  const name = (f: string) => {
    const s = front.sides.find((x) => x.faction === f);
    return s?.self ? "You" : playerLabel(state, f);
  };
  return (
    <div className={classes.front}>
      <div className={classes.sideGrid}>
        {front.sides.map((s) => (
          <div key={s.faction} className={cx(classes.sideRow, s.self && classes.sideSelf)}>
            <span className={classes.sideName}>
              {sideName(state, s)}
              {front.sides.some((x) => x.attacker) && <span className={classes.sub}>{s.attacker ? " attacker" : " defender"}</span>}
            </span>
            <Units side={s} />
          </div>
        ))}
      </div>
      {(front.pre.length > 0 || front.rounds.length > 0) && (
        <table className={classes.rounds}>
          <tbody>
            {front.pre.map((r, i) => (
              <tr key={`pre${i}`}>
                <th className={classes.roundLabel} title={ROLL_LABEL[r.rollType]}>{PRE_SHORT[r.rollType] ?? r.rollType}</th>
                <td className={classes.roller}>{name(r.faction)}</td>
                <td>
                  <RollDice roll={r} />
                </td>
              </tr>
            ))}
            {front.rounds.flatMap((round) =>
              round.rolls.map((r, i) => (
                <tr key={`${round.round}-${r.faction}`} className={cx(i === 0 && classes.roundStart)}>
                  <th className={classes.roundLabel}>{i === 0 ? <span className={classes.mono}>R{round.round}</span> : null}</th>
                  <td className={classes.roller}>{name(r.faction)}</td>
                  <td>
                    <RollDice roll={r} />
                    {r.losses && r.losses.length > 0 && (
                      <span className={classes.losses}>
                        {" "}
                        lost{" "}
                        {r.losses
                          .map((l) => [l.destroyed ? `${l.destroyed} ${short(l.unit)}` : "", l.sustained ? `${l.sustained} ${short(l.unit)} sustained` : ""].filter(Boolean).join(", "))
                          .join(", ")}
                      </span>
                    )}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

const CONTROL_LABEL: Record<string, string> = {
  announce_retreat: "Announce retreat",
  retreat: "Retreat now",
  action_cards: "Combat action cards",
  repair: "Repair damage",
  automate: "Automate ground combat",
  temp_mod: "Use Supercharge",
};

/** Why an ability / control is greyed now, or null when it can be pressed. */
function abilityReason(a: AbilityChoice): string | null {
  const v: CombatAbilityValue = a.option.value!;
  /* The engine decides (it also sees combats opened outside the activation, which state.combat does not). */
  return v.blocked || null;
}

function controlReason(c: RollChoice, view: CombatView): string | null {
  const action = String((c.option.value as { action?: string }).action);
  if (action === "announce_retreat" || action === "retreat") return retreatReason(view, action);
  return null;
}

/**
 * One panel per combat: both sides' units, every round's dice and hits, the step the table is on with only that
 * step's actions live, the abilities posted with the combat (greyed with why when not usable), and a short log.
 */
export function CombatPanel({ view, state, extras, answer, pendingOptionId }: Props) {
  const step = view.step;
  const can = !!answer;
  const press = (d: Decision, choice: string | AnswerPayload) => answer?.(d, choice);
  const front = view.current;
  const where = front ? (front.holder === "space" ? "Space combat" : `Ground combat · ${planetName(front.holder)}`) : "Combat";
  const others = view.fronts.filter((f) => f !== front && (f.on || f.result));
  const StepBody = step.decision && step.mine && (step.kind === "assign" || step.kind === "retreat") ? renderers[step.decision.kind] : undefined;
  /* The bot posts some prompts twice (actions channel and combat thread): one copy each. */
  const seenPrompt = new Set<string>();
  const more = extras.filter((d) => {
    if (d.id === step.decision?.id || d.kind === "combat.round" || (step.kind === "assign" && d.kind === "combat.hits") || !rendererOf(d.kind)) return false;
    const key = `${d.kind}|${optionsOf(d)
      .map((o) => o.id)
      .join(",")}`;
    if (seenPrompt.has(key)) return false;
    seenPrompt.add(key);
    return true;
  });
  const busy = !!pendingOptionId;

  return (
    <div className={classes.panel} data-combat-panel data-combat-step={step.kind}>
      {/* The popup's title names the combat and round; this line names the system. */}
      <div className={classes.sub} aria-label={where}>
        {systemName(view.tile, view.tileId)}
      </div>
      {front && <Front front={front} state={state} />}
      {others.map((f) => (
        <p key={f.holder} className={classes.note}>
          {f.holder === "space" ? "Space" : planetName(f.holder)}: {f.result ?? `round ${f.round} under way`}
        </p>
      ))}

      <div className={cx(classes.step, step.mine && classes.stepMine, step.kind === "over" && classes.stepOver)} role="status" data-combat-step-line>
        {step.text}
      </div>

      {step.kind === "roll" && step.mine && (
        <div className={classes.actions}>
          {view.rolls.map((r) => (
            <Button key={r.option.id} size="xs" disabled={!can || busy} onClick={() => press(r.decision, r.option.id)} data-combat-roll>
              Roll {step.rollType === "combat" ? `round ${front?.round ?? 1}` : ROLL_LABEL[String(step.rollType)]}
            </Button>
          ))}
          {step.rollType === "spacecannonoffence" &&
            optionsOf(step.decision!)
              .filter((o) => (o.value as { action?: string } | null)?.action === "decline_space_cannon" && !o.disabled)
              .map((o) => (
                <Button key={o.id} size="xs" variant="default" disabled={!can || busy} onClick={() => press(step.decision!, o.id)}>
                  Decline space cannon
                </Button>
              ))}
        </div>
      )}
      {StepBody && step.decision && (
        <div className={classes.stepBody}>
          <StepBody decision={step.decision} state={state} answer={(c: string | AnswerPayload) => press(step.decision!, c)} />
        </div>
      )}
      {more.map((extra) => {
        const ExtraBody = rendererOf(extra.kind)!;
        return (
          <div key={extra.id} className={classes.stepBody} data-combat-extra={extra.kind}>
            <span className={classes.label}>Also open</span>
            <ExtraBody decision={extra} state={state} answer={(c: string | AnswerPayload) => press(extra, c)} pendingOptionId={pendingOptionId} />
          </div>
        );
      })}

      {(view.abilities.length > 0 || view.controls.length > 0) && (
        <div className={classes.abilities}>
          <span className={classes.label}>{step.kind === "roll" ? "Before rolling" : "Abilities"}</span>
          <div className={classes.actions}>
            {view.abilities.map((a) => {
              const v = a.option.value!;
              const reason = abilityReason(a);
              const label = v.source === "agent" ? `Use ${v.name ?? a.option.label}` : a.option.label;
              return (
                <Tooltip key={a.option.id} label={reason ? `Not now: ${reason}` : (v.window ?? label)} multiline maw={280} withArrow>
                  <span>
                    <Button size="xs" variant="default" disabled={!can || busy || !!reason} onClick={() => press(a.decision, a.option.id)} data-combat-ability={v.ability}>
                      {label}
                    </Button>
                  </span>
                </Tooltip>
              );
            })}
            {view.controls.map((c) => {
              const reason = controlReason(c, view);
              const action = String((c.option.value as { action?: string }).action);
              return (
                <Tooltip key={c.option.id} label={reason ? `Not now: ${reason}` : (CONTROL_LABEL[action] ?? c.option.label)} withArrow disabled={!reason}>
                  <span>
                    <Button size="xs" variant="subtle" disabled={!can || busy || !!reason} onClick={() => press(c.decision, c.option.id)}>
                      {CONTROL_LABEL[action] ?? c.option.label}
                    </Button>
                  </span>
                </Tooltip>
              );
            })}
          </div>
          {view.abilities.some((a) => abilityReason(a)) && (
            <ul className={classes.reasons}>
              {view.abilities
                .filter((a) => abilityReason(a))
                .map((a) => (
                  <li key={a.option.id}>
                    {a.option.value!.name ?? a.option.label}: {abilityReason(a)}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {view.log.length > 0 && (
        <details className={classes.log}>
          <summary>Combat log · {view.log.length}</summary>
          <ol>
            {view.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
