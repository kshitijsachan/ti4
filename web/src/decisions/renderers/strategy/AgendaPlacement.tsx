import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { usePlay, type Message } from "@/discord";
import { snowflakeTime } from "@/discord/shared/snowflake";
import { agendas } from "@/entities/data/agendas";
import type { AgendaInfo } from "../../model/classify";
import { baseId, choicesOf, cleanLabel, type Choice } from "../../model/controls";
import { ChoiceButton } from "../../ui/ChoiceButtons";
import { AgendaCard } from "../Agenda";
import type { RendererProps } from "../types";
import { useRunner, useRunSequence, type Press } from "./runner";
import { CardHeader } from "./shared";
import classes from "./strategy.module.css";

const TOP = /^topAgenda_(\d+)$/;
const BOTTOM = /^bottomAgenda_(\d+)$/;
/** The bot posts the two agendas a second or so apart. */
const PAIR_MS = 15_000;

/** A "top or bottom?" agenda peek (Politics, Zealots…): top and bottom buttons, no discard. */
export function isAgendaPlacementStep(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.some((id) => TOP.test(id)) && ids.some((id) => BOTTOM.test(id));
}

type Peek = { id: string; channelId: string; agenda: AgendaInfo; top?: Choice; bottom?: Choice };

function agendaOf(m: Message): AgendaInfo {
  const embed = m.embeds?.find((e) => e.title) ?? m.embeds?.[0];
  const name = cleanLabel(embed?.title ?? "").replace(/[_*]/g, "").trim() || "Agenda";
  const known =
    agendas.find((a) => a.name.toLowerCase() === name.toLowerCase() && (a.source === "base" || a.source === "pok")) ??
    agendas.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return { name, type: known?.type, target: known?.target, text1: known?.text1, text2: known?.text2 };
}

/** Every live top/bottom peek posted around the shown one in the same channel (Politics shows two). */
function usePeeks(d: RendererProps["d"]): Peek[] {
  const data = usePlay((s) => s.messages[d.prompt.channelId]);
  if (!data) return [];
  const at = snowflakeTime(d.id);
  const out: Peek[] = [];
  for (const id of data.ids) {
    const m = data.byId[id];
    if (!m?.author.bot || Math.abs(snowflakeTime(id) - at) > PAIR_MS) continue;
    const choices = choicesOf(m).filter((c) => !c.disabled);
    if (!isAgendaPlacementStep(choices)) continue;
    out.push({
      id,
      channelId: d.prompt.channelId,
      agenda: agendaOf(m),
      top: choices.find((c) => TOP.test(baseId(c.customId))),
      bottom: choices.find((c) => BOTTOM.test(baseId(c.customId))),
    });
  }
  return out;
}

/**
 * Looking at the top agendas: both side by side, each with Top / Bottom, and — when both go on top — which one is
 * drawn first. One confirm presses the bot's buttons in the order that gives that result (the bot puts one card at
 * a time, so the card pressed last onto the top is drawn first).
 */
export function AgendaPlacementBody({ d, data }: RendererProps) {
  const peeks = usePeeks(d);
  const run = useRunSequence();
  const runner = useRunner();
  const [place, setPlace] = useState<Record<string, "top" | "bottom">>({});
  const [first, setFirst] = useState<string | null>(null);
  const busy = !!runner.running;
  const where = (p: Peek) => place[p.id] ?? "top";
  const tops = peeks.filter((p) => where(p) === "top");
  const firstId = tops.length > 1 ? (first && tops.some((p) => p.id === first) ? first : tops[0].id) : tops[0]?.id;

  const confirm = () => {
    const bottoms = peeks.filter((p) => where(p) === "bottom");
    const topOrder = [...tops.filter((p) => p.id !== firstId), ...tops.filter((p) => p.id === firstId)];
    const presses: Press[] = [
      ...bottoms.flatMap((p) => (p.bottom?.customId ? [{ channelId: p.channelId, messageId: p.id, customId: p.bottom.customId, label: `${p.agenda.name} to the bottom` }] : [])),
      ...topOrder.flatMap((p) => (p.top?.customId ? [{ channelId: p.channelId, messageId: p.id, customId: p.top.customId, label: `${p.agenda.name} to the top` }] : [])),
    ];
    void run(`agendas:${d.id}`, presses, (dismiss) => peeks.forEach((p) => dismiss(p.id)));
  };

  if (runner.running?.startsWith("agendas:")) {
    return (
      <div className={classes.panel}>
        <div className={classes.progress}>
          <Loader size={14} /> {runner.label} ({runner.step}/{runner.total})
        </div>
      </div>
    );
  }

  return (
    <div className={classes.panel}>
      <CardHeader sc={3} data={data} sub="Only you see these">
        <p className={classes.effect}>Put each agenda on the top or the bottom of the agenda deck.</p>
      </CardHeader>
      <div className={classes.agendaPair}>
        {peeks.map((p) => (
          <div key={p.id} className={classes.agendaCol}>
            <AgendaCard agenda={p.agenda} compact />
            <div className={classes.segmented} role="radiogroup" aria-label={`${p.agenda.name}: top or bottom`}>
              {(["top", "bottom"] as const).map((w) => (
                <UnstyledButton
                  key={w}
                  role="radio"
                  aria-checked={where(p) === w}
                  className={cx(classes.segment, where(p) === w && classes.segmentOn)}
                  onClick={() => setPlace({ ...place, [p.id]: w })}
                  disabled={busy}
                >
                  {w === "top" ? "Top" : "Bottom"}
                </UnstyledButton>
              ))}
            </div>
            {tops.length > 1 && where(p) === "top" && (
              <UnstyledButton
                role="radio"
                aria-checked={firstId === p.id}
                className={cx(classes.segment, classes.firstPick, firstId === p.id && classes.segmentOn)}
                onClick={() => setFirst(p.id)}
                disabled={busy}
              >
                {firstId === p.id ? "Revealed first" : "Reveal this first"}
              </UnstyledButton>
            )}
          </div>
        ))}
      </div>
      {tops.length > 1 && (
        <p className={classes.sub}>
          Next agenda phase: {peeks.find((p) => p.id === firstId)?.agenda.name} first, then{" "}
          {tops.find((p) => p.id !== firstId)?.agenda.name}.
        </p>
      )}
      <ChoiceButton
        choice={{ key: "agendas-confirm", kind: "button", customId: "agendas-confirm", label: "Confirm", style: 3, disabled: !peeks.length, rank: "primary", component: { type: 2 } }}
        onPress={confirm}
        pending={false}
        busy={busy}
        emphasis
      />
      {runner.error && <span className={classes.error}>Did not go through: {runner.error}</span>}
    </div>
  );
}
