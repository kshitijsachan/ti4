import { useId, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { IconChevronDown, IconMapPin, IconPlayerTrackPrev } from "@tabler/icons-react";
import { useRewindRow } from "@/rollback";
import type { GameEvent } from "../types";
import { categoryOf, kindIcon } from "../categories";
import { useLogFocus } from "../useLogFocus";
import { actorLabel, segText } from "../parse/markup";
import { ActorName, Segments } from "./Segments";
import { useLogExpansion } from "./expansion";
import { strategyCardFor } from "./scCard";
import classes from "./EventRow.module.css";

type Props = {
  event: GameEvent;
  /** Show a round tag (`R2`) instead of the clock, for lists that cross rounds. */
  showRound?: boolean;
  /** Single line, no details, no time (ticker). */
  compact?: boolean;
  /** Shown inside another row's expansion (a strategy card's primary, follows and declines). */
  nested?: boolean;
};

const NONE: readonly GameEvent[] = [];

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

const sameActor = (a: GameEvent, b: GameEvent) =>
  !!a.actor && !!b.actor && (a.actor.faction ? a.actor.faction === b.actor.faction : a.actor.userId === b.actor.userId);
const actorId = (e: GameEvent) => e.actor?.faction ?? e.actor?.userId ?? e.actor?.name ?? "";
const isFollow = (e: GameEvent) => e.kind === "sc_follow" && segText(e.summary).startsWith("followed");
const isDecline = (e: GameEvent) => e.kind === "sc_follow" && !isFollow(e);

/** `1 followed · 2 declined`, for a collapsed strategy card play. */
function responseHint(kids: readonly GameEvent[]): string {
  const yes = kids.filter(isFollow).length;
  const no = kids.filter(isDecline).length;
  return [yes && `${yes} followed`, no && `${no} declined`].filter(Boolean).join(" · ");
}

/** The play's own effects first, then each other player's response grouped together (follow, then what they did). */
function splitKids(event: GameEvent, kids: readonly GameEvent[]) {
  const own = kids.filter((k) => sameActor(event, k) || !k.actor);
  const rest = kids.filter((k) => !own.includes(k));
  const order = [...new Set(rest.map(actorId))];
  const others = [...rest].sort((a, b) => order.indexOf(actorId(a)) - order.indexOf(actorId(b)) || Number(b.kind === "sc_follow") - Number(a.kind === "sc_follow"));
  return { own, others };
}

/** One history line: time · type icon · player · what happened · system. Rows with details expand in place. */
export function EventRow({ event, showRound, compact, nested }: Props) {
  const expansion = useLogExpansion();
  const [localOpen, setLocalOpen] = useState(false);
  const detailsId = useId();
  const focusSystem = useLogFocus((s) => s.focusSystem);
  const focused = useLogFocus((s) => s.focus?.eventId === event.id);
  const Icon = kindIcon(event.kind);
  const cat = categoryOf(event.kind).id;
  const kids = compact || !expansion ? NONE : expansion.childrenOf(event.id);
  const card = compact ? undefined : strategyCardFor(event);
  const hasDetails = !compact && (!!event.details?.length || kids.length > 0 || !!card);
  const open = hasDetails && (expansion ? expansion.isOpen(event.id) : localOpen);
  const clickable = hasDetails || !!event.systemPosition;
  const flash = !!expansion?.flashId && expansion.flashId === event.id;
  const rewind = useRewindRow(event.id);
  const undone = rewind?.status === "undone";
  const replay = rewind?.status === "replay";
  const askRewind = rewind?.ask
    ? (e: SyntheticEvent) => {
        e.stopPropagation();
        rewind.ask!(`${event.actor ? `${actorLabel(event.actor)} ` : ""}${segText(event.summary)}`.trim());
      }
    : undefined;
  const hint = hasDetails && !open && event.kind === "sc_play" ? responseHint(kids) : "";

  const onClick = () => {
    if (event.systemPosition) focusSystem(event.systemPosition, event.id);
    if (!hasDetails) return;
    if (expansion) expansion.toggle(event.id);
    else setLocalOpen((v) => !v);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onClick();
  };

  const rowTitle = [
    hasDetails ? (open ? "Hide details" : "Show details") : "",
    event.systemPosition ? `show system ${event.systemPosition} on the map` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div
      className={[classes.row, compact ? classes.compact : "", nested ? classes.nested : "", focused ? classes.focused : "", flash ? classes.flash : ""].join(" ")}
      data-event-id={event.id}
      data-importance={event.importance}
      data-cat={cat}
      data-open={open || undefined}
      data-undone={undone || replay || undefined}
      title={undone ? "Undone" : replay ? "Re-posted by the bot while rolling back" : undefined}
      data-rewind={rewind?.status}
    >
      <div
        className={classes.main}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-expanded={hasDetails ? open : undefined}
        aria-controls={open ? detailsId : undefined}
        onClick={clickable ? onClick : undefined}
        onKeyDown={clickable ? onKeyDown : undefined}
        title={rowTitle ? rowTitle[0].toUpperCase() + rowTitle.slice(1) : undefined}
      >
        {!compact && !nested && <span className={classes.when}>{showRound ? `R${event.round}` : formatClock(event.time)}</span>}
        <Icon className={classes.kind} size={14} stroke={1.75} aria-hidden />
        <span className={classes.text}>
          {event.actor && <ActorName actor={event.actor} />} <Segments segs={event.summary} />
          {hint && <span className={classes.hint}> · {hint}</span>}
        </span>
        {event.vp ? <span className={classes.vp}>+{event.vp} VP</span> : null}
        {event.systemPosition && !compact && (
          <span className={classes.system}>
            <IconMapPin size={11} stroke={2} aria-hidden />
            {event.systemPosition}
          </span>
        )}
        {hasDetails && <IconChevronDown className={classes.chevron} size={13} stroke={2} aria-hidden />}
        {askRewind && !compact && (
          <button
            type="button"
            className={classes.rewind}
            onClick={askRewind}
            onKeyDown={(e) => e.stopPropagation()}
            title="Rewind to here"
            aria-label="Rewind to here"
          >
            <IconPlayerTrackPrev size={12} stroke={2} aria-hidden />
          </button>
        )}
      </div>
      {open && <Details id={detailsId} event={event} kids={kids} card={card} />}
    </div>
  );
}

type DetailsProps = { id: string; event: GameEvent; kids: readonly GameEvent[]; card: ReturnType<typeof strategyCardFor> };

function Details({ id, event, kids, card }: DetailsProps) {
  const { own, others } = splitKids(event, kids);
  return (
    <div id={id} className={classes.details}>
      {event.details?.map((line, i) => (
        <div key={i} className={classes.detail}>
          <Segments segs={line} />
        </div>
      ))}
      {card && <CardText label="Primary" texts={card.primaryTexts} />}
      {own.map((k) => (
        <EventRow key={k.id} event={k} nested />
      ))}
      {card && !!others.length && <CardText label="Secondary" texts={card.secondaryTexts} />}
      {others.map((k) => (
        <EventRow key={k.id} event={k} nested />
      ))}
      {card && !kids.length && <div className={classes.detail}>No responses yet.</div>}
    </div>
  );
}

function CardText({ label, texts }: { label: string; texts: string[] }) {
  if (!texts.length) return null;
  return (
    <div className={classes.cardText}>
      <span className={classes.cardLabel}>{label}</span> {texts.join(" ")}
    </div>
  );
}
