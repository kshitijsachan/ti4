import { useState } from "react";
import cx from "clsx";
import { getTechData } from "@/entities/lookup/tech";
import { Choice, ErrorLine, useAnswer } from "./parts";
import type { Renderer } from "./types";
import classes from "./Setup.module.css";

const TYPE_CLASS: Record<string, string | undefined> = {
  PROPULSION: classes.tech_propulsion,
  BIOTIC: classes.tech_biotic,
  CYBERNETIC: classes.tech_cybernetic,
  WARFARE: classes.tech_warfare,
  propulsion: classes.tech_propulsion,
  biotic: classes.tech_biotic,
  cybernetic: classes.tech_cybernetic,
  warfare: classes.tech_warfare,
};

function TechDot({ type }: { type: string | undefined }) {
  return <span className={cx(classes.techDot, type && TYPE_CLASS[type])} />;
}

/** Gain a technology: the cards by id, text on selection. Starting technologies are free. */
export const TechGainRenderer: Renderer<"tech.gain"> = ({ decision, state, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  const [selected, setSelected] = useState<string | null>(null);
  const owned = new Set(state?.players.find((p) => p.self)?.techs ?? []);
  const options = decision.options.filter((o) => o.value);
  const extra = decision.options.filter((o) => !o.value);
  const starting = options.some((o) => o.value!.starting);
  const chosen = options.find((o) => o.id === selected);
  const chosenTech = chosen ? getTechData(chosen.value!.tech) : undefined;
  return (
    <div className={classes.stack}>
      <p className={classes.title}>{starting ? "Choose a starting technology" : "Gain a technology"}</p>
      <div className={classes.grid}>
        {options.map((o) => {
          const t = getTechData(o.value!.tech);
          const have = owned.has(o.value!.tech);
          return (
            <Choice
              key={o.id}
              name={t?.name ?? o.label}
              icon={<TechDot type={t?.types?.[0]} />}
              sub={have ? "Owned" : t?.requirements ? `Requires ${t.requirements}` : "No prerequisites"}
              selected={o.id === selected}
              disabled={o.disabled || have || !!pending}
              onClick={() => setSelected(o.id)}
            />
          );
        })}
      </div>
      {chosen && (
        <div className={classes.stack}>
          {chosenTech?.text && <p className={classes.cardText}>{chosenTech.text}</p>}
          <div className={classes.row}>
            <Choice
              name={`Take ${chosenTech?.name ?? chosen.label}`}
              go
              disabled={!!pending}
              pending={pending === chosen.id}
              onClick={() => void press(chosen.id)}
            />
          </div>
        </div>
      )}
      {extra.length > 0 && (
        <div className={classes.row}>
          {extra.map((o) => (
            <Choice key={o.id} name={o.label} disabled={o.disabled || !!pending} pending={pending === o.id} onClick={() => void press(o.id)} />
          ))}
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
};

const TYPE_LABEL: Record<string, string> = {
  propulsion: "Propulsion",
  biotic: "Biotic",
  cybernetic: "Cybernetic",
  warfare: "Warfare",
  unitupgrade: "Unit upgrade",
  allTechResearchable: "Any technology",
};

/** Open technology choice: pick a type, then the technology (tech.gain follows). */
export const TechChooseTypeRenderer: Renderer<"tech.choose_type"> = ({ decision, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  return (
    <div className={classes.stack}>
      <p className={classes.title}>Get a technology</p>
      <div className={classes.row}>
        {decision.options.map((o) => {
          const type = o.value?.techType ?? null;
          return (
            <Choice
              key={o.id}
              name={o.value ? (type ? TYPE_LABEL[type] ?? type : "Choose a technology") : o.label}
              icon={type ? <TechDot type={type} /> : undefined}
              sub={o.value?.free ? "Free" : undefined}
              disabled={o.disabled || !!pending}
              pending={pending === o.id}
              onClick={() => void press(o.id)}
            />
          );
        })}
      </div>
      <ErrorLine error={error} />
    </div>
  );
};
