import { useState } from "react";
import { baseId, type Choice } from "../../model/controls";
import type { Decision } from "../../model/classify";
import { ChoiceButtons } from "../../ui/ChoiceButtons";
import { Prose } from "../../ui/parts";
import { Quantity, QuantityConfirm, RunError, RunProgress, useAnyRunning, useRunning } from "../../ui/Quantity";
import { pressOn, usePressPlan } from "../../ui/pressPlan";
import type { RendererProps } from "../types";
import classes from "./counters.module.css";

/** Numbered buttons that pick a place or a card, not an amount. */
const NOT_AMOUNT = /^(ring_|scPick_|queueScPick_|drawRelicAtPosition_|codexCardPick_|participateInSplice_|reveal_stage_|showObjInfo_|drawHeistObj_|deleteButtons_|generic_button_id_|augersPeak_|setAutoPassMedian_|setHourAsAFK_|UserSetPersonalPingIntervalTo|resolveAgendaVote_|answerSurvey_)/;
const NOT_AMOUNT_LABEL = /^(ring|stage|position|tile|round|turn)\b/i;

type Rung = { choice: Choice; n: number; prefix: string };

function rungOf(c: Choice): Rung | undefined {
  const id = baseId(c.customId);
  const m = id.match(/^(.*\D)(\d+)$/);
  if (!m || NOT_AMOUNT.test(id) || c.kind !== "button" || c.rank === "undo" || c.rank === "more") return undefined;
  const n = Number(m[2]);
  const label = c.label.trim();
  if (NOT_AMOUNT_LABEL.test(label)) return undefined;
  /* The amount must be what the button says: "3", "3 tg", "Land 3 infantry". */
  const said = label.match(/^\D{0,24}?\b(\d+)\b\D{0,24}$/)?.[1];
  if (said === undefined || Number(said) !== n) return undefined;
  return { choice: c, n, prefix: m[1] };
}

/** The longest run of numbered buttons sharing one id prefix: a ladder of at least three amounts. */
export function ladderOf(choices: Choice[]): Rung[] | undefined {
  const groups = new Map<string, Rung[]>();
  for (const c of choices) {
    const r = rungOf(c);
    if (r) groups.set(r.prefix, [...(groups.get(r.prefix) ?? []), r]);
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!best || best.length < 3 || new Set(best.map((r) => r.n)).size !== best.length) return undefined;
  return best.sort((a, b) => a.n - b.n);
}

export function isLadderStep(d: Decision) {
  return d.kind === "generic" && !!ladderOf(d.choices);
}

/** "Land 3 infantry" → "infantry"; "3 tg" → "tg"; "3" → "". */
function unitOf(label: string) {
  return label
    .replace(/\b\d+\b/, "")
    .replace(/^(land|use|spend|gain|choose|pick|remove|destroy|convert|place|send)\s+/i, "")
    .trim();
}

/**
 * "Choose N" from a row of numbered buttons (Yin hero's "Land 1 / 2 / 3 infantry", combat drones, a TG ladder): one
 * counter limited to the amounts offered, and one confirm that presses the matching button.
 */
export function LadderBody({ d, onPress, pendingKey, onHoverChoice }: RendererProps) {
  const plan = usePressPlan();
  const busy = useAnyRunning();
  const running = useRunning(`counter:ladder:${d.id}`);
  const rungs = ladderOf(d.choices) ?? [];
  const values = rungs.map((r) => r.n);
  const [n, setN] = useState(values[0] ?? 0);
  const rung = rungs.find((r) => r.n === n);
  const unit = unitOf(rungs[rungs.length - 1]?.choice.label ?? "");
  const others = d.choices.filter((c) => !rungs.some((r) => r.choice === c));
  const label = rung && /\D/.test(rung.choice.label.trim()) ? rung.choice.label : `Choose ${n}${unit ? ` ${unit}` : ""}`;
  const confirm = () => {
    if (!rung) return;
    const id = baseId(rung.choice.customId);
    void plan(`counter:ladder:${d.id}`, [pressOn(d.prompt.channelId, d.id, label, (x) => x === id)]);
  };
  return (
    <div className={classes.panel}>
      <Prose text={d.text} clamp={3} />
      {running ? (
        <RunProgress keyPrefix={`counter:ladder:${d.id}`} />
      ) : (
        <>
          <Quantity
            label={unit ? unit.charAt(0).toUpperCase() + unit.slice(1) : "Amount"}
            hint={`${values[0]}–${values[values.length - 1]}`}
            value={n}
            onChange={setN}
            min={values[0]}
            max={values[values.length - 1]}
            allowed={values}
            busy={busy}
          />
          <QuantityConfirm label={label} onConfirm={confirm} busy={busy || !!pendingKey} disabledReason={rung ? undefined : "Not one of the amounts offered"} />
          {others.length > 0 && <ChoiceButtons choices={others} onPress={onPress} pendingKey={pendingKey} channelId={d.prompt.channelId} onHover={onHoverChoice} />}
        </>
      )}
      <RunError />
    </div>
  );
}
