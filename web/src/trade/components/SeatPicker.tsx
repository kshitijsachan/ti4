import cx from "clsx";
import type { CSSProperties } from "react";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import classes from "../Trade.module.css";
import { ICONS, factionIcon } from "../icons";
import type { TradeCounterparty } from "../types";

type Props = {
  counterparties: TradeCounterparty[];
  selected: string | null;
  onSelect: (faction: string) => void;
  phase: string;
  pendingWith: Set<string>;
};

function statusTag(cp: TradeCounterparty, phase: string) {
  if (!cp.canTrade) return { text: "Locked", cls: classes.tagBlocked, title: cp.reason ?? undefined };
  if (cp.neighbor) return { text: "Neighbor", cls: classes.tagLive, title: "Neighbors may always trade" };
  if (phase.toLowerCase() !== "action") return {
      text: "Open",
      cls: classes.tagLive,
      title: "Outside the action phase anyone may trade",
    };
  return { text: "Allowed", cls: classes.tagLive, title: "An ability or law lets you trade" };
}

/** Who to trade with. Players the bot won't let you trade with are shown, locked, with the reason. */
export function SeatPicker({ counterparties, selected, onSelect, phase, pendingWith }: Props) {
  return (
    <div className={classes.seats} role="radiogroup" aria-label="Trade partner">
      {counterparties.map((cp) => {
        const tag = statusTag(cp, phase);
        return (
          <button
            key={cp.faction}
            type="button"
            role="radio"
            aria-checked={selected === cp.faction}
            className={cx(classes.seat, selected === cp.faction && classes.seatSelected)}
            style={{ "--seat-color": getPrimaryColorCSS(cp.color) } as CSSProperties}
            disabled={!cp.canTrade}
            title={cp.canTrade ? undefined : (cp.reason ?? "Can't trade")}
            onClick={() => onSelect(cp.faction)}
          >
            <img className={classes.seatIcon} src={factionIcon(cp.faction, cp.icon)} alt="" />
            <span className={classes.seatTop}>
              <span className={classes.seatName}>{cp.userName}</span>
              <span className={cx(classes.tag, tag.cls)} title={tag.title}>
                {tag.text}
              </span>
            </span>
            <span className={classes.seatStats}>
              <span className={classes.stat} title="Trade goods">
                <img className={classes.statIcon} src={ICONS.tg} alt="TG" />
                {cp.tg}
              </span>
              <span className={classes.stat} title="Commodities">
                <img className={classes.statIcon} src={ICONS.comm} alt="Comm" />
                <span>
                  {cp.commodities}
                  <span className={classes.muted}>/{cp.commoditiesTotal}</span>
                </span>
              </span>
              <span className={classes.stat} title="Promissory notes in hand">
                <img className={classes.statIcon} src={ICONS.pn} alt="PN" />
                {cp.pnCount}
              </span>
              <span className={classes.stat} title="Action cards in hand">
                <span className={classes.muted}>AC</span>
                {cp.acCount}
              </span>
              {pendingWith.has(cp.faction) && (
                <span className={classes.seatPending} title="You have an open offer to this player">
                  offer out
                </span>
              )}
            </span>
            {!cp.canTrade && cp.reason && <span className={classes.seatReason}>{cp.reason}</span>}
          </button>
        );
      })}
    </div>
  );
}
