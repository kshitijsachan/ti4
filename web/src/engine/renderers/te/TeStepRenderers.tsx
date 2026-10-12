import type { ReactNode } from "react";
import { UnstyledButton } from "@mantine/core";
import cx from "clsx";
import type { Decision, GameState, Option } from "../../../../../shim/src/engine/types";
import type { TeBreach, TeBreakthrough, TePlot, TeStepFields } from "../../../../../shim/src/engine/kinds/te";
import type { TeRendererProps } from "./TeRenderers";
import classes from "./Te.module.css";

const BREAKTHROUGH_NAME: Record<string, string> = {
  empyreanbt: "Void Tether",
  saarbt: "Deorbit Barrage",
  nomadbt: "Thunder's Paradox",
  firmamentbt: "The Sowing",
  obsidianbt: "The Reaping",
  bastionbt: "The Icon",
  ralnelbt: "Data Skimmer",
  naalubt: "Mindsieve",
  stoneembrace: "Stone Embrace",
  cabalbt: "Al'Raith Ix Ianovar",
  mahactbt: "Vaults of the Heir",
  l1z1xbt: "Fealty Uplink",
  arborecbt: "Psychospore",
  muaatbt: "Stellar Genesis",
  nekrobt: "Valefar Assimilator Z",
  yssarilbt: "Deepgloom Executable",
  eidolonmaximum: "Eidolon Maximum",
  executiveorder: "Executive Order",
  crimsonbt: "Resonance Generator",
  incursion: "Incursion",
};

const UNIT_NAME: Record<string, string> = {
  ws: "War sun",
  fs: "Flagship",
  dn: "Dreadnought",
  cv: "Carrier",
  ca: "Cruiser",
  dd: "Destroyer",
  ff: "Fighter",
  mf: "Mech",
  gf: "Infantry",
  pd: "PDS",
  sd: "Space dock",
};

/** "placeVoidTether" → "Place void tether". */
function stepTitle(step: string) {
  const words = step
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function tileLabel(state: GameState | null, position: string) {
  const tile = state?.tiles.find((t) => t.position === position);
  const planets = tile?.holders.filter((h) => h.name !== "space").map((h) => h.name) ?? [];
  return planets.length ? `${position} (${planets.join(", ")})` : position;
}

/** What one typed option does, from its fields (ids only). */
function describe(v: TeStepFields & { plot?: string }, state: GameState | null): string {
  const parts: string[] = [];
  if (v.plot) parts.push(`Plot ${v.plot}`);
  if (v.target) parts.push(v.target);
  if (v.unit) parts.push(UNIT_NAME[v.unit] ?? v.unit);
  if (v.planet) parts.push(v.planet);
  if (v.tile) parts.push(tileLabel(state, v.tile));
  if (v.to) parts.push(`to ${tileLabel(state, v.to)}`);
  if (v.from) parts.push(`from ${tileLabel(state, v.from)}`);
  if (v.amount !== undefined) parts.push(String(v.amount));
  if (v.tech) parts.push(v.tech);
  if (v.choice) parts.push(v.choice);
  if (v.dir !== undefined) parts.push(`side ${v.dir}`);
  return parts.length ? parts.join(" · ") : stepTitle(v.step);
}

function Choice(props: { onClick: () => void; go?: boolean; back?: boolean; children: ReactNode; sub?: ReactNode }) {
  return (
    <UnstyledButton className={cx(classes.choice, props.go && classes.go, props.back && classes.back)} onClick={props.onClick}>
      <span>{props.children}</span>
      {props.sub && <span className={classes.sub}>{props.sub}</span>}
    </UnstyledButton>
  );
}

function StepPrompt({
  decision,
  state,
  answer,
  eyebrow,
  title,
}: {
  decision: Decision;
  state: GameState | null;
  answer: (optionId: string) => void;
  eyebrow: string;
  title: string;
}) {
  const live = (decision.options as Option<(TeStepFields & { plot?: string }) | null>[]).filter((o) => !o.disabled && !o.needsInput);
  const typed = live.filter((o) => o.value);
  const rest = live.filter((o) => !o.value);
  return (
    <div className={classes.stack}>
      <p className={classes.eyebrow}>{eyebrow}</p>
      <p className={classes.title}>{title}</p>
      <div className={classes.grid}>
        {typed.map((o) => (
          <Choice key={o.id} go={o.value!.action === "use"} back={o.value!.action === "skip"} onClick={() => answer(o.id)} sub={stepTitle(o.value!.step)}>
            {describe(o.value!, state)}
          </Choice>
        ))}
      </div>
      {rest.length > 0 && (
        <div className={classes.row}>
          {rest.map((o) => (
            <Choice key={o.id} back onClick={() => answer(o.id)}>
              {o.label || "Done"}
            </Choice>
          ))}
        </div>
      )}
    </div>
  );
}

export function Breakthrough({ decision, state, answer }: TeRendererProps<TeBreakthrough>) {
  const v = decision.options.find((o) => o.value)?.value;
  const name = v ? (BREAKTHROUGH_NAME[v.breakthrough] ?? v.breakthrough) : "Breakthrough";
  return <StepPrompt decision={decision} state={state} answer={answer} eyebrow="Breakthrough" title={v ? `${name}: ${stepTitle(v.step)}` : name} />;
}

export function Breach({ decision, state, answer }: TeRendererProps<TeBreach>) {
  const v = decision.options.find((o) => o.value)?.value;
  return <StepPrompt decision={decision} state={state} answer={answer} eyebrow="Breach" title={v ? stepTitle(v.step) : "Breach"} />;
}

export function Plot({ decision, state, answer }: TeRendererProps<TePlot>) {
  const v = decision.options.find((o) => o.value)?.value;
  const title = v?.panel ? "Plot cards" : v ? stepTitle(v.step) : "Plot";
  return <StepPrompt decision={decision} state={state} answer={answer} eyebrow={v?.ability === "marionettes" ? "The Obsidian" : "The Firmament"} title={title} />;
}
