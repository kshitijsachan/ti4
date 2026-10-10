import classes from "../Trade.module.css";
import { ICONS } from "../icons";
import type { Deal, TradeHolder } from "../deals";
import type { TradeCounterparty, TradeSelf } from "../types";

type Props = {
  me: TradeSelf;
  cp: TradeCounterparty;
  deals: Deal[];
  holder: TradeHolder | null;
  busy: boolean;
  onSend: (deal: Deal) => void;
  onEdit: (deal: Deal) => void;
  onPickHolder?: () => void;
};

function Comms({ n, total }: { n: number; total: number }) {
  return (
    <span className={classes.stat} title="Commodities">
      <img className={classes.statIcon} src={ICONS.comm} alt="Comm" />
      <span className={classes.mono}>
        {n}
        <span className={classes.muted}>/{total}</span>
      </span>
    </span>
  );
}

/** One-click commodity deals with the selected partner (N-1 washes, the Trade card replenish deal). */
export function QuickDeals({ me, cp, deals, holder, busy, onSend, onEdit, onPickHolder }: Props) {
  const askHolder = holder && onPickHolder && holder.faction !== cp.faction && holder.faction !== me.faction && me.commodities < me.commoditiesTotal;
  return (
    <div className={classes.deals}>
      <div className={classes.dealsHead}>
        <span className={classes.columnTitle}>Quick deals</span>
        <span className={classes.dealsWho}>
          You <Comms n={me.commodities} total={me.commoditiesTotal} /> · {cp.userName}{" "}
          <Comms n={cp.commodities} total={cp.commoditiesTotal} />
        </span>
      </div>
      <p className={classes.dealsExplain}>
        Commodities are worth nothing until traded: the receiver gets them as trade goods. In an N-1 wash one side sends N
        commodities and gets N-1 TG back, so both gain.
      </p>
      {deals.length === 0 && (
        <div className={classes.dealsEmpty}>
          No commodity deal with {cp.userName} right now
          {me.commodities === 0 && cp.commodities === 0 ? ": neither of you has commodities (the Trade card replenishes them)." : "."}
        </div>
      )}
      {deals.map((deal) => (
        <div key={deal.key} className={classes.deal}>
          <div className={classes.dealBody}>
            <span className={classes.dealTitle}>{deal.title}</span>
            <span className={classes.dealTerms}>
              give <b>{deal.give}</b> · get <b>{deal.get}</b>
            </span>
            <span className={classes.dealHint}>{deal.hint}</span>
          </div>
          <button type="button" className={classes.ghost} onClick={() => onEdit(deal)} title="Load into the ledger below to adjust">
            Edit
          </button>
          <button type="button" className={classes.accept} disabled={busy} onClick={() => onSend(deal)}>
            Propose
          </button>
        </div>
      ))}
      {askHolder && (
        <div className={classes.deal}>
          <div className={classes.dealBody}>
            <span className={classes.dealTitle}>{holder.name} holds Trade</span>
            <span className={classes.dealHint}>Ask them to replenish your commodities for free, for an N-1 wash.</span>
          </div>
          <button type="button" className={classes.ghost} onClick={onPickHolder}>
            Trade with {holder.name}
          </button>
        </div>
      )}
    </div>
  );
}
