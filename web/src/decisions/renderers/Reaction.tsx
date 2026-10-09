import { actionCards } from "@/entities/data/actionCards";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose, Section } from "../ui/parts";
import { AgendaCard } from "./Agenda";
import type { RendererProps } from "./types";
import classes from "./renderers.module.css";

const PASS = /^(no_sabotage|no_when|no_after|declineToQueueAWhen|declineToQueueAnAfter|passOnEverythingWhensNAfters|lockAftersIn)/;

/** Which of my action cards fit this window. */
function playable(hand: string[] | undefined, kind: "sabotage" | "when" | "after") {
  if (!hand) return [];
  return hand
    .map((alias) => actionCards.find((a) => a.alias === alias))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .filter((a) => {
      if (kind === "sabotage") return /^sabo/.test(a.alias) || /cancel that action card/i.test(a.text);
      const w = a.window.toLowerCase();
      return kind === "when" ? w.startsWith("when an agenda is revealed") : w.startsWith("after an agenda is revealed");
    });
}

/** Sabotage / "when" / "after" windows: one prominent Pass, plus the cards I could play. */
export function ReactionBody({ d, data, onPress, pendingKey }: RendererProps) {
  const ids = d.choices.map((c) => baseId(c.customId));
  const kind = ids.some((id) => /sabotage/.test(id)) ? "sabotage" : ids.some((id) => /when/i.test(id)) ? "when" : "after";
  const cards = playable(data.hand, kind);
  const rankOf = (c: Choice) => {
    if (c.rank === "undo" || c.rank === "more") return c.rank;
    return PASS.test(baseId(c.customId)) ? "primary" : "secondary";
  };
  return (
    <div className={classes.stack}>
      {d.agenda && <AgendaCard agenda={d.agenda} compact />}
      <Prose text={d.text} clamp={6} />
      {data.hand && (
        <Section label={cards.length ? "Cards you could play" : "Your hand"}>
          {cards.length ? (
            <ul className={classes.cardChips}>
              {cards.map((c) => (
                <li key={c.alias} title={c.text}>
                  <b>{c.name}</b> <span className={classes.dim}>{c.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className={classes.dim}>Nothing in your hand fits this window.</span>
          )}
        </Section>
      )}
      <ChoiceButtons choices={d.choices} onPress={onPress} pendingKey={pendingKey} channelId={d.prompt.channelId} rankOf={rankOf} />
    </div>
  );
}
