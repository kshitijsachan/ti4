import { Button } from "@mantine/core";
import { nameOf, type TradeRendererProps } from "./TradeOffer";
import classes from "./trade.module.css";

/** trade.force_replenish: Trade primary, replenish other players' commodities for free (usually as part of a deal). */
export function TradeForceReplenishRenderer({ decision, state, answer }: TradeRendererProps<"trade.force_replenish">) {
  const rows = decision.options.filter((o) => o.value);
  const done = decision.options.find((o) => !o.value && !o.disabled);
  return (
    <div className={classes.stack}>
      <div className={classes.head}>Trade: replenish others for free</div>
      <span className={classes.meta}>No strategy token for them. Washing their new commodities is a separate trade.</span>
      <div className={classes.rows}>
        {rows.map((o) => {
          const v = o.value!;
          const full = v.commodities >= v.commoditiesMax;
          return (
            <div key={o.id} className={classes.row}>
              <span className={classes.rowName}>{nameOf(state, v.faction)}</span>
              <span className={classes.mono}>
                {v.commodities}/{v.commoditiesMax}
              </span>
              <span className={classes.meta}>{v.neighbor ? "neighbour" : ""}</span>
              <Button size="xs" variant="light" disabled={o.disabled || full} onClick={() => answer(o.id)}>
                {full ? "Full" : "Replenish"}
              </Button>
            </div>
          );
        })}
      </div>
      {done && (
        <div className={classes.actions}>
          <Button size="xs" variant="default" onClick={() => answer(done.id)}>
            {done.label || "Done"}
          </Button>
        </div>
      )}
    </div>
  );
}
