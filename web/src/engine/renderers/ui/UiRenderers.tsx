import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { Markdown } from "@/discord";
import type { DecisionOf, Option } from "../../contract";
import type { EngineRenderer, EngineRendererProps } from "../../registry";
import { SelectInputs } from "../input";
import classes from "../../GenericDecision.module.css";

type AffordanceKind = "ui.undo_affordance" | "ui.optional" | "ui.info_menu";
type AffordanceValue = { action: string; undoes: string | null; ref: string | null; shortcut?: string };

/** What an affordance takes back / does, from its typed value (never from the label). */
const UNDOES: Record<string, string> = {
  so_discard: "Undo: take the discarded secret objective back",
  preset: "Undo: remove the preset",
  agenda_put: "Undo: reassign the agenda",
  vote: "Undo: erase my vote and vote again",
  rider: "Undo: erase my riders",
  pre_score: "Undo: unqueue the objective",
  last_action: "Undo the last action",
};

const ACTION: Record<string, string> = {
  round_summary: "Optional: write a round summary",
  pre_score: "Optional: queue an objective to score",
  disable_pings: "Optional: no pings this turn",
  skip_waiting: "Optional: skip waiting for whens / afters",
  refresh_agenda: "Optional: re-post the agenda",
  ping_nonresponders: "Optional: ping players who haven't answered",
};

const SHORTCUT: Record<string, string> = {
  exhaust_agent: "Shortcut: use your agent",
  agent_selection: "Shortcut: use your agent on someone else",
  galvanize: "Shortcut: galvanize units",
  trade_station_convert: "Shortcut: convert commodities with a space station",
  laws_order: "Shortcut: use Law's Order",
  pillage_preference: "Setting: pillage on your own transactions",
};

function hint(v: AffordanceValue | null): string | undefined {
  if (!v) return undefined;
  if (v.action === "undo") return UNDOES[v.undoes ?? ""];
  if (v.action === "shortcut") return SHORTCUT[v.shortcut ?? ""];
  return ACTION[v.action];
}

const TITLE: Record<AffordanceKind, string> = {
  "ui.undo_affordance": "Undo (optional, nothing is waiting on you)",
  "ui.optional": "Optional (nothing is waiting on you)",
  "ui.info_menu": "Info menu",
};

/**
 * Undo / optional / info-menu affordances: not questions (never "waiting on me"), but every option still works
 * when pressed. Quiet buttons with a typed hint; the prompt is the engine's own text.
 */
function AffordanceRenderer({ decision, answer, pendingOptionId }: EngineRendererProps<DecisionOf<AffordanceKind>>) {
  const busy = !!pendingOptionId;
  const options = decision.options as Option<AffordanceValue>[];
  return (
    <div className={classes.root}>
      <p className={classes.prompt}>{TITLE[decision.kind]}</p>
      {decision.prompt && <Markdown content={decision.prompt} className={classes.prompt} />}
      <div className={classes.options}>
        {options.map((o) => (
          <UnstyledButton
            key={o.id}
            className={cx(classes.option)}
            disabled={o.disabled || busy}
            data-pending={pendingOptionId === o.id || undefined}
            aria-busy={pendingOptionId === o.id}
            title={hint(o.value) ?? (o.needsInput ? "Opens a form" : undefined)}
            onClick={() => answer(o.id)}
          >
            {pendingOptionId === o.id && <Loader size={12} color="currentColor" />}
            <span>{o.label || o.emoji || "Choose"}</span>
          </UnstyledButton>
        ))}
      </div>
    </div>
  );
}

const PREFERENCE_TITLE: Record<string, string> = {
  survey: "Table survey",
  sandbag: "Secret objective scoring",
  auto_pass_sabotage: "Auto-pass on Sabotage (hours)",
  agenda: "Auto-react when you have no whens or afters",
  distance: "Order systems by",
  pillage_own_transactions: "Pillage on your own transactions",
  stats: "Show your statistics",
};

/** Preference questions (any time of the game): one title per preference, the engine's own answer labels. */
function PreferenceRenderer({ decision, answer, pendingOptionId }: EngineRendererProps<DecisionOf<"player.preference">>) {
  const pref = String(decision.options.find((o) => o.value)?.value?.preference ?? "").replace(/:.*$/, "");
  const busy = !!pendingOptionId;
  return (
    <div className={classes.root}>
      <p className={classes.prompt}>{PREFERENCE_TITLE[pref] ?? "Preference"}</p>
      <div className={classes.options}>
        {decision.options.map((o) => (
          <UnstyledButton
            key={o.id}
            className={cx(classes.option, o.style === "success" && classes.go, o.style === "danger" && classes.stop)}
            disabled={o.disabled || busy}
            aria-busy={pendingOptionId === o.id}
            onClick={() => answer(o.id)}
          >
            {pendingOptionId === o.id && <Loader size={12} color="currentColor" />}
            <span>{o.label || "Choose"}</span>
          </UnstyledButton>
        ))}
      </div>
    </div>
  );
}

/** Select-only prompts: the engine's typed select schema (`inputs`), answered `{optionId: menu, values}`. */
function SelectRenderer(props: EngineRendererProps<DecisionOf<"choose.select">>) {
  const { decision } = props;
  return (
    <div className={classes.root}>
      {decision.prompt && <Markdown content={decision.prompt} className={classes.prompt} />}
      <SelectInputs decision={decision} state={props.state} answer={props.answer} pendingOptionId={props.pendingOptionId} />
    </div>
  );
}

export const UndoAffordanceRenderer: EngineRenderer<"ui.undo_affordance"> = AffordanceRenderer;
export const OptionalRenderer: EngineRenderer<"ui.optional"> = AffordanceRenderer;
export const InfoMenuRenderer: EngineRenderer<"ui.info_menu"> = AffordanceRenderer;
export { PreferenceRenderer, SelectRenderer };
