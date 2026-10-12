import { useState } from "react";
import { Button } from "@mantine/core";
import type { GameState, Option } from "../../../../../shim/src/engine/types";
import type {
  MoveRequest,
  TacticalActivate,
  TacticalConclude,
  TacticalLand,
  TacticalMove,
  TacticalRift,
  TurnAction,
} from "../../../../../shim/src/engine/kinds/tactical";
import { planetName, strategyCardName, systemName, unitName } from "./names";
import classes from "./Tactical.module.css";
import { optionRole } from "../../optionKinds";

/**
 * A direct action payload for `answer`: the decision's kind-specific endpoint (`POST …/decisions/{id}/{action}`)
 * instead of one option. Tactical decisions use "move" (tactical.move) and "land" (tactical.land).
 */
export type DirectAction =
  | { action: "move"; body: Omit<MoveRequest, "userId"> }
  | { action: "land"; body: { landings: { planet: string; unit: string; count: number }[]; done?: boolean } };

export type RendererProps<D> = {
  decision: D;
  state: GameState | null;
  answer: (optionIdOrPayload: string | DirectAction) => void;
};

const live = <V,>(options: Option<V>[]) =>
  options.filter((o) => !o.disabled && !o.needsInput && o.value);

function OptionButton({
  id,
  label,
  answer,
  variant = "default",
}: {
  id: string;
  label: string;
  answer: (id: string) => void;
  variant?: string;
}) {
  return (
    <Button size="xs" variant={variant} onClick={() => answer(id)}>
      {label}
    </Button>
  );
}

/** Untyped options of a typed decision (faction abilities on the turn menu, …), with the engine's labels. */
function Extras({
  options,
  answer,
}: {
  options: Option<unknown>[];
  answer: (id: string) => void;
}) {
  const [more, setMore] = useState(false);
  const extras = options.filter((o) => !o.disabled && !o.needsInput && !o.value);
  if (!extras.length) return null;
  const main = extras.filter((o) => optionRole(o) === "main");
  const back = extras.filter((o) => optionRole(o) === "back");
  const utilities = extras.filter((o) => optionRole(o) === "utility");
  return (
    <>
      {main.length > 0 && (
        <div className={classes.row}>
          {main.map((o) => (
            <OptionButton key={o.id} id={o.id} label={o.label} answer={answer} variant="light" />
          ))}
        </div>
      )}
      {(back.length > 0 || utilities.length > 0) && (
        <div className={classes.row}>
          {back.map((o) => (
            <OptionButton key={o.id} id={o.id} label={o.label} answer={answer} variant="subtle" />
          ))}
          {utilities.length > 0 && (
            <Button size="xs" variant="subtle" color="gray" onClick={() => setMore((v) => !v)} aria-expanded={more}>
              {more ? "Fewer options" : `More options (${utilities.length})`}
            </Button>
          )}
        </div>
      )}
      {more && (
        <div className={classes.row}>
          {utilities.map((o) => (
            <OptionButton key={o.id} id={o.id} label={o.label} answer={answer} variant="subtle" />
          ))}
        </div>
      )}
    </>
  );
}

export function TurnActionView({ decision, state, answer }: RendererProps<TurnAction>) {
  const me = state?.players.find((p) => p.userId === decision.target?.userId);
  const label = (o: Option<TurnAction["options"][number]["value"]>) => {
    const v = o.value!;
    switch (v.action) {
      case "tactical":
        // Live tokens first: the value is the count when the prompt was posted (a token gained since made it stale).
        return `Tactical action (${me?.commandTokens.tactic ?? v.tacticTokens ?? "?"} tactic tokens)`;
      case "component":
        return "Component action";
      case "strategic":
        return `Play ${strategyCardName(v.strategyCard)}`;
      case "pass":
        return v.abilities ? "Pass (with abilities)" : "Pass";
      case "end_turn":
        return v.abilities ? "End turn (abilities first)" : "End turn";
    }
  };
  const variant = (o: Option<TurnAction["options"][number]["value"]>) =>
    o.value!.action === "pass" || o.value!.action === "end_turn" ? "light" : "filled";
  return (
    <div className={classes.panel}>
      <div className={classes.row}>
        {live(decision.options).map((o) => (
          <OptionButton key={o.id} id={o.id} label={label(o)} answer={answer} variant={variant(o)} />
        ))}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

export function TacticalActivateView({ decision, answer }: RendererProps<TacticalActivate>) {
  const opts = live(decision.options);
  const systems = opts.filter((o) => o.value!.step === "system");
  const menus = opts.filter((o) => o.value!.step !== "system");
  return (
    <div className={classes.panel}>
      <span className={classes.heading}>Activate a system (or click it on the map)</span>
      <div className={classes.row}>
        {systems.map((o) => {
          const v = o.value!;
          if (v.step !== "system") return null;
          return <OptionButton key={o.id} id={o.id} label={systemName(v.position, v.tileId)} answer={answer} />;
        })}
      </div>
      {menus.length > 0 && (
        <div className={classes.row}>
          {menus.map((o) => {
            const v = o.value!;
            const what = v.step === "ring" ? `Ring ${v.ring.replace("_", " ")}` : v.step === "distance" ? `${v.distance} away` : "";
            const n = v.step === "system" ? 0 : v.positions.length;
            return <OptionButton key={o.id} id={o.id} label={`${what} (${n})`} answer={answer} variant="subtle" />;
          })}
        </div>
      )}
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

export function TacticalMoveView({ decision, state, answer }: RendererProps<TacticalMove>) {
  const me = state?.players.find((p) => p.userId === decision.target?.userId);
  const opts = live(decision.options);
  const done = opts.find((o) => o.value!.action === "done");
  const doneValue = done?.value?.action === "done" ? done.value : null;
  const staged = decision.progress?.accumulated.staged ?? [];
  const origins = doneValue?.origins ?? [];
  const other = opts.filter((o) => ["change_destination", "reset", "back"].includes(o.value!.action));
  const otherLabel: Record<string, string> = {
    change_destination: "Activate a different system",
    reset: "Reset movement",
    back: "Back to systems",
  };
  return (
    <div className={classes.panel}>
      {doneValue && (
        <span className={classes.heading}>
          Moving into {systemName(doneValue.position, doneValue.tileId)} — pick ships on the map
        </span>
      )}
      <ul className={classes.list}>
        {staged.map((s) => (
          <li key={`${s.from}-${s.holder}-${s.unit}-${s.color}`} className={classes.item}>
            <span className={classes.mono}>{s.count}</span>
            <span>{unitName(s.unit, s.count, me)}</span>
            <span className={classes.muted}>
              from {s.from}
              {s.holder !== "space" ? ` (${planetName(s.holder)})` : ""}
            </span>
          </li>
        ))}
        {!staged.length && <li className={classes.muted}>Nothing staged to move.</li>}
      </ul>
      {origins.length > 0 && (
        <span className={classes.muted}>
          Can move from:{" "}
          {origins.map((o) => `${o.position} (${o.distance >= 100 ? "far" : o.distance})`).join(", ")}
        </span>
      )}
      <div className={classes.row}>
        {done && (
          <OptionButton id={done.id} label={staged.length ? "Done moving" : "Move nothing"} answer={answer} variant="filled" />
        )}
        {other.map((o) => (
          <OptionButton key={o.id} id={o.id} label={otherLabel[o.value!.action]} answer={answer} variant="subtle" />
        ))}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

export function TacticalLandView({ decision, state, answer }: RendererProps<TacticalLand>) {
  // Names follow the owner's real unit (faction unit, upgraded only with its upgrade tech): Xxcha without
  // Infantry II research lands "Infantry", never "Infantry II" (playtest 3, pbd203).
  const me = state?.players.find((p) => p.userId === decision.target?.userId);
  const ownerOf = (faction?: string | null) => state?.players.find((p) => p.faction === faction) ?? me;
  const opts = live(decision.options);
  const done = opts.find((o) => o.value!.op === "done");
  const progress = decision.progress?.accumulated;
  const label = (o: (typeof opts)[number]) => {
    const v = o.value!;
    if (v.op === "done") return "Done landing";
    const verb = v.op === "land" ? "Land" : "Lift";
    return `${verb} ${v.count} ${unitName(v.unit, v.count, ownerOf(v.owner))}${v.damaged ? " (damaged)" : ""} ${v.op === "land" ? "on" : "from"} ${planetName(v.planet)}`;
  };
  return (
    <div className={classes.panel}>
      {progress && (
        <span className={classes.muted}>
          In space: {progress.inSpace.map((u) => `${u.count} ${unitName(u.unit, u.count, me)}`).join(", ") || "none"}
          {progress.onPlanets.length > 0 &&
            ` · landed: ${progress.onPlanets.map((u) => `${u.count} ${unitName(u.unit, u.count, me)} on ${planetName(u.planet)}`).join(", ")}`}
        </span>
      )}
      <div className={classes.row}>
        {opts
          .filter((o) => o.value!.op !== "done")
          .map((o) => (
            <OptionButton key={o.id} id={o.id} label={label(o)} answer={answer} />
          ))}
      </div>
      <div className={classes.row}>
        {done && <OptionButton id={done.id} label="Done landing" answer={answer} variant="filled" />}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

export function TacticalConcludeView({ decision, answer }: RendererProps<TacticalConclude>) {
  const opts = live(decision.options);
  const label = (o: (typeof opts)[number]) => {
    const v = o.value!;
    if (v.action === "produce") return `Produce in ${v.position} (${v.production} production)`;
    if (v.action === "rift") return "Roll for gravity rift";
    return v.frontierExplore ? "Conclude (explores the frontier)" : "Conclude tactical action";
  };
  return (
    <div className={classes.panel}>
      <div className={classes.row}>
        {opts.map((o) => (
          <OptionButton
            key={o.id}
            id={o.id}
            label={label(o)}
            answer={answer}
            variant={o.value!.action === "conclude" ? "filled" : "default"}
          />
        ))}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}

export function TacticalRiftView({ decision, answer }: RendererProps<TacticalRift>) {
  const opts = live(decision.options);
  const label = (o: (typeof opts)[number]) => {
    const v = o.value!;
    if (v.op === "done") return "Done with rifts";
    if (v.op === "roll_all") return "Roll for all units";
    return `Roll for ${v.count} ${v.damaged ? "damaged " : ""}${v.unit}`;
  };
  return (
    <div className={classes.panel}>
      <div className={classes.row}>
        {opts.map((o) => (
          <OptionButton key={o.id} id={o.id} label={label(o)} answer={answer} variant={o.value!.op === "done" ? "filled" : "default"} />
        ))}
      </div>
      <Extras options={decision.options} answer={answer} />
    </div>
  );
}
