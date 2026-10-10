import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePlay } from "@/discord";
import { useGameEvents } from "@/gamelog";
import { segText } from "@/gamelog/parse/markup";
import type { GameEvent } from "@/gamelog";
import classes from "./OutcomeToast.module.css";

/** How long after my press the bot's reply still counts as its outcome. */
const REPLY_WINDOW_MS = 20_000;
const SHOW_MS = 6_000;

/** "You researched Gravity Drive": the game log's own wording for an event of mine. */
function outcomeText(events: GameEvent[]) {
  return events.map((e) => segText(e.summary).trim()).filter(Boolean).slice(-2).join(" · ");
}

/**
 * What my last press did, in plain words, for a few seconds: the game-log events the bot posted for my faction right
 * after the press (gained trade goods, readied planets, explored, rolled, scored…). One toast at a time.
 */
export function OutcomeToast({ gameName, faction, rightInset }: { gameName: string; faction?: string; rightInset: number }) {
  const pressed = usePlay((s) => s.pressed);
  const { events } = useGameEvents(gameName);
  const lastPress = useMemo(() => Math.max(0, ...Object.values(pressed)), [pressed]);
  const outcome = useMemo(() => {
    if (!faction || !lastPress) return undefined;
    const mine = events.filter((e) => {
      const at = Date.parse(e.time);
      return at >= lastPress - 1000 && at <= lastPress + REPLY_WINDOW_MS && e.actor?.faction === faction && e.importance >= 2;
    });
    if (!mine.length) return undefined;
    return { key: mine[mine.length - 1].id, text: outcomeText(mine) };
  }, [events, faction, lastPress]);

  /* The last few outcomes, newest last; each leaves after a few seconds. */
  const [shown, setShown] = useState<{ key: string; text: string }[]>([]);
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    if (!outcome || outcome.key === seen) return;
    setSeen(outcome.key);
    setShown((list) => [...list.filter((x) => x.key !== outcome.key), outcome].slice(-3));
    const timer = window.setTimeout(() => setShown((list) => list.filter((x) => x.key !== outcome.key)), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [outcome, seen]);

  if (!shown.length || typeof document === "undefined") return null;
  const style = { "--decision-right-inset": `${rightInset}px` } as CSSProperties;
  return createPortal(
    <div className={`ti4play ${classes.stack}`} style={style} role="status" aria-live="polite">
      {shown.map((o) => (
        <div key={o.key} className={classes.toast}>
          <span className={classes.you}>You</span> {o.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}
