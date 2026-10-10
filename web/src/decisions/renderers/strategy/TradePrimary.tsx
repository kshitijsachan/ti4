import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { usePlay } from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { useFactionBundles } from "@/faction/data";
import { baseId, choicesOf, type Choice } from "../../model/controls";
import { ChoiceButton } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { CARDS } from "./cards";
import { useRunner, useRunSequence, type Press } from "./runner";
import { CardHeader, playerLabel } from "./shared";
import classes from "./strategy.module.css";

const FORCE = /^forceARefresh_(\w+)/;
const DONE = /^deleteButtons$/;

/** The bot's "you may force players to replenish commodities" prompt: folded in as a step, else the newest one after the card. */
function useForcePrompt(d: RendererProps["d"]) {
  const folded = d.steps?.find((s) => s.choices.some((c) => FORCE.test(baseId(c.customId))));
  const data = usePlay((s) => s.messages[d.prompt.channelId]);
  if (folded) return { id: folded.id, channelId: folded.prompt.channelId, choices: folded.choices };
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (!m || compareSnowflakes(m.id, d.id) < 0) break;
    const choices = choicesOf(m);
    if (choices.some((c) => FORCE.test(baseId(c.customId)))) return { id: m.id, channelId: d.prompt.channelId, choices };
  }
  return undefined;
}

/**
 * My Trade, just played. The bot already gave me 3 trade goods and refilled my commodities; what is left is whom to
 * replenish for free (a deal, or to trigger a Trade Agreement). One checklist with each player's commodities, one
 * confirm that presses the bot's per-player buttons then its "Done Resolving", and the card's prompt is put away.
 */
export function TradePrimaryBody({ d, data }: RendererProps) {
  const force = useForcePrompt(d);
  const bundles = useFactionBundles();
  const run = useRunSequence();
  const runner = useRunner();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const me = data.me;

  const targets = (force?.choices ?? [])
    .map((c) => ({ choice: c, faction: baseId(c.customId).match(FORCE)?.[1] ?? "" }))
    .filter((t) => t.faction && !t.choice.disabled);
  const done = force?.choices.find((c) => DONE.test(baseId(c.customId)));
  const busy = !!runner.running;

  const toggle = (f: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const confirm = () => {
    const presses: Press[] = [];
    if (force) {
      for (const t of targets.filter((x) => picked.has(x.faction))) {
        presses.push({ channelId: force.channelId, messageId: force.id, customId: t.choice.customId!, label: `Replenishing ${t.faction}` });
      }
      if (done?.customId) presses.push({ channelId: force.channelId, messageId: force.id, customId: done.customId, label: "Finishing" });
    }
    void run(`trade:${d.id}`, presses, (dismiss) => {
      dismiss(d.id);
      if (force) dismiss(force.id);
    });
  };

  const factionName = (f: string, c: Choice) => bundles?.official.factions[f]?.factionName ?? c.label;
  const count = picked.size;
  return (
    <div className={classes.panel}>
      <CardHeader sc={5} data={data} sub="Your strategy card · resolved automatically">
        <p className={classes.effect}>{CARDS[5].primary}</p>
      </CardHeader>
      {me && (
        <div className={classes.numbers}>
          <span className={classes.number}>
            <span className={classes.numberValue}>{me.tg}</span>
            <span className={classes.numberLabel}>Trade goods (+3 gained)</span>
          </span>
          <span className={classes.number}>
            <span className={classes.numberValue}>
              {me.commodities}/{me.commoditiesTotal}
            </span>
            <span className={classes.numberLabel}>Commodities (replenished)</span>
          </span>
        </div>
      )}
      {targets.length > 0 && (
        <>
          <span className={classes.sectionLabel}>Replenish other players for free (optional, usually a deal)</span>
          <div className={classes.checklist} role="group" aria-label="Players to replenish">
            {targets.map((t) => {
              const p = data.players.find((x) => x.faction === t.faction);
              const on = picked.has(t.faction);
              return (
                <UnstyledButton
                  key={t.faction}
                  role="checkbox"
                  aria-checked={on}
                  className={classes.checkItem}
                  onClick={() => toggle(t.faction)}
                  disabled={busy}
                >
                  <span className={classes.checkBox}>{on && <IconCheck size={12} />}</span>
                  <span className={classes.checkName}>
                    {p ? playerLabel(p) : t.choice.label}
                    <span className={classes.sub}> · {factionName(t.faction, t.choice)}</span>
                  </span>
                  {p && (
                    <span className={classes.checkMeta} title="Commodities now / after">
                      {p.commodities}/{p.commoditiesTotal}
                      {on && p.commodities < p.commoditiesTotal ? ` → ${p.commoditiesTotal}` : ""}
                    </span>
                  )}
                </UnstyledButton>
              );
            })}
          </div>
          <p className={classes.sub}>A player you replenish counts as following Trade, and it can trigger a Trade Agreement you hold.</p>
        </>
      )}
      {runner.running?.startsWith("trade:") ? (
        <div className={classes.progress}>
          <Loader size={14} /> {runner.label} ({runner.step}/{runner.total})
        </div>
      ) : (
        <ChoiceButton
          choice={{
            key: "trade-confirm",
            kind: "button",
            label: count ? `Replenish ${count} player${count === 1 ? "" : "s"} and finish` : "Done — nobody else",
            style: 3,
            disabled: false,
            rank: "primary",
            component: { type: 2 },
            customId: "trade-confirm",
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
