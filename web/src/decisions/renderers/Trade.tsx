import { useDecisionRequests } from "../model/focus";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose } from "../ui/parts";
import { playerByName, type RendererProps } from "./types";
import classes from "./renderers.module.css";

const COUNTER_KEY = "decisions:counter";

/** A trade offered to me: what each side gives, Accept / Reject / Counter. */
export function TradeBody({ d, data, onPress, pendingKey }: RendererProps) {
  const requestTrade = useDecisionRequests((s) => s.requestTrade);
  const trade = d.trade;
  const meName = data.me?.userName;
  const from = playerByName(data, trade?.from);
  const theirs = trade?.sides.find((s) => s.who !== meName) ?? trade?.sides[0];
  const mine = trade?.sides.find((s) => s !== theirs);
  const reset = d.choices.find((c) => /^resetOffer/.test(baseId(c.customId)));
  const counter: Choice | null = reset
    ? { ...reset, key: COUNTER_KEY, customId: COUNTER_KEY, label: "Counter…", style: 1, rank: "primary" }
    : null;
  const choices = counter ? [...d.choices, counter] : d.choices;
  const press = (c: Choice, values?: string[]) => {
    if (c.key !== COUNTER_KEY) return onPress(c, values);
    requestTrade({ faction: from?.faction, playerName: from?.userName ?? trade?.from });
  };
  return (
    <div className={classes.stack}>
      <ul className={classes.ledgerLines}>
        <li>
          <span className={classes.dim}>{from?.userName ?? trade?.from ?? "They"} gives:</span>{" "}
          {theirs?.items.length ? theirs.items.join(", ") : "nothing"}
        </li>
        <li>
          <span className={classes.dim}>You give:</span> {mine?.items.length ? mine.items.join(", ") : "nothing"}
        </li>
      </ul>
      {!trade?.sides.length && <Prose text={d.text} clamp={3} />}
      <ChoiceButtons
        choices={choices}
        onPress={press}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={(c) => (c === reset ? "more" : c.rank === "secondary" ? "primary" : c.rank)}
      />
    </div>
  );
}
