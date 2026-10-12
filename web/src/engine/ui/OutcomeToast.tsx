import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { UnstyledButton } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useGameEvents } from "@/gamelog";
import type { GameEvent } from "@/gamelog/types";
import { segText } from "@/gamelog/parse/markup";
import { buttonOutcome } from "@/decisions/model/phrasing";
import { useBoardCover } from "@/state/boardCover";
import { useReservedArea } from "@/state/reservedArea";
import type { GameState } from "../contract";
import { useEngine, type LastAnswer } from "../store";
import { decisionTitle } from "../queue";
import classes from "./OutcomeToast.module.css";

/** How long after my answer the game log's lines for my faction still count as its outcome. */
const REPLY_WINDOW_MS = 20_000;
const SHOW_MS = 6_000;
/** How long the game log gets to report an answer before the option's own words stand in. */
const LOCAL_MS = 900;

type Note = { key: string; text: string; fromLog: boolean };

const SECOND_PERSON: Record<string, string> = { is: "are", was: "were", has: "have", does: "do" };

function asYou(text: string) {
  return text.replace(/^(is|was|has|does)\b/i, (w) => SECOND_PERSON[w.toLowerCase()] ?? w);
}

function outcomeText(events: GameEvent[]) {
  return events.map((e) => segText(e.summary).trim()).filter(Boolean).slice(-2).map(asYou).join(" · ");
}

/** What my answer did, from the decision's typed option (its value first, then the engine's label). */
export function answerOutcome(a: LastAnswer, state: GameState | null): string | undefined {
  const d = a.decision;
  const option = a.optionId ? d.options.find((o) => o.id === a.optionId) : undefined;
  const value = (option?.value ?? null) as Record<string, unknown> | null;
  if (d.kind === "strategy_card.pick" && typeof value?.strategyCard === "number") {
    const name = state?.strategyCards.find((c) => c.number === value.strategyCard)?.name ?? `card ${value.strategyCard}`;
    return `Picked ${name}`;
  }
  if (d.kind === "strategy_card.resolve" && value && typeof value.name === "string") {
    if (value.action === "follow") return `Following ${value.name}`;
    if (value.action === "decline") return `Not following ${value.name}`;
  }
  if (!option) return a.optionId === "submit" || !a.optionId ? `${decisionTitle(d, state)}: sent` : undefined;
  if (option.needsInput) return undefined;
  const hash = option.id.indexOf("#");
  const handler = hash > 0 ? option.id.slice(0, hash) : option.handler;
  return buttonOutcome(handler ?? "", option.label ?? "", d.prompt);
}

/** Strategy cards the game declined for me without asking (no strategy token, no home space dock…). */
function useAutoDeclines(state: GameState | null) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const me = state?.players.find((p) => p.self)?.faction;
  const notices = useMemo(() => {
    if (!state || !me) return [];
    return state.strategyCards.flatMap((card) => {
      const r = card.reactions.find((x) => x.faction === me);
      if (!r || r.status !== "declined" || !r.cantFollowReason) return [];
      const why =
        r.cantFollowReason === "no_strategy_token"
          ? "you had no strategy tokens"
          : r.cantFollowReason === "no_home_space_dock"
            ? "you have no space dock in your home system"
            : "you have scored all your secret objectives";
      return [{ id: `${state.round}:${card.number}`, text: `Not following ${card.name}: ${why}.` }];
    });
  }, [state, me]);
  return { notices: notices.filter((n) => !dismissed.includes(n.id)), dismiss: (id: string) => setDismissed((l) => [...l, id]) };
}

/**
 * What my last engine answer did, in plain words, for a few seconds: the game log's lines for my faction right
 * after it when they come quickly, else the answered option's own words. Above them, strategy cards the game
 * declined for me without asking, until dismissed. Under the decision card when it is up, never over tiles.
 */
export function EngineOutcomeToast({ gameName, rightInset }: { gameName: string; rightInset: number }) {
  const state = useEngine((s) => s.view.state);
  const errors = useEngine((s) => s.view.errors);
  const answer = useEngine((s) => s.lastAnswer);
  const follow = useAutoDeclines(state);
  const faction = state?.players.find((p) => p.self)?.faction;
  const { events } = useGameEvents(gameName);
  const reply = useMemo(() => {
    if (!faction || !answer) return undefined;
    const mine = events.filter((e) => {
      const at = Date.parse(e.time);
      return at >= answer.at - 1000 && at <= answer.at + REPLY_WINDOW_MS && e.actor?.faction === faction && e.importance >= 2;
    });
    return mine.length ? outcomeText(mine) : undefined;
  }, [events, faction, answer]);
  const local = useMemo(() => (answer ? answerOutcome(answer, state) : undefined), [answer, state]);

  const [due, setDue] = useState<number | null>(null);
  useEffect(() => {
    if (!answer) return;
    const t = window.setTimeout(() => setDue(answer.at), LOCAL_MS);
    return () => window.clearTimeout(t);
  }, [answer]);

  const failed = !!answer && !!errors[answer.decision.id];
  /* Only say what happened once the engine accepted it (a refused answer shows its error on the card instead). */
  const inFlight = useEngine((s) => !!answer && !!s.view.pending[answer.decision.id]);
  const note: Note | undefined = useMemo(() => {
    if (!answer || failed || inFlight) return undefined;
    const key = `answer-${answer.at}`;
    if (reply) return { key, text: reply, fromLog: true };
    if (due !== answer.at || !local) return undefined;
    return { key, text: local, fromLog: false };
  }, [answer, failed, inFlight, reply, due, local]);

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
    window.clearTimeout(timers.current.get(note.key));
    timers.current.set(
      note.key,
      window.setTimeout(() => {
        timers.current.delete(note.key);
        setShown((list) => list.filter((x) => x.key !== note.key));
      }, SHOW_MS),
    );
  }, [note]);

  const card = useReservedArea((s) => s.rects["decision-card"]);
  const covered = useBoardCover((s) => s.open > 0);
  if ((!shown.length && !follow.notices.length) || typeof document === "undefined") return null;
  const style = (
    card
      ? { top: `${card.bottom + 8}px`, right: `${window.innerWidth - card.right}px`, width: `${card.right - card.left}px` }
      : { top: "100px", right: `${12 + rightInset}px` }
  ) as CSSProperties;
  return createPortal(
    <div className={`ti4play ${classes.stack} ${covered ? classes.covered : ""}`} style={style} role="status" aria-live="polite" data-engine-toast>
      {follow.notices.map((n) => (
        <div key={n.id} className={classes.notice}>
          <span className={classes.noticeText}>{n.text}</span>
          <UnstyledButton className={classes.noticeClose} onClick={() => follow.dismiss(n.id)} aria-label="Dismiss">
            <IconX size={12} />
          </UnstyledButton>
        </div>
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
