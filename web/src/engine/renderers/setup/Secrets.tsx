import { getSecretObjectiveByName, getSecretObjectiveData } from "@/entities/lookup/secretObjectives";
import { Choice, ErrorLine, Waiting, useAnswer } from "./parts";
import type { Renderer } from "./types";
import classes from "./Setup.module.css";
import { useDecisionState } from "../../draftState";

/**
 * Secret objectives in hand. With exactly two at setup you choose the one to KEEP (the other is discarded);
 * otherwise you choose the one to discard (or to swap, for a redraw).
 */
export const SecretDiscardRenderer: Renderer<"secret_objective.discard"> = ({ decision, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  const [selected, setSelected] = useDecisionState<string | null>(decision.id, "selected", null);
  const options = decision.options.filter((o) => o.value);
  const extra = decision.options.filter((o) => !o.value);
  const redraw = options.some((o) => o.value!.redraw);
  const keepMode = !redraw && options.length === 2;
  const current = options.find((o) => o.id === selected);
  const target = keepMode ? options.find((o) => o.id !== selected) : current;
  const name = (so?: string) => (so ? getSecretObjectiveData(so)?.name ?? so : undefined);
  /* The card's name, from its id, else from the bot's "Discard (202) Mechanize the Military" label. */
  const cardName = (o: (typeof options)[number]) => name(o.value!.secretObjective) ?? o.label.replace(/^(discard|swap( out)?)\s+/i, "").replace(/^\(\d+\)\s*/, "");

  return (
    <div className={classes.stack}>
      <p className={classes.title}>{keepMode ? "Keep one secret objective" : redraw ? "Swap a secret objective" : "Discard a secret objective"}</p>
      <div className={classes.stack}>
        {options.map((o) => {
          const data = o.value!.secretObjective ? getSecretObjectiveData(o.value!.secretObjective) : getSecretObjectiveByName(cardName(o));
          return (
            <Choice
              key={o.id}
              name={data?.name ?? cardName(o)}
              sub={data?.text}
              selected={o.id === selected}
              disabled={o.disabled || !!pending}
              onClick={() => setSelected(o.id)}
            />
          );
        })}
      </div>
      {current && target && (
        <div className={classes.row}>
          <Choice
            name={keepMode ? `Keep ${cardName(current)}` : `${redraw ? "Swap out" : "Discard"} ${cardName(current)}`}
            go
            disabled={!!pending}
            pending={pending === target.id}
            onClick={() => void press(target.id)}
          />
        </div>
      )}
      {!current && <p className={classes.hint}>{keepMode ? "Pick the one you want to keep." : "Pick one."}</p>}
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

/** Table step: deal two secret objectives to everyone, once every player is set up. */
export const DealSecretsRenderer: Renderer<"setup.deal_secrets"> = ({ decision, state, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  const option = decision.options.find((o) => o.value);
  const setup = state?.setup;
  const ready = setup?.stage === "deal_secrets";
  if (!option) return null;
  return (
    <div className={classes.stack}>
      <p className={classes.title}>Deal secret objectives</p>
      <p className={classes.hint}>{ready ? "Everyone is set up." : "Waiting for every player to finish setting up (faction, starting technologies)."}</p>
      <Waiting state={state} users={setup?.stage === "player_setup" ? setup.waitingOn : []} label="Still setting up" />
      <div className={classes.row}>
        <Choice
          name="Deal 2 secret objectives to everyone"
          go={ready}
          disabled={!ready || !!pending}
          pending={pending === option.id}
          onClick={() => void press(option.id)}
        />
      </div>
      <ErrorLine error={error} />
    </div>
  );
};

/** Table step: reveal the first public objectives and start the strategy phase. */
export const RevealObjectivesRenderer: Renderer<"setup.reveal_objectives"> = ({ decision, state, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  const option = decision.options.find((o) => o.value);
  const setup = state?.setup;
  const ready = setup?.stage === "reveal_objectives";
  if (!option) return null;
  return (
    <div className={classes.stack}>
      <p className={classes.title}>Start the game</p>
      <p className={classes.hint}>{ready ? "Everyone kept a secret objective." : "Waiting for every player to keep one secret objective."}</p>
      <Waiting state={state} users={setup?.stage === "keep_secrets" ? setup.waitingOn : []} label="Still choosing" />
      <div className={classes.row}>
        <Choice
          name="Reveal objectives and start the strategy phase"
          go={ready}
          disabled={!ready || !!pending}
          pending={pending === option.id}
          onClick={() => void press(option.id)}
        />
      </div>
      <ErrorLine error={error} />
    </div>
  );
};
