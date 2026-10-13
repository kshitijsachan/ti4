import type { CardsDecision, DecisionOf } from "../../contract";
import type { EngineRendererProps } from "../../registry";
import { useCardData } from "@/hand/cardData";
import { acName, acWindow, me, planetName, playerLabel } from "./labels";
import { AnswerButton, ExtraOptions, Head } from "./parts";
import classes from "./Cards.module.css";

type Props<K extends CardsDecision["kind"]> = EngineRendererProps<DecisionOf<K>>;

/** Hand tray: every playable card with its timing window, plus the tray's own extras (discard menu, pre-assign). */
export function ActionCardPlay({ decision, state, answer, pendingOptionId }: Props<"action_card.play">) {
  useCardData();
  const cards = decision.options.filter((o) => o.value);
  // The engine refuses a card outside its timing window: show why instead of a Play button.
  const closed = me(state)?.hand?.closedActionCards ?? {};
  return (
    <div className={classes.root}>
      <Head title="Action cards" meta={<span className={classes.count}>{cards.length}</span>} />
      <div className={classes.list}>
        {cards.map((o) => (
          <div key={o.id} className={classes.row}>
            <div className={classes.rowText}>
              <span className={classes.rowName}>{acName(o.value!.actionCard)}</span>
              <span className={classes.meta}>{closed[o.value!.actionCard]?.replace(/_/g, "") ?? o.value!.window ?? acWindow(o.value!.actionCard)}</span>
            </div>
            {/* A closed window greys Play out (the reason is shown above); it is never hidden. */}
            <AnswerButton
              option={closed[o.value!.actionCard] ? { ...o, disabled: true } : o}
              label="Play"
              tone={closed[o.value!.actionCard] ? "plain" : "go"}
              pendingOptionId={pendingOptionId}
              onAnswer={answer}
            />
          </div>
        ))}
      </div>
      {/* A play button left on the tray for a card no longer in my hand (discarded: the engine can't type it) is not
          an option (pt7: a stray "(803) Construction Rider" after a discard). */}
      <ExtraOptions options={decision.options.filter((o) => o.value || !o.handler?.startsWith("ac_play_from_hand_"))} pendingOptionId={pendingOptionId} onAnswer={answer} />
    </div>
  );
}

/** The window after a card is played: who played what, who may still cancel, and my answer if I owe one. */
export function ActionCardSabotage({ decision, state, answer, pendingOptionId }: Props<"action_card.sabotage">) {
  useCardData();
  const typed = decision.options.filter((o) => o.value);
  const first = typed[0]?.value;
  const w = decision.window;
  const self = me(state);
  const cardId = (w?.subject.actionCard as string | null | undefined) ?? first?.actionCard;
  const playedBy = (w?.subject.faction as string | null | undefined) ?? first?.playedBy;
  const owe = !w || (!!self && w.eligible.includes(self.userId) && !w.responded.includes(self.userId));
  const answerable = typed.filter((o) => o.value!.action !== "wait" && (o.value!.playedBy !== self?.faction || !w));
  // The player who played the card may pause the auto-pass timer while the others decide.
  const pause = w && self?.faction === playedBy ? typed.find((o) => o.value!.action === "wait") : undefined;
  return (
    <div className={classes.root}>
      <Head title={acName(cardId)} meta={`played by ${playerLabel(state, playedBy)}`} />
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
          {answerable.map((o) => (
            <AnswerButton
              key={o.id}
              option={o}
              label={o.value!.action === "pass" ? "No Sabotage" : `Cancel with ${VIA[o.value!.via ?? "ac"] ?? "Sabotage"}`}
              tone={o.value!.action === "cancel" ? "stop" : "plain"}
              pendingOptionId={pendingOptionId}
              onAnswer={answer}
            />
          ))}
        </div>
      ) : (
        <span className={classes.meta}>Waiting for the others to answer.</span>
      )}
      {pause && (
        <div className={classes.options}>
          <AnswerButton option={pause} label="Pause timer" pendingOptionId={pendingOptionId} onAnswer={answer} />
        </div>
      )}
      {!w && <ExtraOptions options={decision.options} pendingOptionId={pendingOptionId} onAnswer={answer} />}
    </div>
  );
}

const VIA: Record<string, string> = { ac: "Sabotage", empy: "a Watcher", tf: "Triune fighters", xxcha: "Instinct Training" };

/** Choose a card to discard; shows the live hand count against the limit the engine reported. */
export function ActionCardDiscard({ decision, state, answer, pendingOptionId }: Props<"action_card.discard">) {
  useCardData();
  const cards = decision.options.filter((o) => o.value);
  const v = cards[0]?.value;
  const count = me(state)?.actionCardCount;
  const meta = v?.reason === "scheming" ? "Scheming: discard 1" : count != null && v ? `${count} / ${v.handLimit}` : undefined;
  return (
    <div className={classes.root}>
      <Head title="Discard an action card" meta={meta && <span className={classes.count}>{meta}</span>} />
      <div className={classes.list}>
        {cards.map((o) => (
          <div key={o.id} className={classes.row}>
            <span className={classes.rowName}>{acName(o.value!.actionCard)}</span>
            <AnswerButton option={o} label="Discard" tone="stop" pendingOptionId={pendingOptionId} onAnswer={answer} />
          </div>
        ))}
      </div>
      <ExtraOptions options={decision.options} pendingOptionId={pendingOptionId} onAnswer={answer} />
    </div>
  );
}

export function ActionCardDraw({ decision, answer, pendingOptionId }: Props<"action_card.draw">) {
  return (
    <div className={classes.root}>
      <Head title="Draw action cards" />
      <div className={classes.options}>
        {decision.options
          .filter((o) => o.value)
          .map((o) => (
            <AnswerButton
              key={o.id}
              option={o}
              label={o.value!.upTo ? `Draw up to ${o.value!.count}` : `Draw ${o.value!.count}`}
              tone="go"
              pendingOptionId={pendingOptionId}
              onAnswer={answer}
            />
          ))}
      </div>
      <ExtraOptions options={decision.options} pendingOptionId={pendingOptionId} onAnswer={answer} />
    </div>
  );
}

/** "Resolve <card>": the card comes from the typed value; the engine's button text only labels the step. */
export function ActionCardResolve({ decision, answer, pendingOptionId }: Props<"action_card.resolve">) {
  useCardData();
  const card = decision.options.find((o) => o.value?.actionCard)?.value?.actionCard;
  return (
    <div className={classes.root}>
      <Head title={card ? `Resolve ${acName(card)}` : "Resolve your action card"} meta="after any Sabotage window" />
      <div className={classes.options}>
        {decision.options.map((o) => (
          <AnswerButton
            key={o.id}
            option={o}
            label={o.label || "Resolve"}
            tone={o.value ? "go" : "plain"}
            pendingOptionId={pendingOptionId}
            onAnswer={answer}
          />
        ))}
      </div>
    </div>
  );
}

/** A target step: buttons named from the typed player / planet / system / strategy card. */
export function ActionCardTarget({ decision, state, answer, pendingOptionId }: Props<"action_card.target">) {
  const targetLabel = (v: NonNullable<DecisionOf<"action_card.target">["options"][number]["value"]>) => {
    const parts: string[] = [];
    if (v.player) parts.push(playerLabel(state, v.player));
    if (v.planet) parts.push(planetName(v.planet));
    if (v.system) parts.push(`System ${v.system}`);
    if (v.holder === "space") parts.push("space");
    if (v.strategyCard != null) parts.push(`Strategy card ${v.strategyCard}`);
    return parts.join(" · ");
  };
  return (
    <div className={classes.root}>
      <Head title="Choose a target" />
      <div className={classes.options}>
        {decision.options
          .filter((o) => o.value)
          .map((o) => (
            <AnswerButton key={o.id} option={o} label={targetLabel(o.value!)} pendingOptionId={pendingOptionId} onAnswer={answer} />
          ))}
      </div>
      <ExtraOptions options={decision.options} pendingOptionId={pendingOptionId} onAnswer={answer} />
    </div>
  );
}
