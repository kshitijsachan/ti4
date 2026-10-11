import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePlay } from "@/discord";
import { useGameEvents } from "@/gamelog";
import { segText } from "@/gamelog/parse/markup";
import type { GameEvent } from "@/gamelog";
import type { PlayerDataResponse } from "@/entities/data/types";
import { useReservedArea } from "@/state/reservedArea";
import { useRunner } from "../renderers/strategy/runner";
import { FollowNoticeNote, useFollowNotices } from "./FollowNotices";
import { pressOutcome } from "./pressOutcome";
import classes from "./OutcomeToast.module.css";

/** How long after my press the bot's reply still counts as its outcome. */
const REPLY_WINDOW_MS = 20_000;
const SHOW_MS = 6_000;
/** How long the bot gets to report a press in the game log before the button's own wording stands in. */
const LOCAL_MS = 900;

type Note = { key: string; text: string; fromLog: boolean };

const SECOND_PERSON: Record<string, string> = { is: "are", was: "were", has: "have", does: "do" };

/** The log's third-person line as said after "You": "is producing in 313" → "are producing in 313". */
function asYou(text: string) {
  return text.replace(/^(is|was|has|does)\b/i, (w) => SECOND_PERSON[w.toLowerCase()] ?? w);
}

/** "You researched Gravity Drive": the game log's own wording for an event of mine. */
function outcomeText(events: GameEvent[]) {
  return events.map((e) => segText(e.summary).trim()).filter(Boolean).slice(-2).map(asYou).join(" · ");
}

/**
 * What my last press did, in plain words, for a few seconds. Every press gets a note: the game-log events the bot
 * posted for my faction right after it (gained trade goods, readied planets, explored, scored…) when they arrive
 * quickly, else the pressed button's own words ("Kept Strengthen Bonds", "Passed", "Not following Technology"),
 * replaced by the bot's wording if that comes later. A multi-press flow gets one note, for its last press. Above them,
 * strategy cards the bot declined for me without asking (no strategy tokens), until dismissed.
 */
export function OutcomeToast({ gameName, faction, rightInset, web }: { gameName: string; faction?: string; rightInset: number; web?: PlayerDataResponse }) {
  const follow = useFollowNotices(gameName, web);
  const press = usePlay((s) => s.lastPress);
  const flowRunning = useRunner((s) => !!s.running);
  const flowSummary = useRunner((s) => s.summary);
  const { events } = useGameEvents(gameName);
  const reply = useMemo(() => {
    if (!faction || !press) return undefined;
    const mine = events.filter((e) => {
      const at = Date.parse(e.time);
      return at >= press.at - 1000 && at <= press.at + REPLY_WINDOW_MS && e.actor?.faction === faction && e.importance >= 2;
    });
    return mine.length ? outcomeText(mine) : undefined;
  }, [events, faction, press]);
  const local = useMemo(() => (press?.customId ? pressOutcome(press.message, press.customId, press.values) : undefined), [press]);

  /* The press whose wait for the bot's wording is over. */
  const [due, setDue] = useState<number | null>(null);
  useEffect(() => {
    if (!press) return;
    const t = window.setTimeout(() => setDue(press.at), LOCAL_MS);
    return () => window.clearTimeout(t);
  }, [press]);

  const note: Note | undefined = useMemo(() => {
    if (!press) return undefined;
    const key = `press-${press.at}`;
    if (reply) return { key, text: reply, fromLog: true };
    /* A flow (several presses from one panel) says what it did as a whole, in place of its last button's words. */
    const summary = flowSummary && flowSummary.at >= press.at - 1000 && flowSummary.at - press.at < REPLY_WINDOW_MS ? flowSummary.text : undefined;
    const text = summary ?? local;
    if (due !== press.at || flowRunning || !text) return undefined;
    return { key, text, fromLog: false };
  }, [press, reply, due, flowRunning, local, flowSummary]);

  /* The last few notes, newest last; each leaves after a few seconds. */
  const [shown, setShown] = useState<Note[]>([]);
  const timers = useRef(new Map<string, number>());
  useEffect(() => {
    const live = timers.current;
    return () => live.forEach((t) => window.clearTimeout(t));
  }, []);
  useEffect(() => {
    if (!note) return;
    setShown((list) => {
      const same = list.find((x) => x.key === note.key);
      if (same && same.text === note.text) return list;
      return [...list.filter((x) => x.key !== note.key), note].slice(-3);
    });
    /* Each note leaves on its own clock, restarted when the bot's wording replaces the button's. */
    window.clearTimeout(timers.current.get(note.key));
    timers.current.set(
      note.key,
      window.setTimeout(() => {
        timers.current.delete(note.key);
        setShown((list) => list.filter((x) => x.key !== note.key));
      }, SHOW_MS),
    );
  }, [note]);

  /* Under the decision card when it is up (inside its column), else top-right under the top bar: never over tiles. */
  const card = useReservedArea((s) => s.rects["decision-card"]);
  if ((!shown.length && !follow.notices.length) || typeof document === "undefined") return null;
  const style = (
    card
      ? { top: `${card.bottom + 8}px`, right: `${window.innerWidth - card.right}px`, width: `${card.right - card.left}px` }
      : { top: "100px", right: `${12 + rightInset}px` }
  ) as CSSProperties;
  return createPortal(
    <div className={`ti4play ${classes.stack}`} style={style} role="status" aria-live="polite">
      {follow.notices.map((n) => (
        <FollowNoticeNote key={n.id} notice={n} onDismiss={() => follow.dismiss(n.id)} />
      ))}
      {shown.map((o) => (
        <div key={`${o.key}:${o.text}`} className={classes.toast}>
          {o.fromLog ? (
            <>
              <span className={classes.you}>You</span> {o.text}
            </>
          ) : (
            o.text
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
