import type { ReactNode } from "react";
import { UnstyledButton } from "@mantine/core";
import cx from "clsx";
import type { Decision, GameState, Option } from "../../../../../shim/src/engine/types";
import type {
  ExpeditionKey,
  TeExpedition,
  TeFractureIngress,
  TeFractureRoll,
  TeGalvanize,
  TeGalvanizeValue,
  TePlaceThundersEdge,
  TeVisionaria,
} from "../../../../../shim/src/engine/kinds/te";
import classes from "./Te.module.css";
import { playerLabel } from "../../names";

export type TeRendererProps<D extends Decision = Decision> = {
  decision: D;
  state: GameState | null;
  answer: (optionId: string) => void;
};

const EXPEDITION_COST: Record<ExpeditionKey, string> = {
  techSkip: "Exhaust 1 technology specialty planet",
  tradeGoods: "Spend 3 trade goods",
  fiveRes: "Spend 5 resources",
  fiveInf: "Spend 5 influence",
  secret: "Discard 1 secret objective",
  actionCards: "Discard 2 action cards",
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

function live<V>(d: { options: Option<V>[] }) {
  return d.options.filter((o) => !o.disabled && !o.needsInput);
}

/** The prompt's dismiss / commit button (value null, handler deleteButtons). */
function doneOf(d: Decision) {
  return (d.options as Option<unknown>[]).find((o) => o.value === null && /^deleteButtons(_|$)/.test(o.handler));
}

function Choice(props: { onClick: () => void; disabled?: boolean; go?: boolean; back?: boolean; children: ReactNode; sub?: ReactNode }) {
  return (
    <UnstyledButton
      className={cx(classes.choice, props.go && classes.go, props.back && classes.back)}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span>{props.children}</span>
      {props.sub && <span className={classes.sub}>{props.sub}</span>}
    </UnstyledButton>
  );
}

function Header({ eyebrow, title, hint }: { eyebrow: string; title: string; hint?: ReactNode }) {
  return (
    <>
      <p className={classes.eyebrow}>{eyebrow}</p>
      <p className={classes.title}>{title}</p>
      {hint && <p className={classes.hint}>{hint}</p>}
    </>
  );
}

function tileLabel(state: GameState | null, position: string) {
  const tile = state?.tiles.find((t) => t.position === position);
  const planets = tile?.holders.filter((h) => h.name !== "space").map((h) => h.name) ?? [];
  return planets.length ? `${position} (${planets.join(", ")})` : position;
}

export function FractureRoll({ decision, answer }: TeRendererProps<TeFractureRoll>) {
  const opt = live(decision).find((o) => o.value);
  const spawn = !!opt?.value?.spawn;
  return (
    <div className={classes.stack}>
      <Header
        eyebrow="Breakthrough"
        title={spawn ? "Bring The Fracture into play" : "Roll for The Fracture"}
        hint={
          spawn
            ? "Your breakthrough brings The Fracture in without a roll. You may roll for other breakthroughs first."
            : "A breakthrough was unlocked while The Fracture is not in play: roll one die. On a 1 or a 10 it enters play."
        }
      />
      {opt && (
        <div className={classes.row}>
          <Choice go onClick={() => answer(opt.id)} disabled={opt.value?.canEnterPlay === false}>
            {spawn ? "Spawn The Fracture" : "Roll"}
          </Choice>
        </div>
      )}
    </div>
  );
}

export function FractureIngress({ decision, state, answer }: TeRendererProps<TeFractureIngress>) {
  const systems = live(decision).filter((o) => o.value);
  const done = doneOf(decision);
  const placed = Number(decision.progress?.accumulated?.placed ?? 0);
  const perType = Number(decision.progress?.required?.perType ?? systems[0]?.value?.perType ?? 1);
  const skip = systems[0]?.value?.skips.join(" / ");
  return (
    <div className={classes.stack}>
      <Header
        eyebrow="The Fracture"
        title="Place ingress tokens"
        hint="Ships move between a system with an ingress token and The Fracture. Systems with only one legal choice were filled automatically."
      />
      <p className={classes.progress}>
        Placed <span className={classes.num}>{placed}</span> of <span className={classes.num}>{perType}</span>
        {skip ? ` for this technology type (${skip})` : ""}
      </p>
      <div className={classes.grid}>
        {systems.map((o) => (
          <Choice key={o.id} onClick={() => answer(o.id)} disabled={o.value!.hasIngress || placed >= perType} sub={o.value!.skips.join(", ")}>
            {tileLabel(state, o.value!.position)}
          </Choice>
        ))}
      </div>
      {done && (
        <div className={classes.row}>
          <Choice back={placed < perType} go={placed >= perType} onClick={() => answer(done.id)}>
            Done
          </Choice>
        </div>
      )}
    </div>
  );
}

export function Galvanize({ decision, state, answer }: TeRendererProps<TeGalvanize>) {
  const opts = live(decision).filter((o) => o.value);
  const done = doneOf(decision);
  const mandatory = decision.progress?.required?.mandatory === true;
  const galvanized = Number(decision.progress?.accumulated?.galvanized ?? 0);
  const systemPick = opts.every((o) => o.value!.action === "system");
  if (systemPick) {
    return (
      <div className={classes.stack}>
        <Header eyebrow="Galvanize" title="Choose the system" />
        <div className={classes.grid}>
          {opts.map((o) => (
            <Choice key={o.id} onClick={() => answer(o.id)}>
              {tileLabel(state, o.value!.position)}
            </Choice>
          ))}
        </div>
      </div>
    );
  }
  const units = opts.filter((o) => o.value!.action !== "system");
  return (
    <div className={classes.stack}>
      <Header
        eyebrow={mandatory ? "Bastion agent" : "Galvanize"}
        title={mandatory ? "Galvanize one of your units" : "Galvanize units"}
        hint={mandatory ? "You were chosen: galvanize exactly one unit in the active system." : undefined}
      />
      {mandatory && (
        <p className={classes.progress}>
          Galvanized <span className={classes.num}>{galvanized}</span> of <span className={classes.num}>1</span>
        </p>
      )}
      <div className={classes.grid}>
        {units.map((o) => {
          const v = o.value as Extract<TeGalvanizeValue, { unit: string }>;
          const add = v.action === "galvanize";
          return (
            <Choice
              key={o.id}
              go={add}
              back={!add}
              disabled={mandatory && add && galvanized >= 1}
              onClick={() => answer(o.id)}
              sub={v.holder === "space" ? "in space" : `on ${v.holder}`}
            >
              {add ? "Galvanize" : "Remove galvanize"} {UNIT_NAME[v.unit] ?? v.unit}
            </Choice>
          );
        })}
      </div>
      {done && (
        <div className={classes.row}>
          <Choice go onClick={() => answer(done.id)} disabled={decision.progress?.canCommit === false}>
            Done
          </Choice>
        </div>
      )}
    </div>
  );
}

export function Expedition({ decision, state, answer }: TeRendererProps<TeExpedition>) {
  const opts = live(decision).filter((o) => o.value);
  const done = doneOf(decision);
  const completed = Object.entries(state?.thundersEdge?.expeditions ?? {}).filter(([, f]) => f);
  const unlocks = opts.some((o) => o.value!.unlocksBreakthrough);
  return (
    <div className={classes.stack}>
      <Header
        eyebrow="Thunder's Edge"
        title="Do an expedition"
        hint={unlocks ? "Completing an expedition unlocks your breakthrough." : "The player who completes the last expedition places Thunder's Edge."}
      />
      <div className={classes.grid}>
        {opts.map((o) => (
          <Choice key={o.id} go={o.value!.affordable} disabled={!o.value!.affordable} onClick={() => answer(o.id)} sub={o.value!.affordable ? undefined : "can't pay now"}>
            {EXPEDITION_COST[o.value!.expedition] ?? o.value!.expedition}
          </Choice>
        ))}
      </div>
      {completed.length > 0 && (
        <ul className={classes.list}>
          {completed.map(([k, f]) => (
            <li key={k} className={classes.done}>
              {EXPEDITION_COST[k as ExpeditionKey] ?? k}: done by {f}
            </li>
          ))}
        </ul>
      )}
      {done && (
        <div className={classes.row}>
          <Choice back onClick={() => answer(done.id)}>
            Not now
          </Choice>
        </div>
      )}
    </div>
  );
}

export function PlaceThundersEdge({ decision, state, answer }: TeRendererProps<TePlaceThundersEdge>) {
  const opts = live(decision).filter((o) => o.value);
  const step = opts[0]?.value?.step ?? "start";
  const factionName = (f: string) => playerLabel(state, f);
  const title = step === "infantry" ? "Who places infantry on it?" : step === "system" ? "Choose its system" : "Place Thunder's Edge";
  return (
    <div className={classes.stack}>
      <Header
        eyebrow="Thunder's Edge"
        title={title}
        hint={
          step === "system"
            ? "A system with no planets or printed wormholes, not a supernova or The Fracture."
            : step === "infantry"
              ? "One of the players with the most completed expeditions puts that many infantry on Thunder's Edge."
              : "You completed the last expedition."
        }
      />
      <div className={classes.grid}>
        {opts.map((o) => {
          const v = o.value!;
          const label = v.step === "start" ? "Begin" : v.step === "system" ? tileLabel(state, v.position) : factionName(v.faction);
          return (
            <Choice key={o.id} go={v.step === "start"} onClick={() => answer(o.id)}>
              {label}
            </Choice>
          );
        })}
      </div>
    </div>
  );
}

type VisionariaChoice = NonNullable<TeVisionaria["options"][number]["value"]>["choice"];

const VISIONARIA_LABEL: Record<VisionariaChoice, string> = {
  research: "Research for 3 trade goods",
  give_promissory: "Give a promissory note",
  decline: "Decline",
  wait_for_all: "Wait until all have reacted",
  end_turn_after_all: "End turn after all have reacted",
};

export function Visionaria({ decision, state, answer }: TeRendererProps<TeVisionaria>) {
  const opts = live(decision).filter((o) => o.value);
  const w = decision.window;
  const pending = (w?.eligible ?? []).filter((u) => !w?.responded.includes(u) && u !== w?.subject?.owner);
  const name = (u: string) => state?.players.find((p) => p.userId === u)?.userName ?? u;
  return (
    <div className={classes.stack}>
      <Header
        eyebrow="Deepwrought breakthrough"
        title="Visionaria Select"
        hint="Research a non-faction, non-unit-upgrade technology for 3 trade goods and give Deepwrought a promissory note, or decline. The turn moves on when everyone has answered."
      />
      <div className={classes.grid}>
        {opts.map((o) => (
          <Choice key={o.id} go={o.value!.choice === "research"} back={o.value!.choice === "decline"} onClick={() => answer(o.id)}>
            {VISIONARIA_LABEL[o.value!.choice] ?? o.value!.choice}
          </Choice>
        ))}
      </div>
      {pending.length > 0 && <p className={classes.hint}>Waiting on {pending.map(name).join(", ")}</p>}
    </div>
  );
}
