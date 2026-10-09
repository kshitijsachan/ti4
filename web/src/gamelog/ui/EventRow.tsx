import { useState, type SyntheticEvent } from "react";
import { IconMapPin, IconPlayerTrackPrev } from "@tabler/icons-react";
import { useRewindRow } from "@/rollback";
import type { GameEvent } from "../types";
import { categoryOf, kindIcon } from "../categories";
import { useLogFocus } from "../useLogFocus";
import { actorLabel, segText } from "../parse/markup";
import { ActorName, Segments } from "./Segments";
import classes from "./EventRow.module.css";

type Props = {
  event: GameEvent;
  /** Show a round tag (`R2`) instead of the clock, for lists that cross rounds. */
  showRound?: boolean;
  /** Single line, no details, no time (ticker). */
  compact?: boolean;
};

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** One history line: time · type icon · player · what happened · system. */
export function EventRow({ event, showRound, compact }: Props) {
  const [open, setOpen] = useState(false);
  const focusSystem = useLogFocus((s) => s.focusSystem);
  const focused = useLogFocus((s) => s.focus?.eventId === event.id);
  const Icon = kindIcon(event.kind);
  const cat = categoryOf(event.kind).id;
  const hasDetails = !compact && !!event.details?.length;
  const clickable = hasDetails || !!event.systemPosition;
  const rewind = useRewindRow(event.id);
  const undone = rewind?.status === "undone";
  const replay = rewind?.status === "replay";
  const askRewind = rewind?.ask
    ? (e: SyntheticEvent) => {
        e.stopPropagation();
        rewind.ask!(`${event.actor ? `${actorLabel(event.actor)} ` : ""}${segText(event.summary)}`.trim());
      }
    : undefined;

  const onClick = () => {
    if (event.systemPosition) focusSystem(event.systemPosition, event.id);
    if (hasDetails) setOpen((v) => !v);
  };

  return (
    <div
      className={[classes.row, compact ? classes.compact : "", focused ? classes.focused : ""].join(" ")}
      data-importance={event.importance}
      data-cat={cat}
      data-undone={undone || replay || undefined}
      data-rewind={rewind?.status}
    >
      <div
        className={classes.main}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-expanded={hasDetails ? open : undefined}
        onClick={clickable ? onClick : undefined}
        onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick()) : undefined}
        title={event.systemPosition ? `Show system ${event.systemPosition} on the map` : undefined}
      >
        {!compact && <span className={classes.when}>{showRound ? `R${event.round}` : formatClock(event.time)}</span>}
        <Icon className={classes.kind} size={14} stroke={1.75} aria-hidden />
        <span className={classes.text}>
          {event.actor && <ActorName actor={event.actor} />} <Segments segs={event.summary} />
        </span>
        {event.vp ? <span className={classes.vp}>+{event.vp} VP</span> : null}
        {event.systemPosition && !compact && (
          <span className={classes.system}>
            <IconMapPin size={11} stroke={2} aria-hidden />
            {event.systemPosition}
          </span>
        )}
        {undone && !compact && (
          <span className={classes.undoneTag} title={rewind.by?.byName ? `Undone by ${rewind.by.byName}` : "Undone by a rewind / undo"}>
            undone
          </span>
        )}
        {replay && !compact && (
          <span className={classes.undoneTag} title="The bot re-posted this prompt while rolling back">
            re-posted
          </span>
        )}
        {askRewind && !compact && (
          <button
            type="button"
            className={classes.rewind}
            onClick={askRewind}
            onKeyDown={(e) => e.stopPropagation()}
            title="Rewind the game to just after this"
            aria-label="Rewind the game to just after this"
          >
            <IconPlayerTrackPrev size={12} stroke={2} aria-hidden />
          </button>
        )}
      </div>
      {open && hasDetails && (
        <div className={classes.details}>
          {event.details!.map((line, i) => (
            <div key={i} className={classes.detail}>
              <Segments segs={line} />
            </div>
          ))}
          {askRewind && (
            <button type="button" className={classes.rewindText} onClick={askRewind}>
              <IconPlayerTrackPrev size={12} stroke={2} aria-hidden />
              Rewind to here
            </button>
          )}
        </div>
      )}
    </div>
  );
}
