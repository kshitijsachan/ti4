import type { ReactNode } from "react";
import cx from "clsx";
import type { PlayerData } from "@/entities/data/types";
import { ScArt, scDefinition } from "../../ui/parts";
import type { DecisionData } from "../types";
import { CARDS } from "./cards";
import classes from "./strategy.module.css";

export function playerLabel(p?: PlayerData) {
  if (!p) return "";
  // The bot serialises a missing display name as the string "null".
  const display = p.displayName && p.displayName !== "null" ? p.displayName : undefined;
  return display || p.userName || p.faction;
}

export function cardName(sc: number, data: DecisionData) {
  return scDefinition(sc, data.web)?.name ?? CARDS[sc]?.name ?? `Card ${sc}`;
}

/** Who holds a strategy card this round. */
export function holderOf(sc: number, data: DecisionData) {
  const faction = data.web?.strategyCards?.find((c) => c.initiative === sc)?.pickedByFaction;
  if (faction) return data.players.find((p) => p.faction === faction);
  return data.players.find((p) => (p as PlayerData & { scs?: number[] }).scs?.includes(sc));
}

/** The card's art and number on the left, its name and a one-line role on the right. */
export function CardHeader({ sc, data, sub, children }: { sc: number; data: DecisionData; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className={classes.header}>
      <ScArt initiative={sc} web={data.web} width={64} className={classes.art} />
      <div className={classes.headText}>
        <span className={classes.cardName}>
          <span className={classes.initiative}>{sc}</span>
          {cardName(sc, data)}
        </span>
        {sub && <span className={classes.sub}>{sub}</span>}
        {children}
      </div>
    </div>
  );
}

/** Every other player's answer to a played card: followed / waiting. */
export function FollowStatus({ sc, data }: { sc: number; data: DecisionData }) {
  const holder = holderOf(sc, data);
  const others = data.players.filter((p) => p.faction !== holder?.faction && !(p as { eliminated?: boolean }).eliminated);
  if (!others.length) return null;
  return (
    <div className={classes.followRow} aria-label="Who has answered">
      {others.map((p) => {
        const done = p.followedSCs?.includes(sc);
        const me = p.faction === data.me?.faction;
        return (
          <span key={p.faction} className={cx(classes.chip, done ? classes.chipDone : classes.chipWait, me && classes.chipMe)}>
            <span className={classes.chipDot} />
            {me ? "You" : playerLabel(p)}
            <span className={classes.chipState}>{done ? "answered" : "deciding"}</span>
          </span>
        );
      })}
    </div>
  );
}
