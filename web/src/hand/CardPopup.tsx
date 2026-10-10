import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Markdown, useChannelMessages } from "@/discord";
import type { Component, Message } from "@/discord";
import { usePendingKey } from "@/discord/client/hooks";
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
  /** Action cards over the hand limit. */
  overBy?: number;
};

type Sent = { action: CardAction; baseline?: string; error?: string; busy: boolean };

const DONE_TEXT: Record<string, string> = {
  play: "Played.",
  score: "Scored.",
  discard: "Discarded.",
  show: "Shown.",
  sync: "Asked the bot to refresh your hand.",
};

function timingLine(card: HandCard, timing: Timing, hasPlay: boolean, overBy: number): string {
  if (timing === "blocked")
    return `Over your action card hand limit — discard ${overBy} first; the bot refuses action cards until then.`;
  if (card.scored) return `Scored — worth ${card.vp ?? 1} VP.`;
  if (card.inPlayArea) return "Face up in your play area.";
  if (card.kind === "pn" && !hasPlay)
    return card.owner ? "Give it to another player in a trade, or hold it." : "Held in your hand.";
  if (card.kind === "relic" || card.kind === "fragment")
    return "The bot offers relic actions on your turn when they apply.";
  if (timing === "now" && card.kind === "so") return "Scoring is open now — score it if you meet it.";
  if (timing === "now") return "Its timing window is open right now.";
  if (card.kind === "so")
    return `Score it in the ${card.window?.toLowerCase() ?? "matching phase"} once you meet it.`;
  if (timing === "later") return "Not its moment yet — play it when its window comes up.";
  return "A reaction: play it when that happens.";
}

/** The focused view of one card: big face, its timing, and what the bot lets you do with it. */
export function CardPopup(props: Props) {
  const { card, number, timing, actions, players, myColor, threadId, actionsId, meId, run, onClose, gone, overBy = 0 } = props;
  const [sent, setSent] = useState<Sent | null>(null);
  const [picking, setPicking] = useState<CardAction | null>(null);
  const thread = useChannelMessages(threadId);
  const actionsChannel = useChannelMessages(actionsId);
  // The card's own answers come first; later table chatter (the next window opening) is not this card's business.
  const replies = botReplies(thread, actionsChannel, sent?.baseline, meId)
    .filter((m) => cleanReply(m.content ?? "") || replyButtons(m, meId, threadId).length > 0)
    .slice(0, 8);
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
            {gone ? "This card has left your hand." : timingLine(card, timing, hasPlay, overBy)}
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
                  {cleanReply(message.content ?? "") && <Markdown content={cleanReply(message.content ?? "")} className={classes.askText} />}
                  {replyButtons(message, meId, threadId).length > 0 && (
                    <div className={classes.pickerRow}>
                      {replyButtons(message, meId, threadId).map((b) => (
                        <ReplyButton
                          key={b.custom_id}
                          label={b.label || b.custom_id!}
                          pendingKey={`${message.id}:${b.custom_id}`}
                          onPress={() => void press(message.channel_id, message.id, b.custom_id!)}
                        />
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

/** Undo lives in the top bar; others' reactions are theirs; "Delete These Buttons" is Discord housekeeping. */
/**
 * Bot replies minus Discord-only noise: role pings, "use buttons…" hints and pointers to channels that do not
 * exist here.
 */
function cleanReply(content: string): string {
  return content
    .replace(/<@&\d+>\s*,?\s*/g, "")
    .replace(/\s*Check your `?#?cards-info`? thread for the blue discard buttons\.?/gi, " Use Discard on the cards in your hand.")
    .replace(/^Use buttons to end turn or do another action\.?$/gim, "")
    .trim();
}

const NOT_FOR_ME = /^(ultimateUndo|sabotage_|no_sabotage|deleteButtons)/;

/** Buttons of a reply that are mine to press: in my private cards thread or on posts that name me. */
function replyButtons(message: Message, meId: string | undefined, threadId: string | undefined): Component[] {
  const addressed =
    message.ephemeral || message.channel_id === threadId || (!!meId && (message.content ?? "").includes(`<@${meId}>`));
  if (!addressed) return [];
  return messageButtons(message).filter((b) => !NOT_FOR_ME.test(b.custom_id ?? ""));
}

function ReplyButton({ label, pendingKey, onPress }: { label: string; pendingKey: string; onPress: () => void }) {
  const pending = usePendingKey(pendingKey);
  return (
    <button className={classes.seat} disabled={pending} onClick={onPress}>
      {pending ? "…" : label}
    </button>
  );
}

function statusOf(sent: Sent | null, refused: boolean, replyCount: number) {
  if (!sent) return null;
  if (sent.busy) return { kind: "busy", text: `${sent.action.label.replace("…", "")}…` };
  if (sent.error) return { kind: "error", text: sent.error };
  if (refused) return { kind: "error", text: "The bot did not allow it — see its reply below." };
  // A show answers privately to the other player; the command's own acknowledgement is the outcome.
  if (sent.action.id === "show") return { kind: "ok", text: DONE_TEXT.show };
  if (replyCount === 0) return { kind: "busy", text: "Sent. Waiting for the bot…" };
  return { kind: "ok", text: DONE_TEXT[sent.action.id] ?? "Done." };
}
