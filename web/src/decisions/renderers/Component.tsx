import { techs } from "@/entities/data/tech";
import { leaders } from "@/entities/data/leaders";
import { relics } from "@/entities/data/relics";
import { promissoryNotes } from "@/entities/data/promissoryNotes";
import { abilities } from "@/entities/data/abilities";
import { breakthroughs } from "@/entities/data/breakthroughs";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButton, ChoiceButtons } from "../ui/ChoiceButtons";
import type { RendererProps } from "./types";
import classes from "./renderers.module.css";

type Group = "Technologies" | "Leaders" | "Abilities" | "Relics" | "Promissory notes" | "Breakthroughs" | "Other";
const ORDER: Group[] = ["Technologies", "Leaders", "Abilities", "Relics", "Promissory notes", "Breakthroughs", "Other"];

/** The ACTION line of a card's text, else its first sentence. */
function actionLine(text?: string) {
  if (!text) return undefined;
  const action = text.match(/ACTION:\s*([^\n]+)/i)?.[1];
  const line = (action ?? text.split(/\n/)[0]).replace(/[_*]/g, "").trim();
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

/** Which kind of component a component-action button uses, and the one-line effect from its card. */
function describe(c: Choice): { group: Group; effect?: string } {
  const id = baseId(c.customId).replace(/^componentActionRes_/, "");
  const tech = id.match(/^exhaustTech_(.+)$/)?.[1];
  if (tech) return { group: "Technologies", effect: actionLine(techs.find((t) => t.alias === tech)?.text) };
  const leader = id.match(/^leader_(.+)$/)?.[1];
  if (leader) return { group: "Leaders", effect: actionLine(leaders.find((l) => l.id === leader)?.abilityText) };
  const relic = id.match(/^relic_(.+)$/)?.[1];
  if (relic) return { group: "Relics", effect: actionLine(relics.find((r) => r.alias === relic)?.text) };
  const pn = id.match(/^pn_(.+)$/)?.[1];
  if (pn) {
    const note = promissoryNotes.find((p) => p.alias === pn || pn.endsWith(p.alias.replace(/^<color>/, "")));
    return { group: "Promissory notes", effect: actionLine(note?.text) };
  }
  const ability = id.match(/^ability_(.+)$/)?.[1];
  if (ability) {
    const a = abilities.find((x) => x.id.replace(/_/g, "").toLowerCase() === ability.toLowerCase());
    return { group: "Abilities", effect: actionLine(a?.windowEffect) };
  }
  const bt = id.match(/^exhaustBT_(.+)$/)?.[1];
  if (bt) return { group: "Breakthroughs", effect: actionLine(breakthroughs.find((b) => b.alias === bt)?.text) };
  return { group: "Other" };
}

/** Component action: the real actions on offer, grouped by source, each with its effect in one line. */
export function ComponentBody({ d, onPress, pendingKey }: RendererProps) {
  const actions = d.choices.filter((c) => c.rank !== "undo" && c.kind !== "link" && baseId(c.customId) !== "deleteButtons");
  const rest = d.choices.filter((c) => !actions.includes(c));
  const groups = ORDER.map((g) => ({ g, list: actions.filter((c) => describe(c).group === g) })).filter((x) => x.list.length);
  return (
    <div className={classes.stack}>
      {!actions.length && <p className={classes.hint}>Nothing you own has a component action you can use right now.</p>}
      {groups.map(({ g, list }) => (
        <div key={g} className={classes.step}>
          <span className={classes.stepLabel}>{g}</span>
          {list.map((c) => {
            const effect = describe(c).effect;
            return (
              <div key={c.key}>
                <ChoiceButton choice={{ ...c, style: 2, label: c.label.replace(/^(Use|Exhaust|Purge) /, "$1 ") }} onPress={onPress} pending={pendingKey === c.key} busy={!!pendingKey} />
                {effect && <p className={classes.hint}>{effect}</p>}
              </div>
            );
          })}
        </div>
      ))}
      <ChoiceButtons choices={rest} onPress={onPress} pendingKey={pendingKey} channelId={d.prompt.channelId} />
    </div>
  );
}
