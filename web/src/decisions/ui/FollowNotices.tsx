import { useMemo, useState } from "react";
import { UnstyledButton } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { usePlay, type Message } from "@/discord";
import type { ChannelMessages } from "@/discord/client/store";
import { readStored, writeStored } from "@/discord/client/lastRead";
import { compareSnowflakes, snowflakeTime } from "@/discord/shared/snowflake";
import type { PlayerDataResponse } from "@/entities/data/types";
import { findGame } from "../../prompts/games";
import { CARDS } from "../renderers/strategy/cards";
import classes from "./OutcomeToast.module.css";

/** Older auto-declines are history, not news. */
const FRESH_MS = 2 * 60 * 60_000;
const DISMISSED = "followNoticesDismissed";

/** "You were automatically marked as not following **Technology**, because the bot believes you can't follow due to …" */
const AUTO_DECLINE = /automatically marked as not following \*\*([^*]+)\*\*,?\s*because\s+(.+?)\.?\s*$/i;
/** The action log lines that end the action phase it was posted in. */
const PHASE_OVER = /^(All players have passed\b|Started Round \d+)/i;

export type FollowNotice = { id: string; text: string };

/** Why the bot declined for me, in the panel's words. */
function reasonText(reason: string) {
  if (/lack of command tokens in your strategy pool/i.test(reason)) return "you had no strategy tokens to follow";
  if (/space dock in your home system/i.test(reason)) return "you had no space dock in your home system to follow";
  if (/wished to pass/i.test(reason)) return "you chose earlier to pass on it";
  return reason.replace(/^the bot (believes|does not believe) /i, "").trim();
}

/** Each notice's words, fixed the first time they are worked out: later rounds' card holders never rewrite them. */
const frozen = new Map<string, string>();

/** The newest "<card> played by <player>" before the notice, for the card of that initiative: who played it then. */
function playedBy(actions: ChannelMessages | undefined, noticeId: string, initiative: number | undefined) {
  if (!actions || initiative === undefined) return undefined;
  const ids = actions.ids.filter((id) => compareSnowflakes(id, noticeId) < 0);
  for (let i = ids.length - 1; i >= 0; i--) {
    const m: Message | undefined = actions.byId[ids[i]];
    if (!m?.author.bot || !/\bplayed by\b/i.test(m.content) || !m.content.includes(`:sc_${initiative}_`)) continue;
    const who = m.mentions?.[0];
    return who?.global_name ?? who?.username;
  }
  return undefined;
}

function noticeText(m: Message, card: string, reason: string, actions: ChannelMessages | undefined, web?: PlayerDataResponse) {
  const initiative =
    web?.strategyCards?.find((c) => c.name.toLowerCase() === card.toLowerCase())?.initiative ??
    Object.values(CARDS).find((c) => c.name.toLowerCase() === card.toLowerCase())?.initiative;
  const holder = playedBy(actions, m.id, initiative);
  return `${holder ? `${holder} played ${card}` : `${card} was played`} — ${reasonText(reason)}.`;
}

/** Whether the action phase the notice was posted in is over (a newer phase or round marker in the action log). */
function phaseOver(actions: ChannelMessages | undefined, noticeId: string) {
  if (!actions) return false;
  return actions.ids.some((id) => compareSnowflakes(id, noticeId) > 0 && !!actions.byId[id]?.author.bot && PHASE_OVER.test(actions.byId[id]?.content ?? ""));
}

/**
 * Strategy cards the bot declined to let me follow without asking (no strategy tokens, no home space dock, …): it
 * only says so in my hand thread, so the follow would otherwise pass silently. Their words come from the bot's line
 * and the card's play at the time; they last until dismissed or until that action phase ends.
 */
export function useFollowNotices(gameName: string, web?: PlayerDataResponse) {
  const channels = usePlay((s) => s.channels);
  const game = useMemo(() => findGame(channels, gameName), [channels, gameName]);
  const handId = game?.hand?.id;
  const actionsId = game?.actions.id;
  const hand = usePlay((s) => (handId ? s.messages[handId] : undefined));
  const actions = usePlay((s) => (actionsId ? s.messages[actionsId] : undefined));
  const [dismissed, setDismissed] = useState(() => new Set(Object.keys(readStored<true>(DISMISSED))));
  const phase = web?.gameState?.phase?.split(".")[0];

  const notices = useMemo<FollowNotice[]>(() => {
    if (!hand) return [];
    /* Only news while the action phase it happened in goes on. */
    if (phase && phase !== "action") return [];
    const now = Date.now();
    const out: FollowNotice[] = [];
    for (const id of hand.ids) {
      const m = hand.byId[id];
      const hit = m?.author.bot ? m.content.match(AUTO_DECLINE) : null;
      if (!hit || dismissed.has(id) || now - snowflakeTime(id) > FRESH_MS || phaseOver(actions, id)) continue;
      let text = frozen.get(id);
      if (!text) {
        text = noticeText(m, hit[1].trim(), hit[2], actions, web);
        if (actions?.loaded) frozen.set(id, text);
      }
      out.push({ id, text });
    }
    return out;
  }, [hand, actions, dismissed, web, phase]);

  const dismiss = (id: string) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    const keep = [...next].sort(compareSnowflakes).slice(-50);
    writeStored(DISMISSED, Object.fromEntries(keep.map((k) => [k, true])));
  };
  return { notices, dismiss };
}

/** One follow I was not offered, with why; it stays until dismissed or the action phase ends. */
export function FollowNoticeNote({ notice, onDismiss }: { notice: FollowNotice; onDismiss: () => void }) {
  return (
    <div className={classes.notice}>
      <span className={classes.noticeText}>{notice.text}</span>
      <UnstyledButton className={classes.noticeClose} onClick={onDismiss} aria-label="Dismiss">
        <IconX size={13} />
      </UnstyledButton>
    </div>
  );
}
