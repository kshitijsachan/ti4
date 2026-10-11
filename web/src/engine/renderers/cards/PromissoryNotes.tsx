import type { DecisionOf } from "../../contract";
import type { EngineRendererProps } from "../../registry";
import { useCardData } from "@/hand/cardData";
import { playerLabel, pnName } from "./labels";
import { AnswerButton, ExtraOptions, Head } from "./parts";
import classes from "./Cards.module.css";

/** Promissory notes in hand (or a "this is the window to play X" offer): note, owner, play. */
export function PromissoryNotePlay({
  decision,
  state,
  answer,
  pendingOptionId,
}: EngineRendererProps<DecisionOf<"promissory_note.play">>) {
  useCardData();
  const notes = decision.options.filter((o) => o.value);
  return (
    <div className={classes.root}>
      <Head title="Promissory notes" meta={<span className={classes.count}>{notes.length}</span>} />
      <div className={classes.list}>
        {notes.map((o) => {
          const v = o.value!;
          const detail = [`from ${playerLabel(state, v.owner)}`, v.playArea ? "stays in play" : null, v.tech ? `gain ${v.tech}` : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <div key={o.id} className={classes.row}>
              <div className={classes.rowText}>
                <span className={classes.rowName}>{pnName(v.promissoryNote)}</span>
                <span className={classes.meta}>{detail}</span>
              </div>
              <AnswerButton option={o} label="Play" tone="go" pendingOptionId={pendingOptionId} onAnswer={answer} />
            </div>
          );
        })}
      </div>
      <ExtraOptions options={decision.options} pendingOptionId={pendingOptionId} onAnswer={answer} />
    </div>
  );
}
