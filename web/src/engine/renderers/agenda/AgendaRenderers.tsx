import type { ReactNode } from "react";
import type { AgendaPreassign, AgendaVote, Decision, VoteProgress } from "../../../../../shim/src/engine/types";
import { VotePanel } from "./VotePanel";
import {
  AgendaHeader,
  OptionButtons,
  Tally,
  Tile,
  factionOf,
  num,
  optionsOf,
  outcomeLabel,
  str,
  userName,
  type AnyOption,
  type RendererProps,
} from "./shared";
import classes from "./agenda.module.css";

type Renderer = (props: RendererProps) => ReactNode;

const QUEUE_LABEL: Record<string, string> = { open: "Play one…", pass: "Pass", lock: "Play regardless of others", ask_again: "Ask me again" };

/** When / after queue in your cards-info thread, with who the table still waits on. */
function QueueWindow({ decision, state, answer }: RendererProps) {
  const when = decision.kind === "agenda.when";
  const waiting = when ? state?.agenda?.awaitingWhens : state?.agenda?.awaitingAfters;
  const label = (o: AnyOption) => {
    const action = str(o, "action") ?? "";
    return action === "queue" ? `Queue ${o.label}` : QUEUE_LABEL[action];
  };
  return (
    <div className={classes.panel}>
      <AgendaHeader agenda={state?.agenda} />
      <p className={classes.hint}>
        {when ? "“When”s" : "“After”s"}: {waiting?.length ? `waiting on ${waiting.map((u) => userName(u, state)).join(", ")}` : "everyone has decided"}
      </p>
      <OptionButtons decision={decision} answer={answer} label={label} />
    </div>
  );
}

const PRESET_LABEL: Record<string, string> = {
  pass_shenanigans: "Pre-pass on shenanigans",
  abstain: "Pre-abstain",
  erase_prevote: "Erase pre-vote",
  pass_whens_afters: "Pass on all whens & afters",
  undo_pass_whens_afters: "Undo pass",
};

function Preassign({ decision, state, answer }: RendererProps) {
  if (optionsOf(decision).some((o) => str(o, "preset") === "prevote")) {
    return <VotePanel decision={decision as AgendaPreassign} state={state} answer={answer} />;
  }
  return <OptionButtons decision={decision} answer={answer} label={(o) => PRESET_LABEL[str(o, "preset") ?? ""]} />;
}

const SHENANIGAN_LABEL: Record<string, string> = {
  deadly_plot: "No Deadly Plot",
  bribery: "No Bribery",
  legal_text: "No Legal Text",
  confusing_legal_text: "No Confusing Legal Text",
};

/** Table window: everyone confirms no Deadly Plot / Bribery / Legal Texts. */
function Shenanigans({ decision, state, answer }: RendererProps) {
  const w = decision.window;
  const pending = w ? w.eligible.filter((u) => !w.responded.includes(u)) : [];
  return (
    <div className={classes.panel}>
      <Tally state={state} />
      {w && (
        <p className={classes.hint}>
          Declined {w.responded.length}/{w.eligible.length}
          {pending.length > 0 && ` · waiting on ${pending.map((u) => userName(u, state)).join(", ")}`}
        </p>
      )}
      <OptionButtons decision={decision} answer={answer} label={(o) => SHENANIGAN_LABEL[str(o, "decline") ?? ""]} />
    </div>
  );
}

const RESOLVE_LABEL: Record<string, string> = {
  manual: "Resolve manually",
  no_effect: "Resolve with no effect",
  flip: "Reveal the next agenda",
  strategy_phase: "End the agenda phase",
  scoring: "Proceed to scoring",
  elect_voice_of_the_council: "Elect Voice of the Council",
};

const outcomeId = (o: AnyOption) => str(o, "outcome") ?? str(o, "planetOwner");

/** Choose one outcome (tie-break, manual resolution, rider target): tiles with the votes on each. */
function OutcomePick({ decision, state, answer }: RendererProps) {
  const castSoFar = Object.fromEntries((state?.agenda?.outcomes ?? []).map((o) => [o.outcome, o.votes]));
  const typed = optionsOf(decision).filter((o) => outcomeId(o) !== undefined);
  const rest = optionsOf(decision).filter((o) => !typed.includes(o));
  const rider = str(typed[0], "rider");
  return (
    <div className={classes.panel}>
      <AgendaHeader agenda={state?.agenda} />
      {decision.kind === "agenda.rider" && rider && <p className={classes.hint}>Place {rider} on…</p>}
      {decision.kind === "agenda.tiebreak" && <p className={classes.hint}>The outcomes are tied. As speaker, choose the winner.</p>}
      <div className={classes.grid}>
        {typed.map((o) => {
          const id = outcomeId(o) ?? "";
          return (
            <Tile
              key={o.id}
              name={outcomeLabel(id, state, str(o, "name"))}
              sub={str(o, "planetOwner") ? "one of their planets…" : undefined}
              faction={factionOf(id, state)}
              num={castSoFar[id] || undefined}
              disabled={o.disabled}
              onClick={() => answer(o.id)}
            />
          );
        })}
      </div>
      {rest.length > 0 && (
        <OptionButtons decision={{ ...decision, options: rest } as Decision} answer={answer} label={(o) => RESOLVE_LABEL[str(o, "action") ?? ""]} />
      )}
    </div>
  );
}

/** Resolve with the current winner (speaker), or resolve manually. */
function Resolve(props: RendererProps) {
  const resolves = optionsOf(props.decision).filter((o) => str(o, "action") === "resolve");
  if (resolves.length !== 1) return <OutcomePick {...props} />;
  const winner = resolves[0];
  const label = (o: AnyOption) =>
    o === winner ? `Resolve: ${outcomeLabel(str(o, "outcome") ?? "", props.state, str(o, "name"))}` : RESOLVE_LABEL[str(o, "action") ?? ""];
  return (
    <div className={classes.panel}>
      <AgendaHeader agenda={props.state?.agenda} />
      <Tally state={props.state} />
      <OptionButtons decision={props.decision} answer={props.answer} label={label} />
    </div>
  );
}

function Next({ decision, state, answer }: RendererProps) {
  return (
    <div className={classes.panel}>
      <Tally state={state} />
      <OptionButtons decision={decision} answer={answer} label={(o) => RESOLVE_LABEL[str(o, "action") ?? ""]} />
    </div>
  );
}

function stepLabel(o: AnyOption, state: RendererProps["state"]): string | undefined {
  const votes = num(o, "votes");
  switch (str(o, "step")) {
    case "outcome":
      return outcomeLabel(str(o, "outcome") ?? "", state, str(o, "name"));
    case "planet_owner":
      return `${outcomeLabel(str(o, "faction") ?? "", state)}'s planets…`;
    case "exhaust":
      return `Exhaust ${str(o, "planet") ?? ""}${votes ? ` (+${votes})` : ""}`;
    case "exhaust_all":
      return `Exhaust all (${votes ?? "?"})`;
    case "done_exhausting":
      return "Done exhausting";
    case "confirm":
      return `Confirm ${votes ?? 0} vote${votes === 1 ? "" : "s"}`;
    case "reset":
      return "Reset my vote";
    default:
      return undefined;
  }
}

/** A vote in progress step by step: the running total comes from decision.progress (engine state). */
function VoteStep({ decision, state, answer }: RendererProps) {
  const acc = decision.progress?.accumulated as Partial<VoteProgress> | undefined;
  return (
    <div className={classes.panel}>
      <AgendaHeader agenda={state?.agenda} />
      {acc?.outcome && (
        <p className={classes.hint}>
          Voting for <b>{outcomeLabel(acc.outcome, state, acc.outcomeName)}</b>: {acc.votes ?? 0} of {acc.available ?? "?"} votes
        </p>
      )}
      <OptionButtons decision={decision} answer={answer} label={(o) => stepLabel(o, state)} />
    </div>
  );
}

function Vote({ decision, state, answer }: RendererProps) {
  return <VotePanel decision={decision as AgendaVote} state={state} answer={answer} />;
}

export const renderers: Record<string, Renderer> = {
  "agenda.vote": Vote,
  "agenda.vote_step": VoteStep,
  "agenda.tiebreak": OutcomePick,
  "agenda.when": QueueWindow,
  "agenda.after": QueueWindow,
  "agenda.preassign": Preassign,
  "agenda.shenanigans": Shenanigans,
  "agenda.resolve": Resolve,
  "agenda.next": Next,
  "agenda.rider": OutcomePick,
};
