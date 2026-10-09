import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Markdown, useChannelMessages } from "@/discord";
import { usePressButton } from "@/play/usePressButton";
import { getFactionImage } from "@/entities/lookup/factions";
import type { PlayerData } from "@/entities/data/types";
import { CardFace } from "./CardFace";
import type { HandCard, Timing } from "./model";
import type { CardAction, ActionOutcome } from "./useHandActions";
import { botReplies, isRefusal, messageButtons } from "./botThread";
import classes from "./HandTray.module.css";

type Props = {
  card: HandCard;
  number?: number;
  timing: Timing;
  actions: CardAction[];
  players: PlayerData[];
  myColor?: string;
  threadId?: string;
  actionsId?: string;
  meId?: string;
  run: (action: CardAction, target?: string) => Promise<ActionOutcome>;
  onClose: () => void;
  /** The card has left the hand (played, discarded...). */
  gone?: boolean;
};

type Sent = { action: CardAction; baseline?: string; error?: string; busy: boolean };

const DONE_TEXT: Record<string, string> = {
  play: "Played.",
  score: "Scored.",
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
  if (card.kind === "so")
    return `Score it in the ${card.window?.toLowerCase() ?? "matching phase"} once you meet it.`;
  if (timing === "later") return "Not its moment yet — play it when its window comes up.";
  return "A reaction: play it when that happens.";
}

/** The focused view of one card: big face, its timing, and what the bot lets you do with it. */
export function CardPopup(props: Props) {
  const { card, number, timing, actions, players, myColor, threadId, actionsId, meId, run, onClose, gone } = props;
  const [sent, setSent] = useState<Sent | null>(null);
  const [picking, setPicking] = useState<CardAction | null>(null);
  const thread = useChannelMessages(threadId);
  const actionsChannel = useChannelMessages(actionsId);
  const replies = botReplies(thread, actionsChannel, sent?.baseline, meId);
  const refused = replies.some(isRefusal);
  const press = usePressButton();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const perform = async (action: CardAction, target?: string) => {
    if (action.id === "show" && target === undefined) {
      setPicking(action);
      return;
    }
    setPicking(null);
    setSent({ action, busy: true });
    const result = await run(action, target);
    setSent({ action, baseline: result.baseline, error: result.error, busy: false });
  };

  const others = players.filter((p) => p.color !== myColor);
  const hasPlay = actions.some((a) => a.id === "play" || a.id === "score");
  const status = statusOf(sent, refused, replies.length);

  return createPortal(
    <div className={classes.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={classes.popup} role="dialog" aria-label={card.name}>
        <div className={`${classes.popupCard} ${gone ? classes.popupCardGone : ""}`}>
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
          <p className={`${classes.popupTiming} ${timing === "now" && hasPlay && !gone ? classes.popupTimingNow : ""}`}>
            {gone ? "This card has left your hand." : timingLine(card, timing, hasPlay)}
          </p>

          {actions.length > 0 && (
            <div className={classes.actions}>
              {actions.map((action) => (
                <button
                  key={action.id}
                  className={`${classes.action} ${classes[`tone_${action.tone === "go" && timing !== "now" ? "neutral" : action.tone}`]}`}
                  disabled={sent?.busy}
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

          {status && <div className={`${classes.status} ${classes[`status_${status.kind}`]}`}>{status.text}</div>}

          {replies.length > 0 && (
            <div className={classes.asks}>
              <div className={classes.pickerLabel}>The bot</div>
              {replies.map((message) => (
                <div key={message.id} className={classes.ask}>
                  {message.content && <Markdown content={message.content} className={classes.askText} />}
                  {messageButtons(message).length > 0 && (
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
                  )}
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

function statusOf(sent: Sent | null, refused: boolean, replyCount: number) {
  if (!sent) return null;
  if (sent.busy) return { kind: "busy", text: `${sent.action.label.replace("…", "")}…` };
  if (sent.error) return { kind: "error", text: sent.error };
  if (refused) return { kind: "error", text: "The bot did not allow it — see its reply below." };
  if (replyCount === 0) return { kind: "busy", text: "Sent. Waiting for the bot…" };
  return { kind: "ok", text: DONE_TEXT[sent.action.id] ?? "Done." };
}
