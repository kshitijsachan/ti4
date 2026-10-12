import { useMemo } from "react";
import { usePlay } from "@/discord";
import type { PlayerData } from "@/entities/data/types";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { FactionIcon } from "../../ui/parts";
import type { DecisionData } from "../types";
import { parseRoll, type Roll } from "./rolls";
import { unitName } from "./units";
import classes from "./combat.module.css";

/** One side's dice: each die as a numbered square (hits filled), then "→ N hits". */
export function RollRow({ who, roll, waiting }: { who: PlayerData | undefined; roll?: Roll; waiting: string }) {
  const dice = roll?.lines.flatMap((l) => l.dice) ?? [];
  return (
    <div className={classes.rollRow}>
      <span className={classes.rollWho}>
        <FactionIcon faction={who?.faction} size={14} />
        {who?.userName ?? "Opponent"}
      </span>
      {roll ? (
        <span className={classes.dice} title={roll.lines.map((l) => `${l.count}× ${l.unit ? unitName(l.unit, l.count) : "unit"} hit on ${l.hitsOn ?? "?"}+`).join(" · ")}>
          {dice.map((die, i) => (
            <span key={i} className={die.hit ? `${classes.die} ${classes.dieHit}` : classes.die}>
              {die.value}
            </span>
          ))}
        </span>
      ) : (
        <span className={classes.rollWaiting}>{waiting}</span>
      )}
      {roll && (
        <span className={classes.rollHits}>
          → {roll.total} hit{roll.total === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

const WORD: Record<Roll["kind"], string> = {
  combat: "Combat",
  afb: "Anti-fighter barrage",
  bombardment: "Bombardment",
  spaceCannonOffence: "Space cannon",
  spaceCannonDefence: "Space cannon defence",
};

/**
 * Dice the bot rolled in a channel after a given message (bombardment from the landing step, space cannon), as
 * readable rows: "Bombardment — CombatAudit 3 10 6 → 2 hits".
 */
export function RecentRolls({ channelId, after, kinds, data }: { channelId: string; after: string; kinds: Roll["kind"][]; data: DecisionData }) {
  const msgs = usePlay((s) => s.messages[channelId]);
  const rolls = useMemo(() => {
    if (!msgs) return [];
    return msgs.ids
      .filter((id) => compareSnowflakes(id, after) > 0)
      .map((id) => msgs.byId[id] && parseRoll(msgs.byId[id]))
      .filter((r): r is Roll => !!r && kinds.includes(r.kind));
  }, [msgs, after, kinds]);
  if (!rolls.length) return null;
  const who = (faction: string): PlayerData | undefined =>
    data.players.find((p) => p.faction && (faction.startsWith(p.faction) || p.faction.startsWith(faction)));
  return (
    <div className={classes.round}>
      {rolls.map((r) => (
        <div key={r.id} className={classes.round}>
          <span className={classes.roundHead}>{WORD[r.kind]}</span>
          <RollRow who={who(r.faction)} roll={r} waiting="" />
        </div>
      ))}
    </div>
  );
}
