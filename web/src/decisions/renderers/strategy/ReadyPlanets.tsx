import { Loader, UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { baseId, type Choice } from "../../../prompts/controls";
import { cleanButtonLabel } from "../../../prompts/phrasing";
import { useStoredState } from "../../model/stored";
import { ChoiceButton } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { useRunner, useRunSequence, type Press } from "./runner";
import { CardHeader, holderOf } from "./shared";
import classes from "./strategy.module.css";

const DONE = /^deleteButtons_diplomacy$/;
const READY = /^refresh_(\w+)$/;

export function isReadyPlanetsStep(choices: Choice[]) {
  return choices.some((c) => DONE.test(baseId(c.customId)));
}

/** "Nar, Jol" → "Nar and Jol". */
const listed = (names: string[]) => (names.length === 2 ? `${names[0]} and ${names[1]}` : names.join(", "));

/** A button of this panel's own (not one of the bot's). */
const own = (key: string, label: string, style: number, rank: Choice["rank"]): Choice => ({
  key,
  kind: "button",
  customId: key,
  label,
  style,
  disabled: false,
  rank,
  component: { type: 2 },
});

/**
 * Diplomacy's "ready up to 2 planets" (primary and secondary): my exhausted planets as a checklist of at most two, one
 * confirm that readies them and closes the bot's prompt, and an explicit skip. The ticks survive a reload.
 */
export function ReadyPlanetsBody({ d, data }: RendererProps) {
  const run = useRunSequence();
  const runner = useRunner();
  const [picked, setPicked] = useStoredState<string[]>("ready", d.id, []);
  const planets = d.choices.filter((c) => READY.test(baseId(c.customId)) && !c.disabled);
  const done = d.choices.find((c) => DONE.test(baseId(c.customId)));
  const primary = !!data.me && holderOf(2, data)?.faction === data.me.faction;
  const busy = !!runner.running;
  const chosen = planets.filter((c) => picked.includes(c.key));

  const toggle = (k: string) =>
    setPicked((s) => (s.includes(k) ? s.filter((x) => x !== k) : s.length >= 2 ? [s[1], k] : [...s, k]));

  /** Readies `which` (none = skip), then closes the bot's prompt; undone as one action. */
  const finish = (which: Choice[]) => {
    const presses: Press[] = which.map((c) => ({
      channelId: d.prompt.channelId,
      messageId: d.id,
      customId: c.customId!,
      label: `Readying ${cleanButtonLabel(c.label)}`,
    }));
    if (done?.customId) presses.push({ channelId: d.prompt.channelId, messageId: d.id, customId: done.customId, label: "Finishing" });
    const summary = which.length ? `Readied ${listed(which.map((c) => cleanButtonLabel(c.label)))}` : "Skipped readying planets";
    void run(`ready:${d.id}`, presses, (dismiss) => dismiss(d.id), summary);
  };

  return (
    <div className={classes.panel}>
      <CardHeader sc={2} data={data} sub={primary ? "Your strategy card" : "Following"}>
        <p className={classes.effect}>Ready up to 2 of your exhausted planets.</p>
      </CardHeader>
      {planets.length ? (
        <div className={classes.checklist} role="group" aria-label="Planets to ready">
          {planets.map((c) => {
            const on = picked.includes(c.key);
            return (
              <UnstyledButton key={c.key} role="checkbox" aria-checked={on} className={classes.checkItem} onClick={() => toggle(c.key)} disabled={busy}>
                <span className={classes.checkBox}>{on && <IconCheck size={12} />}</span>
                <span className={classes.checkName}>{c.label}</span>
              </UnstyledButton>
            );
          })}
        </div>
      ) : (
        <p className={classes.sub}>None of your planets are exhausted.</p>
      )}
      {runner.running === `ready:${d.id}` ? (
        <div className={classes.progress}>
          <Loader size={14} /> {runner.label} ({runner.step}/{runner.total})
        </div>
      ) : (
        <div className={classes.actionRow}>
          {chosen.length > 0 && (
            <ChoiceButton
              choice={own("ready-confirm", `Ready ${chosen.length} planet${chosen.length === 1 ? "" : "s"}`, 3, "primary")}
              onPress={() => finish(chosen)}
              pending={false}
              busy={busy}
              emphasis
            />
          )}
          <ChoiceButton
            choice={own("ready-skip", "Skip readying planets", chosen.length ? 2 : 3, chosen.length ? "secondary" : "primary")}
            onPress={() => finish([])}
            pending={false}
            busy={busy}
            emphasis={!chosen.length}
          />
        </div>
      )}
      {runner.error && <span className={classes.error}>{runner.error}</span>}
    </div>
  );
}
