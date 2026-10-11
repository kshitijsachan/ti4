import { Choice, ErrorLine, FactionIcon, Waiting, useAnswer, useFactionName } from "./parts";
import type { Renderer } from "./types";
import classes from "./Setup.module.css";

/**
 * Which Keleres to play. Before the draft ends it is a preset (changeable, cancelled if that faction gets drafted);
 * after it, choosing sets you up.
 */
export const KeleresFlavorRenderer: Renderer<"setup.keleres_flavor"> = ({ decision, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  const factionName = useFactionName();
  const options = decision.options.filter((o) => o.value);
  const preset = options.some((o) => o.value!.preset);
  return (
    <div className={classes.stack}>
      <p className={classes.title}>{preset ? "Preset your Keleres flavour" : "Choose your Keleres flavour"}</p>
      <p className={classes.hint}>
        {preset
          ? "The Council Keleres plays as one of three: its hero and home system come from Mentak, Xxcha or Argent. You can change the preset until the draft ends."
          : "The Council Keleres plays as one of three: its hero and home system come from the faction you choose. Your setup continues once you choose."}
      </p>
      <div className={classes.grid}>
        {options.map((o) => {
          const v = o.value!;
          return (
            <Choice
              key={o.id}
              name={factionName(v.faction)}
              icon={<FactionIcon faction={v.flavor} />}
              sub={v.contested ? (preset ? "In the draft: the preset is cancelled if it gets picked" : "Also drafted by another player") : undefined}
              go={!v.contested}
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

/** Keleres takes its two starting technologies from the other players'; only once they have chosen. */
export const KeleresTechRenderer: Renderer<"setup.keleres_tech"> = ({ decision, state, answer }) => {
  const { pending, error, press } = useAnswer(answer);
  const self = state?.players.find((p) => p.self)?.userId;
  const waiting = (state?.setup?.players ?? [])
    .filter((p) => p.userId !== self && (p.keleresFlavorPending || (p.startingTechsNeeded > 0 && !p.faction?.startsWith("keleres"))))
    .map((p) => p.userId);
  const option = decision.options.find((o) => o.value);
  if (!option) return null;
  return (
    <div className={classes.stack}>
      <p className={classes.title}>Keleres starting technologies</p>
      <p className={classes.hint}>You choose two technologies that other players own, so wait until everyone has theirs.</p>
      <Waiting state={state} users={waiting} label="Still choosing" />
      <div className={classes.row}>
        <Choice
          name="Get my technology options"
          go={!waiting.length}
          disabled={!!waiting.length || !!pending}
          pending={pending === option.id}
          onClick={() => void press(option.id)}
        />
      </div>
      <ErrorLine error={error} />
    </div>
  );
};
