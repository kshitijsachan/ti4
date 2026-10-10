import { baseId, type Choice } from "../../model/controls";
import type { Decision } from "../../model/classify";
import { ChoiceButton, ChoiceButtons } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { cardSpec } from "./cards";
import { scDefinition } from "../../ui/parts";
import { CardHeader, playerLabel } from "./shared";
import { useRunner, useRunSequence } from "./runner";
import classes from "./strategy.module.css";

type PrimaryAction = { id: RegExp; label: string | ((data: RendererProps["data"]) => string); hint?: string };

/** The holder's own buttons on the played card, per card; everything else on it is the followers'. */
const PRIMARY: Record<number, PrimaryAction[]> = {
  1: [{ id: /^leadershipGenerateCCButtons$/, label: "Gain 3 tokens, then buy more with influence" }],
  2: [
    { id: /^diploSystem$/, label: "Choose the system to protect" },
    { id: /^diploRefresh2$/, label: "Ready 2 planets" },
  ],
  3: [{ id: /^sc_ac_draw$/, label: "Draw 2 action cards" }],
  4: [
    { id: /^construction_pds$/, label: "Place a PDS" },
    { id: /^construction_spacedock$/, label: "Place a space dock" },
    { id: /^constructionPrimary_produce$/, label: "Use PRODUCTION instead" },
  ],
  6: [
    { id: /^primaryOfWarfare$/, label: "Remove a command token from the board" },
    { id: /^primaryOfTeWarfare$/, label: "Take the Warfare tactical action" },
  ],
  7: [{ id: /^acquireATechWithSC(_first)?$/, label: "Research a technology" }],
  8: [
    { id: /^scoreAnObjective$/, label: "Score a public objective" },
    { id: /^score_imperial$/, label: "Gain 1 point for Mecatol Rex" },
    { id: /^sc_draw_so$/, label: "Draw a secret objective (no Mecatol Rex)" },
  ],
};

/** Followers' buttons and Discord nudges: never the holder's business. */
const FOLLOWERS = /^(sc_follow_|sc_no_follow_|sc_trade_follow|sc_refresh|requestAllFollow|preDeclineSC_|warfareBuild|warfareTeBuild|transaction|sendTradeHolder_)/;

const SPEAKER = /^sc_3_assign_speaker_to_(\w+)/;

/** Primary buttons already pressed on a card that takes two (Diplomacy: system, then ready planets). */
const pressed = new Set<string>();

function controlsMecatol(data: RendererProps["data"]) {
  return !!data.me?.planets?.some((p) => p === "mr" || p === "mrte");
}

/** A step the bot posted with the card (choose the speaker, look at agendas…), in plain words. */
function StepView({ step, props, index }: { step: Decision; props: RendererProps; index: number }) {
  const { data, pendingKey, pressOn } = props;
  const speaker = step.choices.some((c) => SPEAKER.test(baseId(c.customId)));
  const agendas = step.choices.some((c) => /^drawAgenda_2$/.test(baseId(c.customId)));
  const title = speaker ? "Choose the new speaker" : agendas ? (index ? "Then look at the top 2 agendas" : "Look at the top 2 agendas") : step.title;
  const choices = step.choices
    .filter((c) => !FOLLOWERS.test(baseId(c.customId)))
    .map((c): Choice => {
      const f = baseId(c.customId).match(SPEAKER)?.[1];
      if (f) {
        const p = data.players.find((x) => x.faction === f);
        return { ...c, label: p ? `${playerLabel(p)} · ${c.label}` : c.label, style: 2 };
      }
      if (agendas && /^drawAgenda_2$/.test(baseId(c.customId))) return { ...c, label: "Look at the top 2 agendas", style: 3 };
      return c;
    });
  return (
    <div className={classes.actions}>
      <span className={classes.sectionLabel}>
        {index + 1}. {title}
      </span>
      <ChoiceButtons
        choices={choices}
        onPress={pressOn(step)}
        pendingKey={pendingKey}
        channelId={step.prompt.channelId}
        rankOf={(c) => (c.rank === "undo" ? "more" : c.rank === "more" ? "more" : "primary")}
      />
    </div>
  );
}

/**
 * My strategy card, just played: the card, its primary in plain words, the holder's buttons as a few clear
 * actions, and any steps the bot posted with it (speaker, agendas) in order. Followers' buttons and the bot's
 * "request all resolve now" nudge are never shown to the holder.
 */
export function StrategyPrimaryBody(props: RendererProps) {
  const { d, data } = props;
  const sc = d.sc!;
  const spec = cardSpec(sc, scDefinition(sc, data.web)?.id);
  const second = /second structure/.test(d.title);
  const mecatol = controlsMecatol(data);
  const actions = (PRIMARY[sc] ?? [])
    .filter((a) => sc !== 8 || (mecatol ? !/sc_draw_so/.test(a.id.source) : !/score_imperial/.test(a.id.source)))
    .map((a) => ({ a, choice: d.choices.find((c) => a.id.test(baseId(c.customId)) && !c.disabled) }))
    .filter((x): x is { a: PrimaryAction; choice: Choice } => !!x.choice)
    .filter((x) => !pressed.has(`${d.id}:${baseId(x.choice.customId)}`));
  const run = useRunSequence();
  const runner = useRunner();
  const busy = !!runner.running;
  /*
   * The card's own buttons go through the strategy runner rather than the popup's press: a press still settling on a
   * step (an agenda peek, the speaker) must never leave these silently dead.
   */
  const press = (c: Choice) => {
    if (!c.customId) {
      useRunner.getState().set({ error: "This button has no action." });
      return;
    }
    if (sc === 2) pressed.add(`${d.id}:${baseId(c.customId)}`);
    void run(`primary:${d.id}:${c.key}`, [{ channelId: d.prompt.channelId, messageId: d.id, customId: c.customId, label: c.label }]);
  };
  const steps = (d.steps ?? []).filter((s) => s.choices.some((c) => !FOLLOWERS.test(baseId(c.customId)) && c.rank !== "more" && c.rank !== "undo"));

  return (
    <div className={classes.panel}>
      <CardHeader sc={sc} data={data} sub="Your strategy card">
        <p className={classes.effect}>{second ? (scDefinition(sc, data.web)?.id === "te4construction" ? "Place one more structure (PDS or space dock) on a planet you control." : "Place one more PDS on a planet you control.") : spec?.primary}</p>
      </CardHeader>
      {steps.map((s, i) => (
        <StepView key={s.id} step={s} props={props} index={i} />
      ))}
      {actions.length > 0 && (
        <div className={classes.actions}>
          {steps.length > 0 && <span className={classes.sectionLabel}>{steps.length + 1}. Then</span>}
          <div className={classes.actionRow}>
            {actions.map(({ a, choice }) => (
              <ChoiceButton
                key={choice.key}
                choice={{ ...choice, label: typeof a.label === "string" ? a.label : a.label(data), style: 3 }}
                onPress={press}
                pending={runner.running === `primary:${d.id}:${choice.key}`}
                busy={busy}
                emphasis
              />
            ))}
          </div>
        </div>
      )}
      {runner.error && <span className={classes.error}>Did not go through: {runner.error}</span>}
      {sc === 8 && <p className={classes.sub}>{mecatol ? "You control Mecatol Rex: the point is yours." : "You do not control Mecatol Rex, so you draw a secret objective instead of the point."}</p>}
    </div>
  );
}
