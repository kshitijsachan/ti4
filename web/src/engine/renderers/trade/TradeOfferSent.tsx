import { Button } from "@mantine/core";
import { OfferSides, nameOf, type TradeRendererProps } from "./TradeOffer";
import classes from "./trade.module.css";

/** trade.offer_sent: my own offer. Rescind while it is open; the bot leaves this prompt up after an answer. */
export function TradeOfferSentRenderer({ decision, state, answer }: TradeRendererProps<"trade.offer_sent">) {
  const rescind = decision.options.find((o) => o.value?.action === "rescind" && !o.disabled);
  const v = rescind?.value;
  if (!v) return null;
  const open = state?.trade?.outgoing.find((o) => o.to === v.to);
  return (
    <div className={classes.stack}>
      <div className={classes.head}>
        <span>Your offer to {nameOf(state, v.to)}</span>
        {open && <span className={classes.meta}>#{open.offerNumber} · awaiting them</span>}
      </div>
      {open ? (
        <OfferSides items={open.items} me={decision.target?.faction} />
      ) : (
        <span className={classes.meta}>Answered or replaced.</span>
      )}
      {open && (
        <div className={classes.actions}>
          <Button size="xs" color="red" variant="light" onClick={() => answer(rescind.id)}>
            Rescind
          </Button>
        </div>
      )}
    </div>
  );
}
