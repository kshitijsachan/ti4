import { baseId, type Choice } from "../../model/controls";
import { ChoiceButton } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { CardHeader } from "./shared";
import classes from "./strategy.module.css";

const DIPLO = /^diplo_\w+?_diploP$/;

export function isDiploSystemStep(choices: Choice[]) {
  return choices.some((c) => DIPLO.test(baseId(c.customId)));
}

/** "304 (Mez Lo Orz Fei Zsha/Rep Lo Orz Qet - Ral Nel)" → position and planets. */
function systemOf(c: Choice) {
  const m = c.label.match(/^(\w+)\s*\((.*?)(?:\s+-\s+[^)]*)?\)\s*$/);
  return m ? { position: m[1], planets: m[2].split("/").join(", ") } : { position: "", planets: c.label };
}

/**
 * Diplomacy's primary, step 2: which of my systems to protect. Each system names its planets; every other player
 * puts a command token there, so nobody can activate it this round.
 */
export function DiploSystemBody({ d, data, onPress, pendingKey }: RendererProps) {
  const systems = d.choices.filter((c) => DIPLO.test(baseId(c.customId)));
  return (
    <div className={classes.panel}>
      <CardHeader sc={2} data={data} sub="Your strategy card">
        <p className={classes.effect}>Choose a system with a planet you control (not Mecatol Rex). Every other player places a command token in it.</p>
      </CardHeader>
      <div className={classes.actions}>
        {systems.map((c) => {
          const s = systemOf(c);
          return (
            <ChoiceButton
              key={c.key}
              choice={{ ...c, label: s.position ? `System ${s.position} · ${s.planets}` : c.label, style: 2 }}
              onPress={onPress}
              pending={pendingKey === c.key}
              busy={!!pendingKey}
            />
          );
        })}
      </div>
    </div>
  );
}
