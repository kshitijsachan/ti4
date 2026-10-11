import type { Option } from "../../../../../shim/src/engine/types";
import { Choice, ErrorLine, FactionIcon, useAnswer, useFactionName } from "./parts";
import type { AnswerFn } from "./parts";
import type { Renderer } from "./types";
import classes from "./Setup.module.css";

/** Plain list of the decision's options; label comes from the typed value where the caller knows how. */
function Options<V>({ options, answer, label }: { options: Option<V>[]; answer: AnswerFn; label?: (o: Option<V>) => string }) {
  const { pending, error, press } = useAnswer(answer);
  return (
    <>
      <div className={classes.row}>
        {options.map((o) => (
          <Choice
            key={o.id}
            name={label ? label(o) : o.label}
            disabled={o.disabled || o.needsInput || !!pending}
            pending={pending === o.id}
            onClick={() => void press(o.id)}
          />
        ))}
      </div>
      <ErrorLine error={error} />
    </>
  );
}

const STEP_TITLE: Record<string, string> = {
  start: "Set up a player",
  user: "Which player are you setting up?",
  faction: "Choose the faction",
  color: "Choose the colour",
  home: "Choose the home system position",
  speaker: "Is this player the speaker?",
};

/** Manual player setup steps (games without a draft). */
export const PlayerSetupRenderer: Renderer<"setup.player"> = ({ decision, answer }) => {
  const factionName = useFactionName();
  const step = decision.options.find((o) => o.value && !o.value.page)?.value?.step ?? "start";
  const { pending, error, press } = useAnswer(answer);
  const label = (o: (typeof decision.options)[number]) => {
    const v = o.value;
    if (!v || v.page) return o.label;
    if (v.step === "faction") return factionName(v.faction);
    if (v.step === "speaker") return v.speaker ? "Yes, the speaker" : "No";
    return o.label;
  };
  return (
    <div className={classes.stack}>
      <p className={classes.title}>{STEP_TITLE[step] ?? "Player setup"}</p>
      <div className={step === "faction" ? classes.grid : classes.row}>
        {decision.options.map((o) => (
          <Choice
            key={o.id}
            name={label(o)}
            icon={o.value?.step === "faction" && !o.value.page ? <FactionIcon faction={o.value.faction} /> : undefined}
            disabled={o.disabled || !!pending}
            pending={pending === o.id}
            onClick={() => void press(o.id)}
          />
        ))}
      </div>
      <ErrorLine error={error} />
    </div>
  );
};

const PREFERENCE_TITLE: Record<string, string> = {
  survey: "Table survey",
  sandbag: "Secret objective scoring",
  auto_pass_sabotage: "Auto-pass on Sabotage (hours)",
  agenda: "Auto-react when you have no whens or afters",
  distance: "Order systems by",
  pillage_own_transactions: "Pillage on your own transactions",
};

/** Preference questions; one title per preference, the engine's own answer labels. */
export const PreferenceRenderer: Renderer<"setup.preference"> = ({ decision, answer }) => {
  const pref = decision.options.find((o) => o.value)?.value?.preference ?? "";
  return (
    <div className={classes.stack}>
      <p className={classes.title}>{PREFERENCE_TITLE[pref] ?? "Preference"}</p>
      <Options options={decision.options} answer={answer} />
    </div>
  );
};

const SETTING_TITLE: Record<string, string> = {
  expansion: "Which expansion is this game using?",
  base_game: "Base game",
  game_modes: "Alternate game modes",
  draft_start: "Start the draft",
  draft_settings: "Draft settings",
};

/** Game creation prompts (expansion, modes, draft settings): the engine's controls, grouped under one title. */
export const GameSettingsRenderer: Renderer<"setup.game_settings"> = ({ decision, answer }) => {
  const setting = decision.options.find((o) => o.value)?.value?.setting ?? "";
  return (
    <div className={classes.stack}>
      <p className={classes.title}>{SETTING_TITLE[setting] ?? "Game settings"}</p>
      <Options options={decision.options} answer={answer} />
    </div>
  );
};
