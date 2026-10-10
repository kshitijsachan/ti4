import { baseId, type Choice } from "../../model/controls";
import { ChoiceButton } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { CardHeader } from "./shared";
import classes from "./strategy.module.css";

const SCORE = /^po_scoring_(\d+)$/;
const DONE = /^deleteButtons$/;

/** Imperial's "Score A Public" follow-up: objective buttons plus "Delete These Buttons", outside the status phase. */
export function isImperialScoreStep(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.some((id) => SCORE.test(id)) && ids.some((id) => DONE.test(id)) && !ids.some((id) => /^po_no_scoring/.test(id));
}

/** "(2) Make History" → "Make History". */
const nameOf = (c: Choice) => c.label.replace(/^\(\d+\)\s*/, "");

/**
 * Imperial, scoring a public objective now: each revealed objective with how close I am, a Score button on each,
 * and "Don't score" (the bot's delete) when I meet none.
 */
export function ImperialScoreBody({ d, data, onPress, pendingKey }: RendererProps) {
  const faction = data.me?.faction;
  const objs = data.web?.objectives;
  const all = objs ? [...objs.stage1Objectives, ...objs.stage2Objectives] : [];
  const scores = d.choices.filter((c) => SCORE.test(baseId(c.customId)));
  const skip = d.choices.find((c) => DONE.test(baseId(c.customId)));
  const busy = !!pendingKey;
  return (
    <div className={classes.panel}>
      <CardHeader sc={8} data={data} sub="Your strategy card">
        <p className={classes.effect}>Score 1 public objective you meet right now. Scoring one you do not meet is against the rules — nothing checks it for you.</p>
      </CardHeader>
      <div className={classes.checklist}>
        {scores.map((c) => {
          const o = all.find((x) => x.name === nameOf(c));
          const progress = faction ? o?.factionProgress?.[faction] : undefined;
          const tracked = !!o && o.progressThreshold > 0 && progress !== undefined;
          const met = tracked && progress! >= o!.progressThreshold;
          return (
            <div key={c.key} className={classes.inlineRow}>
              <span className={classes.checkName}>{nameOf(c)}</span>
              <span className={met ? classes.done : classes.checkMeta}>
                {met ? "You meet this" : tracked ? `${progress} of ${o!.progressThreshold}` : ""}
              </span>
              <ChoiceButton choice={{ ...c, label: "Score", style: met ? 3 : 2 }} onPress={onPress} pending={pendingKey === c.key} busy={busy} compact />
            </div>
          );
        })}
      </div>
      {skip && (
        <ChoiceButton choice={{ ...skip, label: "Don't score now", style: 2 }} onPress={onPress} pending={pendingKey === skip.key} busy={busy} emphasis />
      )}
    </div>
  );
}
