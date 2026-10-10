import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { baseId, type Choice } from "../../model/controls";
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

/**
 * Diplomacy's "ready up to 2 planets" (primary and secondary): my exhausted planets as a checklist of at most two, one
 * confirm that readies them and closes the bot's prompt.
 */
export function ReadyPlanetsBody({ d, data }: RendererProps) {
  const run = useRunSequence();
  const runner = useRunner();
  const [picked, setPicked] = useState<string[]>([]);
  const planets = d.choices.filter((c) => READY.test(baseId(c.customId)) && !c.disabled);
  const done = d.choices.find((c) => DONE.test(baseId(c.customId)));
  const primary = !!data.me && holderOf(2, data)?.faction === data.me.faction;
  const busy = !!runner.running;

  const toggle = (k: string) =>
    setPicked((s) => (s.includes(k) ? s.filter((x) => x !== k) : s.length >= 2 ? [s[1], k] : [...s, k]));

  const confirm = () => {
    const presses: Press[] = planets
      .filter((c) => picked.includes(c.key))
      .map((c) => ({ channelId: d.prompt.channelId, messageId: d.id, customId: c.customId!, label: `Readying ${c.label}` }));
    if (done?.customId) presses.push({ channelId: d.prompt.channelId, messageId: d.id, customId: done.customId, label: "Finishing" });
    void run(`ready:${d.id}`, presses, (dismiss) => dismiss(d.id));
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
        <ChoiceButton
          choice={{
            key: "ready-confirm",
            kind: "button",
            customId: "ready-confirm",
            label: picked.length ? `Ready ${picked.length} planet${picked.length === 1 ? "" : "s"}` : "Done",
            style: 3,
            disabled: false,
            rank: "primary",
            component: { type: 2 },
          }}
          onPress={confirm}
          pending={false}
          busy={busy}
          emphasis
        />
      )}
      {runner.error && <span className={classes.error}>{runner.error}</span>}
    </div>
  );
}
