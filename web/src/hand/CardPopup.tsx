import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Markdown, usePlay } from "@/discord";
import { usePressButton } from "@/play/usePressButton";
import { getFactionImage } from "@/entities/lookup/factions";
import type { PlayerData } from "@/entities/data/types";
import { CardFace } from "./CardFace";
import type { HandCard, Timing } from "./model";
import type { CardAction, ActionOutcome } from "./useHandActions";
import { followUps, messageButtons } from "./botThread";
import classes from "./HandTray.module.css";

type Props = {
  card: HandCard;
  number?: number;
  timing: Timing;
  actions: CardAction[];
  players: PlayerData[];
  myColor?: string;
  threadId?: string;
  run: (action: CardAction, target?: string) => Promise<ActionOutcome>;
  onClose: () => void;
};

type Status = { kind: "busy" | "ok" | "error"; text: string } | null;

const DONE_TEXT: Record<string, string> = {
  play: "Played. The bot is resolving it — answer any prompt it shows.",
  score: "Scored. The bot announces it to the table.",
  discard: "Discarded.",
  show: "Shown.",
  sync: "Asked the bot to refresh your hand.",
};

function timingLine(card: HandCard, timing: Timing, hasPlay: boolean): string {
  if (card.scored) return `Scored — worth ${card.vp ?? 1} VP.`;
  if (card.inPlayArea) return "Face up in your play area.";
  if (card.kind === "pn" && !hasPlay)
    return card.owner ? "Give it to another player in a trade, or hold it." : "Held in your hand.";
  if (card.kind === "relic" || card.kind === "fragment")
    return "The bot offers relic actions on your turn when they apply.";
  if (timing === "now") return "Its timing window is open right now.";
  if (card.kind === "so") return `Score it during the ${card.window?.toLowerCase() ?? "matching phase"} once you meet it.`;
  if (timing === "later") return "Not its moment yet — play it when the window comes up.";
  return "A reaction: play it when that happens.";
}

/** The focused view of one card: big face, its timing, and what the bot lets you do with it. */
export function CardPopup({ card, number, timing, actions, players, myColor, threadId, run, onClose }: Props) {
  const [status, setStatus] = useState<Status>(null);
  const [picking, setPicking] = useState<CardAction | null>(null);
  const [baseline, setBaseline] = useState<string | undefined>();
  const thread = usePlay((s) => (threadId ? s.messages[threadId] : undefined));
  const asks = followUps(thread, baseline);
  const press = usePressButton();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const perform = async (action: CardAction, target?: string) => {
    if (action.id === "show" && target === undefined && !picking) {
      setPicking(action);
      return;
    }
    setPicking(null);
    setStatus({ kind: "busy", text: `${action.label.replace("…", "")}…` });
    const result = await run(action, target);
    setBaseline(result.baseline);
    if (result.error) setStatus({ kind: "error", text: result.error });
    else setStatus({ kind: "ok", text: DONE_TEXT[action.id] ?? "Done." });
  };

  const others = players.filter((p) => p.color !== myColor);
  const hasPlay = actions.some((a) => a.id === "play" || a.id === "score");
  const busy = status?.kind === "busy";

  return createPortal(
    <div className={classes.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={classes.popup} role="dialog" aria-label={card.name}>
        <div className={classes.popupCard}>
          <CardFace card={card} size="large" number={number} timing={timing} actionable={hasPlay} />
        </div>
        <div className={classes.popupSide}>
          <button className={classes.close} onClick={onClose} aria-label="Close">×</button>
          <div className={classes.popupType}>{card.typeLabel}</div>
          <h2 className={classes.popupName}>{card.name}</h2>
          {card.window && (
            <div className={classes.popupWindow}>
              <span className={classes.popupWindowLabel}>When</span>
              {card.window}
            </div>
          )}
          <p className={`${classes.popupTiming} ${timing === "now" && hasPlay ? classes.popupTimingNow : ""}`}>
            {timingLine(card, timing, hasPlay)}
          </p>

          {actions.length > 0 && (
            <div className={classes.actions}>
              {actions.map((action) => (
                <button
                  key={action.id}
                  className={`${classes.action} ${classes[`tone_${action.tone}`]}`}
                  disabled={busy}
                  title={action.hint}
                  onClick={() => void perform(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {picking && (
            <div className={classes.picker}>
              <div className={classes.pickerLabel}>Show this card to</div>
              <div className={classes.pickerRow}>
                {others.map((p) => (
                  <button key={p.color} className={classes.seat} onClick={() => void perform(picking, p.faction)}>
                    <img src={getFactionImage(p.faction)} alt="" />
                    {p.userName}
                  </button>
                ))}
                <button className={classes.seat} onClick={() => void perform(picking, "")}>Everyone</button>
              </div>
            </div>
          )}

          {status && (
            <div className={`${classes.status} ${classes[`status_${status.kind}`]}`}>{status.text}</div>
          )}

          {asks.length > 0 && (
            <div className={classes.asks}>
              <div className={classes.pickerLabel}>The bot asks</div>
              {asks.map((message) => (
                <div key={message.id} className={classes.ask}>
                  {message.content && <Markdown content={message.content} className={classes.askText} />}
                  <div className={classes.pickerRow}>
                    {messageButtons(message).map((b) => (
                      <button
                        key={b.custom_id}
                        className={classes.seat}
                        onClick={() => void press(message.channel_id, message.id, b.custom_id!)}
                      >
                        {b.label || b.custom_id}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
