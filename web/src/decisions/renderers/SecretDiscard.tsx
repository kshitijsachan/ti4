import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { secretObjectives } from "@/entities/data/secretObjectives";
import type { SecretObjective } from "@/entities/data/types";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import type { RendererProps } from "./types";
import classes from "./renderers.module.css";

const DISCARD = /^(?:discardSecret_|SODISCARD_)\d+/;
const PREFERRED_SOURCES = ["base", "pok", "codex1", "codex2", "codex3", "codex4", "thunders_edge", "te"];

/** "Discard (490) Become the Gatekeeper" → its card. */
function cardOf(c: Choice): { name: string; card?: SecretObjective } {
  const name = c.label.replace(/^discard\s*(\(\s*\d+\s*\))?\s*/i, "").trim() || c.label;
  const same = secretObjectives.filter((so) => so.name.toLowerCase() === name.toLowerCase());
  const card =
    same.sort((a, b) => rank(a.source) - rank(b.source))[0] ??
    secretObjectives.find((so) => so.name.toLowerCase().startsWith(name.toLowerCase()));
  return { name, card };
}

function rank(source?: string) {
  const i = PREFERRED_SOURCES.indexOf(String(source ?? "").toLowerCase());
  return i < 0 ? 99 : i;
}

/**
 * Which secret objective to keep. With two in hand you pick the one to KEEP (the bot is told to discard the
 * other); with more you pick the one to discard.
 */
export function SecretDiscardBody({ d, onPress, pendingKey }: RendererProps) {
  const offered = d.choices.filter((c) => DISCARD.test(baseId(c.customId)) && !c.disabled).map((c) => ({ c, ...cardOf(c) }));
  const rest = d.choices.filter((c) => !offered.some((o) => o.c === c));
  const keepMode = !d.redraw && offered.length === 2;
  const discardWord = d.redraw ? "Swap out" : "Discard";
  const [selected, setSelected] = useState<string | null>(null);
  const current = offered.find((o) => o.c.key === selected);
  const other = keepMode && current ? offered.find((o) => o !== current) : undefined;
  const pressTarget = keepMode ? other?.c : current?.c;

  return (
    <div className={classes.stack}>
      <p className={classes.hint}>{d.text}</p>
      <div className={classes.soList} role="listbox" aria-label="Secret objectives">
        {offered.map(({ c, name, card }) => (
          <UnstyledButton
            key={c.key}
            role="option"
            aria-selected={c.key === selected}
            className={cx(classes.soCard, c.key === selected && classes.soCardSelected)}
            onClick={() => setSelected(c.key)}
          >
            <span className={classes.soHead}>
              <span className={classes.soName}>{card?.name ?? name}</span>
              {card?.phase && <span className={classes.soPhase}>{phaseLabel(card.phase)}</span>}
            </span>
            {card?.text && <span className={classes.soText}>{card.text}</span>}
            {c.key === selected && <span className={classes.soMark}>{keepMode ? "Keep" : discardWord}</span>}
          </UnstyledButton>
        ))}
      </div>
      {current && pressTarget && (
        <UnstyledButton className={classes.bigConfirm} disabled={!!pendingKey} onClick={() => onPress(pressTarget)}>
          {pendingKey === pressTarget.key ? <Loader size={16} color="currentColor" /> : null}
          {keepMode ? `Keep ${current.card?.name ?? current.name}` : `${discardWord} ${current.card?.name ?? current.name}`}
        </UnstyledButton>
      )}
      {!current && <p className={classes.hint}>{keepMode ? "Pick the one you want to keep." : d.redraw ? "Pick the one to swap for a new draw." : "Pick the one to discard."}</p>}
      {rest.length > 0 && (
        <ChoiceButtons
          choices={rest}
          onPress={onPress}
          pendingKey={pendingKey}
          channelId={d.prompt.channelId}
          rankOf={(c) => (c.rank === "primary" ? "secondary" : c.rank)}
        />
      )}
    </div>
  );
}

function phaseLabel(phase: string) {
  const p = phase.toLowerCase();
  return p === "status" ? "Status phase" : p === "action" ? "Action phase" : p === "agenda" ? "Agenda phase" : phase;
}
