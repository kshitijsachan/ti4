import type { DecisionOf, GameState } from "../../contract";
import type { EngineRendererProps } from "../../registry";
import { useCardData } from "@/hand/cardData";
import { acName, me, planetName, playerLabel, pnName } from "./labels";
import { AnswerButton, ExtraOptions, Head } from "./parts";
import classes from "./Cards.module.css";

type StepValue = NonNullable<DecisionOf<"action_card.step">["options"][number]["value"]>;

/** Button text from the typed tokens; the engine's own label only when the option names nothing we can type. */
function stepLabel(state: GameState | null, v: StepValue, fallback: string): string {
  const parts: string[] = [];
  for (const f of v.players ?? (v.player ? [v.player] : [])) parts.push(playerLabel(state, f));
  if (v.unit) parts.push(`${v.damaged ? "damaged " : ""}${v.unit}`);
  if (v.planet) parts.push(planetName(v.planet));
  if (v.system) parts.push(`System ${v.system}`);
  if (v.holder === "space") parts.push("space");
  if (v.tech) parts.push(v.tech);
  if (v.actionCardRef) parts.push(acName(v.actionCardRef));
  if (v.promissoryNote) parts.push(pnName(v.promissoryNote));
  if (v.count != null && !parts.length) parts.push(String(v.count));
  return parts.length ? parts.join(" · ") : fallback;
}

/** A follow-up step of an action card: the card being resolved, its choices, then the finishers. */
export function ActionCardStep({ decision, state, answer, pendingOptionId }: EngineRendererProps<DecisionOf<"action_card.step">>) {
  useCardData();
  const typed = decision.options.filter((o) => o.value);
  const card = typed.find((o) => o.value!.actionCard)?.value?.actionCard ?? null;
  const choose = typed.filter((o) => o.value!.role === "choose");
  const done = typed.filter((o) => o.value!.role === "done");
  return (
    <div className={classes.root}>
      <Head title={acName(card)} meta="resolve your action card" />
      <div className={classes.options}>
        {choose.map((o) => (
          <AnswerButton
            key={o.id}
            option={o}
            label={stepLabel(state, o.value!, o.label || "Choose")}
            pendingOptionId={pendingOptionId}
            onAnswer={answer}
          />
        ))}
        {done.map((o) => (
          <AnswerButton key={o.id} option={o} label={o.label || "Done"} tone="go" pendingOptionId={pendingOptionId} onAnswer={answer} />
        ))}
      </div>
      <ExtraOptions options={decision.options} pendingOptionId={pendingOptionId} onAnswer={answer} />
    </div>
  );
}

const TIMING_TITLE = { when: "“When” window", after: "“After” window" } as const;

/** Non-queued agenda when/after window: who still has to answer, and my pass / play choices. */
export function ActionCardWhenAfter({ decision, state, answer, pendingOptionId }: EngineRendererProps<DecisionOf<"action_card.when_after">>) {
  const typed = decision.options.filter((o) => o.value);
  const w = decision.window;
  const timing = typed[0]?.value?.timing ?? (w?.kind === "when" ? "when" : "after");
  const self = me(state);
  const owe = !w || (!!self && w.eligible.includes(self.userId) && !w.responded.includes(self.userId));
  const label = (v: NonNullable<(typeof typed)[number]["value"]>) =>
    v.action === "pass_agenda"
      ? `No “${timing}”s for this agenda`
      : v.action === "pass"
        ? `No “${timing}”s for now`
        : v.rider
          ? `Play ${v.rider}`
          : `Play a “${timing}”`;
  return (
    <div className={classes.root}>
      <Head title={TIMING_TITLE[timing]} />
      {w && (
        <div className={classes.chips}>
          {w.eligible.map((uid) => {
            const p = state?.players.find((x) => x.userId === uid);
            return (
              <span key={uid} className={classes.chip} data-done={w.responded.includes(uid) || undefined}>
                {p ? playerLabel(state, p.faction) : uid}
              </span>
            );
          })}
        </div>
      )}
      {owe ? (
        <div className={classes.options}>
          {typed.map((o) => (
            <AnswerButton
              key={o.id}
              option={o}
              label={label(o.value!)}
              tone={o.value!.action === "play" ? "stop" : "plain"}
              pendingOptionId={pendingOptionId}
              onAnswer={answer}
            />
          ))}
        </div>
      ) : (
        <span className={classes.meta}>Waiting for the others to answer.</span>
      )}
      <ExtraOptions options={decision.options} pendingOptionId={pendingOptionId} onAnswer={answer} />
    </div>
  );
}

/** A promissory note's own step (Acquiescence follow, Malevolency neighbour, planet, ...). */
export function PromissoryNoteResolve({ decision, state, answer, pendingOptionId }: EngineRendererProps<DecisionOf<"promissory_note.resolve">>) {
  useCardData();
  const typed = decision.options.filter((o) => o.value);
  const pn = typed[0]?.value?.promissoryNote;
  const label = (v: NonNullable<(typeof typed)[number]["value"]>) =>
    v.strategyCard != null
      ? `Follow strategy card ${v.strategyCard} for free`
      : v.player
        ? playerLabel(state, v.player)
        : v.planet
          ? planetName(v.planet)
          : "Use";
  return (
    <div className={classes.root}>
      <Head title={pn ? pnName(pn) : "Promissory note"} />
      <div className={classes.options}>
        {typed.map((o) => (
          <AnswerButton key={o.id} option={o} label={label(o.value!)} tone="go" pendingOptionId={pendingOptionId} onAnswer={answer} />
        ))}
      </div>
      <ExtraOptions options={decision.options} pendingOptionId={pendingOptionId} onAnswer={answer} />
    </div>
  );
}
