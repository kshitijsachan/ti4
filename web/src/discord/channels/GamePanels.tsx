import { useState } from "react";
import type { Channel, Message } from "../types";
import { ChannelView } from "./ChannelView";
import { usePlay } from "../client/PlayProvider";
import classes from "./GamePanels.module.css";

export type GamePanelProps = {
  /** Game id, e.g. `pbd1`. */
  gameName: string;
  /** Show the composer (slash commands run in the actions channel). Default true for the log, false for the hand. */
  composer?: boolean;
  className?: string;
};

function useGameChannel(pred: (c: Channel) => boolean) {
  return usePlay((s) => {
    for (const id in s.channels) if (pred(s.channels[id])) return id;
    return undefined;
  });
}

/** The bot names hand threads `<game>-cards-info-<player>` (or `Cards Info-<game>-<player>`). */
export function isHandThread(name: string, gameName: string): boolean {
  if (!/cards[\s_-]?info/i.test(name)) return false;
  return name.split(/[\s-]+/).includes(gameName);
}

const notChatter = (m: Message) => m.author.bot === true || !!m.ephemeral;

/** The game's `<game>-actions` channel as a compact, time-stamped ledger with its live buttons. */
export function ActionLog({ gameName, composer = true, className }: GamePanelProps) {
  const id = useGameChannel((c) => c.name === `${gameName}-actions`);
  const [hideChatter, setHideChatter] = useState(false);
  return (
    <ChannelView
      className={className}
      channelId={id}
      variant="log"
      composer={composer}
      filter={hideChatter ? notChatter : undefined}
      headerExtra={
        <button
          type="button"
          className={classes.toggle}
          aria-pressed={hideChatter}
          onClick={() => setHideChatter((v) => !v)}
          title="Show only bot output"
        >
          {hideChatter ? "Bot only" : "All"}
        </button>
      }
      empty={<div className={classes.empty}>No actions yet.</div>}
    />
  );
}

/** The player's private `cards-info` thread, shown as their hand with its card buttons. */
export function HandPanel({ gameName, composer = false, className }: GamePanelProps) {
  const id = useGameChannel((c) => isHandThread(c.name, gameName));
  if (!id) {
    return (
      <section className={`ti4play ${classes.missing} ${className ?? ""}`}>
        <div className={classes.missingTitle}>Hand</div>
        <div className={classes.empty}>Your cards appear here once the game has started and the bot opens your cards-info thread.</div>
      </section>
    );
  }
  return <ChannelView className={className} channelId={id} variant="hand" composer={composer} />;
}
