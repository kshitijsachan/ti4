import { actionCards } from "@/entities/data/actionCards";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { Details, Prose } from "../ui/parts";
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
  const choices = d.choices.map((c) => {
    const id = baseId(c.customId);
    if (PASS.test(id)) return { ...c, style: 3, label: kind === "sabotage" ? "Let it resolve" : c.label.replace(/\s*\(.*\)$/, "") };
    if (/^sabotage_/.test(id)) return { ...c, label: "Sabotage it", style: 2 };
    return c;
  });
  const lead = d.text.split("\n")[0].replace(/\.+$/, ".");
  const cardText = d.prompt.message.embeds?.[0]?.description?.replace(/\*/g, "").trim();
  return (
    <div className={classes.stack}>
      {d.agenda && <AgendaCard agenda={d.agenda} compact />}
      <Prose text={kind === "sabotage" ? lead : d.text} clamp={2} />
      <ChoiceButtons choices={choices} onPress={onPress} pendingKey={pendingKey} channelId={d.prompt.channelId} rankOf={rankOf} />
      {kind === "sabotage" && cardText && (
        <Details label="Card text">
          <Prose text={cardText} clamp={6} muted />
        </Details>
      )}
      {data.hand && (
        <Details label={cards.length ? `You could play ${cards.length === 1 ? cards[0].name : `${cards.length} cards`}` : "Your cards"}>
          {cards.length ? (
            <ul className={classes.cardChips}>
              {cards.map((c) => (
                <li key={c.alias}>
                  <b>{c.name}</b> <span className={classes.dim}>{c.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className={classes.dim}>Nothing in your hand fits this window.</span>
          )}
        </Details>
      )}
    </div>
  );
}
