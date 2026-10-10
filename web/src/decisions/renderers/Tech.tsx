import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { techs } from "@/entities/data/tech";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import type { RendererProps } from "./types";
import classes from "./renderers.module.css";

const GET_TECH = /^getTech_([^_]+)/;

/** Signal colours of the four tech types (fixed in every theme). */
const TYPE_TONE: Record<string, string> = {
  PROPULSION: "propulsion",
  BIOTIC: "biotic",
  CYBERNETIC: "cybernetic",
  WARFARE: "warfare",
  UNITUPGRADE: "unit",
};
const PREREQ_TONE: Record<string, string> = { B: "propulsion", G: "biotic", Y: "cybernetic", R: "warfare" };
const ORDER = ["PROPULSION", "BIOTIC", "CYBERNETIC", "WARFARE", "UNITUPGRADE"];

function techOf(c: Choice) {
  const alias = baseId(c.customId).match(GET_TECH)?.[1];
  if (!alias) return undefined;
  return techs.find((t) => t.alias === alias && !t.homebrewReplacesID) ?? techs.find((t) => t.alias === alias);
}

/** Research a technology: the offered techs by colour with prerequisites and text, pick then confirm. */
export function TechBody({ d, data, onPress, pendingKey }: RendererProps) {
  const offered = d.choices
    .map((c) => ({ c, tech: techOf(c) }))
    .filter((x) => x.tech || GET_TECH.test(baseId(x.c.customId)))
    .sort((a, b) => ORDER.indexOf(a.tech?.types[0] ?? "") - ORDER.indexOf(b.tech?.types[0] ?? ""));
  const rest = d.choices.filter((c) => !offered.some((o) => o.c === c));
  const [selected, setSelected] = useState<string | null>(null);
  const current = offered.find((o) => o.c.key === selected);
  return (
    <div className={classes.stack}>
      <p className={classes.hint}>
        {d.setup ? `${d.text} ` : data.me ? `${data.me.resources} resources ready, ${data.me.tg} TG. ` : ""}Pick one to read it.
      </p>
      <div className={classes.techList} role="listbox" aria-label="Technologies">
        {offered.map(({ c, tech }) => (
          <UnstyledButton
            key={c.key}
            role="option"
            aria-selected={c.key === selected}
            className={cx(classes.techRow, c.key === selected && classes.techRowSelected)}
            onClick={() => setSelected(c.key)}
            onDoubleClick={() => onPress(c)}
          >
            <span className={cx(classes.techDot, classes[`tone_${TYPE_TONE[tech?.types[0] ?? ""] ?? "unit"}`])} />
            <span className={classes.techName}>{tech?.name ?? c.label}</span>
            <span className={classes.grow} />
            <span className={classes.prereqs} title="Prerequisites">
              {(tech?.requirements ?? "").split("").map((r, i) => (
                <span key={i} className={cx(classes.techDot, classes.small, classes[`tone_${PREREQ_TONE[r] ?? "unit"}`])} />
              ))}
            </span>
          </UnstyledButton>
        ))}
      </div>
      {current && (
        <>
          <p className={classes.cardText} style={{ whiteSpace: "pre-line" }}>
            {current.tech?.text ?? current.c.label}
          </p>
          <UnstyledButton className={classes.bigConfirm} disabled={!!pendingKey} onClick={() => onPress(current.c)}>
            {pendingKey === current.c.key ? <Loader size={16} color="currentColor" /> : null}
            {d.setup ? "Start with" : "Research"} {current.tech?.name ?? current.c.label}
          </UnstyledButton>
        </>
      )}
      <ChoiceButtons
        choices={rest}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={(c) => (c.rank === "primary" ? "secondary" : c.rank)}
      />
    </div>
  );
}
