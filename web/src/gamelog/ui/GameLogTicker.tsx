import { useEffect, useMemo, useRef, useState } from "react";
import { IconHistory } from "@tabler/icons-react";
import { useGameEvents } from "../useGameEvents";
import { useRewindIndex } from "@/rollback";
import { EventRow } from "./EventRow";
import classes from "./GameLogTicker.module.css";

type Props = {
  gameName: string;
  /** How many recent events to show (1–3). */
  max?: number;
  /** Opens the full log (shown as a "History" button when given). */
  onOpen?: () => void;
  className?: string;
  /** Show only the newest event, and only while it is fresh; at rest the ticker is invisible. */
  transient?: boolean;
};

const FRESH_MS = 6000;

/** The latest few notable events, newest first, for the top bar. New ones are briefly lit. */
export function GameLogTicker({ gameName, max = 3, onOpen, className, transient = false }: Props) {
  const { events } = useGameEvents(gameName);
  const rewinds = useRewindIndex(gameName, events);
  const latest = useMemo(
    () => events.filter((e) => e.importance >= 2 && !["undone", "replay"].includes(rewinds.rows.get(e.id)?.status ?? "")).slice(-Math.max(1, Math.min(3, transient ? 1 : max))).reverse(),
    [events, max, rewinds, transient],
  );

  const baseline = useRef<string | null>(null);
  const [fresh, setFresh] = useState<Record<string, true>>({});
  const newestId = latest[0]?.id;
  useEffect(() => {
    if (!newestId) return;
    if (baseline.current === null) {
      baseline.current = newestId;
      return;
    }
    if (baseline.current === newestId) return;
    baseline.current = newestId;
    setFresh((f) => ({ ...f, [newestId]: true }));
    const t = window.setTimeout(() => setFresh((f) => {
      const rest = { ...f };
      delete rest[newestId];
      return rest;
    }), FRESH_MS);
    return () => window.clearTimeout(t);
  }, [newestId]);

  if (transient) {
    const e = latest[0];
    const shown = !!e && !!fresh[e.id];
    return (
      <div
        className={`ti4play ${classes.transient} ${className ?? ""}`}
        data-shown={shown}
        aria-live="polite"
        aria-label="Latest game event"
      >
        {e && (
          <button type="button" className={classes.transientRow} onClick={onOpen} tabIndex={shown ? 0 : -1} title="Open the game log">
            <EventRow event={e} compact />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`ti4play ${classes.root} ${className ?? ""}`} aria-live="polite" aria-label="Latest game events">
      <div className={classes.list}>
        {!latest.length && <span className={classes.empty}>No events yet</span>}
        {latest.map((e, i) => (
          <div key={e.id} className={classes.item} data-age={i} data-fresh={!!fresh[e.id]}>
            <EventRow event={e} compact />
          </div>
        ))}
      </div>
      {onOpen && (
        <button type="button" className={classes.open} onClick={onOpen} title="Open the game log">
          <IconHistory size={14} stroke={1.75} aria-hidden />
          <span>Log</span>
        </button>
      )}
    </div>
  );
}
