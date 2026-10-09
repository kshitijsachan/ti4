import cx from "clsx";
import type { CSSProperties } from "react";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import { FRAGMENT_COLOR, ICONS, factionIcon } from "../icons";
import type { ButtonRef, FragmentTrait, PendingOffer, TradeItem } from "../types";
import classes from "../Trade.module.css";

type Props = {
  offers: PendingOffer[];
  myFaction: string;
  busyKey: string | null;
  onPress: (button: ButtonRef, offer: PendingOffer) => void;
  onCounter: (offer: PendingOffer) => void;
  onHide: (offer: PendingOffer) => void;
};

function ItemIcon({ item }: { item: TradeItem }) {
  if (item.kind === "tg") return <img className={classes.rowIcon} src={ICONS.tg} alt="" />;
  if (item.kind === "commodities") return <img className={classes.rowIcon} src={ICONS.comm} alt="" />;
  if (item.kind === "pn" || item.kind === "pnAny") return <img className={classes.rowIcon} src={ICONS.pn} alt="" />;
  if (item.kind === "relic") return <img className={classes.rowIcon} src={ICONS.relic} alt="" />;
  if (item.kind === "fragment") {
    const color = FRAGMENT_COLOR[item.id as FragmentTrait] ?? "var(--t-frontier)";
    return <span className={classes.swatch} style={{ background: color }} />;
  }
  const color = item.kind.includes("Debt") ? "var(--t-debt)" : item.kind.startsWith("ac") ? "var(--t-ac)" : "var(--t-ink-muted)";
  return <span className={classes.swatch} style={{ background: color }} />;
}

function Side({ label, items }: { label: string; items: TradeItem[] }) {
  return (
    <div className={classes.offerSide}>
      <span className={classes.offerSideLabel}>{label}</span>
      {items.length === 0 && <span className={classes.offerItem}>Nothing</span>}
      {items.map((it) => (
        <span key={it.raw} className={classes.offerItem}>
          <ItemIcon item={it} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Open offers to and from the player, with the bot's own Accept / Reject / Rescind buttons. */
export function OfferList({ offers, myFaction, busyKey, onPress, onCounter, onHide }: Props) {
  if (offers.length === 0) return <div className={classes.empty}>No open offers.</div>;
  return (
    <div className={classes.offers}>
      {offers.map((offer) => {
        const incoming = offer.direction === "incoming";
        const key = `${offer.direction}:${offer.otherFaction}:${offer.offerNumber}:${offer.createdAt}`;
        const busy = busyKey?.startsWith(key) ?? false;
        const items = offer.items.filter((i) => i.kind !== "note");
        const notes = offer.items.filter((i) => i.kind === "note");
        const theirs = items.filter((i) => i.from !== myFaction);
        const mine = items.filter((i) => i.from === myFaction);
        return (
          <article
            key={key}
            className={cx(classes.offer, incoming && classes.offerIncoming, !offer.current && classes.offerStale)}
            style={{ "--offer-color": getPrimaryColorCSS(offer.otherColor) } as CSSProperties}
          >
            <div className={classes.offerHead}>
              <span className={classes.offerBand} />
              <img className={classes.offerIcon} src={factionIcon(offer.otherFaction, offer.otherIcon)} alt="" />
              <span className={classes.offerWho}>
                {incoming ? `From ${offer.otherUserName}` : `To ${offer.otherUserName}`}
              </span>
              <span className={cx(classes.tag, incoming && offer.current && classes.tagLive)}>
                {incoming ? (offer.current ? "Awaiting you" : "Withdrawn") : "Awaiting them"}
              </span>
              <span className={classes.spacer} />
              <span className={classes.offerTime}>
                #{offer.offerNumber} · {timeAgo(offer.createdAt)}
              </span>
            </div>
            {offer.current ? (
              <div className={classes.offerSides}>
                <Side label="You get" items={theirs} />
                <Side label="You give" items={mine} />
              </div>
            ) : (
              <span className={classes.rowEmpty}>Rescinded or replaced — the bot will no longer accept it.</span>
            )}
            <div className={classes.offerActions}>
              {incoming && offer.accept && offer.current && (
                <button type="button" className={classes.accept} disabled={busy} onClick={() => onPress(offer.accept!, offer)}>
                  Accept
                </button>
              )}
              {incoming && !offer.current && (
                <button type="button" className={classes.ghost} onClick={() => onHide(offer)}>
                  Hide
                </button>
              )}
              {incoming && offer.reject && offer.current && (
                <button type="button" className={classes.danger} disabled={busy} onClick={() => onPress(offer.reject!, offer)}>
                  Reject
                </button>
              )}
              {incoming && offer.reject && offer.current && (
                <button type="button" className={classes.ghost} disabled={busy} onClick={() => onCounter(offer)}>
                  Counter
                </button>
              )}
              {!incoming && offer.rescind && (
                <button type="button" className={classes.danger} disabled={busy} onClick={() => onPress(offer.rescind!, offer)}>
                  Rescind
                </button>
              )}
            </div>
            {notes.map((n) => (
              <span key={n.raw} className={classes.offerNote}>
                “{n.label}”
              </span>
            ))}
          </article>
        );
      })}
    </div>
  );
}
