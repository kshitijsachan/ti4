import { Button } from "@mantine/core";
import { useDecisionRequests } from "@/decisions";
import type { DecisionOf, GameState, TradeItem } from "../../../../../shim/src/engine/types";
import classes from "./trade.module.css";

export type TradeRendererProps<K extends "trade.offer" | "trade.offer_sent" | "trade.force_replenish"> = {
  decision: DecisionOf<K>;
  state: GameState | null;
  answer: (optionIdOrPayload: string) => void;
};

function itemText(i: TradeItem) {
  if (i.kind === "tg") return `${i.amount} TG`;
  if (i.kind === "commodities") return `${i.amount} commodit${i.amount === 1 ? "y" : "ies"}`;
  return i.label;
}

export function nameOf(state: GameState | null, faction: string | null | undefined) {
  return state?.players.find((p) => p.faction === faction)?.userName ?? faction ?? "?";
}

/** Both sides of an offer from the viewer's point of view. */
export function OfferSides({ items, me }: { items: TradeItem[]; me: string | null | undefined }) {
  const lines = items.filter((i) => i.kind !== "note");
  const get = lines.filter((i) => i.to === me);
  const give = lines.filter((i) => i.to !== me);
  const notes = items.filter((i) => i.kind === "note");
  const column = (label: string, list: TradeItem[]) => (
    <div className={classes.side}>
      <span className={classes.sideLabel}>{label}</span>
      {list.length === 0 && <span>Nothing</span>}
      {list.map((i) => (
        <span key={i.raw} className={classes.mono}>
          {itemText(i)}
        </span>
      ))}
    </div>
  );
  return (
    <>
      <div className={classes.sides}>
        {column("You get", get)}
        {column("You give", give)}
      </div>
      {notes.map((n) => (
        <span key={n.raw} className={classes.note}>
          “{n.label}”
        </span>
      ))}
    </>
  );
}

/** trade.offer: an offer to me. Accept / Decline, or Counter (decline here, then edit it in the trade drawer). */
export function TradeOfferRenderer({ decision, state, answer }: TradeRendererProps<"trade.offer">) {
  const requestTrade = useDecisionRequests((s) => s.requestTrade);
  const accept = decision.options.find((o) => o.value?.action === "accept" && !o.disabled);
  const reject = decision.options.find((o) => o.value?.action === "reject" && !o.disabled);
  const offer = (accept ?? reject)?.value;
  if (!offer) return null;
  const me = decision.target?.faction;
  const live = state?.trade ? state.trade.incoming.some((o) => o.decisionId === decision.id) : offer.current;
  const items = state?.trade?.incoming.find((o) => o.decisionId === decision.id)?.items ?? offer.items;
  const from = nameOf(state, offer.from);
  const outsideRule = !!state?.trade && !state.trade.mayTransactWith.includes(offer.from);
  return (
    <div className={classes.stack}>
      <div className={classes.head}>
        <span>Offer from {from}</span>
        {offer.offerNumber != null && <span className={classes.meta}>#{offer.offerNumber}</span>}
      </div>
      {live ? (
        <OfferSides items={items} me={me} />
      ) : (
        <span className={classes.meta}>Replaced or withdrawn: only the newest offer can be accepted.</span>
      )}
      {outsideRule && <span className={classes.warn}>You are not neighbours; outside the agenda phase this trade breaks the rules.</span>}
      <div className={classes.actions}>
        {accept && live && (
          <Button size="xs" color="green" onClick={() => answer(accept.id)}>
            Accept
          </Button>
        )}
        {reject && (
          <Button size="xs" variant="default" onClick={() => answer(reject.id)}>
            Decline
          </Button>
        )}
        {reject && live && (
          <Button size="xs" variant="subtle" onClick={() => requestTrade({ faction: offer.from, playerName: from })}>
            Counter…
          </Button>
        )}
      </div>
    </div>
  );
}
