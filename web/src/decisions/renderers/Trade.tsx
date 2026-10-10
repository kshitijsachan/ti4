import { useQuery } from "@tanstack/react-query";
import { fetchPendingTrades, type PendingOffer, type TradeItem } from "@/trade";
import { getToken } from "@/play/session";
import { useDecisionRequests } from "../model/focus";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose } from "../ui/parts";
import { playerByName, type RendererProps } from "./types";
import classes from "./renderers.module.css";

const COUNTER_KEY = "decisions:counter";

function itemLabel(i: TradeItem) {
  return i.amount > 1 || /^(tg|comm)/i.test(i.kind) ? `${i.amount} ${i.label}` : i.label;
}

/** The current incoming offer from `faction`, from the bot's trade API (only fetched when the message lacks items). */
function usePendingOffer(gameName: string, enabled: boolean, faction?: string): PendingOffer | undefined {
  const token = getToken();
  const query = useQuery({
    queryKey: ["decisions", "trade-pending", gameName],
    enabled: enabled && !!token,
    staleTime: 10_000,
    retry: false,
    queryFn: () => fetchPendingTrades("/bot", gameName, token ?? ""),
  });
  const offers = (query.data?.incoming ?? []).filter((o) => o.current);
  return offers.find((o) => !faction || o.otherFaction === faction) ?? offers[0];
}

/** A trade offered to me: what each side gives, Accept / Reject / Counter. */
export function TradeBody({ d, data, onPress, pendingKey }: RendererProps) {
  const requestTrade = useDecisionRequests((s) => s.requestTrade);
  const trade = d.trade;
  const meName = data.me?.userName;
  const from = playerByName(data, trade?.from);
  /* A re-posted offer (after an undo) is one line long: read its items from the game's pending trades instead. */
  const pending = usePendingOffer(data.gameName, !trade?.sides.some((s) => s.items.length), from?.faction);
  const fromApi = pending
    ? {
        theirs: { who: pending.otherUserName, items: pending.items.filter((i) => i.from === pending.otherFaction).map(itemLabel) },
        mine: { who: meName ?? "you", items: pending.items.filter((i) => i.from !== pending.otherFaction).map(itemLabel) },
      }
    : undefined;
  const theirs = fromApi?.theirs ?? trade?.sides.find((s) => s.who !== meName) ?? trade?.sides[0];
  const mine = fromApi?.mine ?? trade?.sides.find((s) => s !== theirs);
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
      {!trade?.sides.length && !pending && <Prose text={d.text} clamp={3} />}
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
