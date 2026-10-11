import { useMemo, useState } from "react";
import { UnstyledButton } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { usePlay } from "@/discord";
import { readStored, writeStored } from "@/discord/client/lastRead";
import { compareSnowflakes, snowflakeTime } from "@/discord/shared/snowflake";
import type { PlayerDataResponse } from "@/entities/data/types";
import { findGame } from "../detect/games";
import classes from "./OutcomeToast.module.css";

/** Older auto-declines are history, not news. */
const FRESH_MS = 2 * 60 * 60_000;
const DISMISSED = "followNoticesDismissed";

/** "You were automatically marked as not following **Technology**, because the bot believes you can't follow due to …" */
const AUTO_DECLINE = /automatically marked as not following \*\*([^*]+)\*\*,?\s*because\s+(.+?)\.?\s*$/i;

export type FollowNotice = { id: string; text: string };

/** Why the bot declined for me, in the panel's words. */
function reasonText(reason: string) {
  if (/lack of command tokens in your strategy pool/i.test(reason)) return "you have no strategy tokens to follow";
  if (/space dock in your home system/i.test(reason)) return "you have no space dock in your home system to follow";
  if (/wished to pass/i.test(reason)) return "you chose earlier to pass on it";
  return reason.replace(/^the bot (believes|does not believe) /i, "").trim();
}

/**
 * Strategy cards the bot declined to let me follow without asking (no strategy tokens, no home space dock, …): it
 * only says so in my hand thread, so the follow would otherwise pass silently. Recent ones, until dismissed.
 */
export function useFollowNotices(gameName: string, web?: PlayerDataResponse) {
  const channels = usePlay((s) => s.channels);
  const handId = useMemo(() => findGame(channels, gameName)?.hand?.id, [channels, gameName]);
  const hand = usePlay((s) => (handId ? s.messages[handId] : undefined));
  const [dismissed, setDismissed] = useState(() => new Set(Object.keys(readStored<true>(DISMISSED))));

  const notices = useMemo<FollowNotice[]>(() => {
    if (!hand) return [];
    const now = Date.now();
    const out: FollowNotice[] = [];
    for (const id of hand.ids) {
      const m = hand.byId[id];
      const hit = m?.author.bot ? m.content.match(AUTO_DECLINE) : null;
      if (!hit || dismissed.has(id) || now - snowflakeTime(id) > FRESH_MS) continue;
      const card = hit[1].trim();
      const sc = web?.strategyCards?.find((c) => c.name.toLowerCase() === card.toLowerCase());
      const holder = web?.playerData.find((p) => !!sc && (p.scs ?? []).includes(sc.initiative));
      out.push({ id, text: `${holder ? `${holder.userName} played ${card}` : `${card} was played`} — ${reasonText(hit[2])}.` });
    }
    return out;
  }, [hand, dismissed, web]);

  const dismiss = (id: string) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    const keep = [...next].sort(compareSnowflakes).slice(-50);
    writeStored(DISMISSED, Object.fromEntries(keep.map((k) => [k, true])));
  };
  return { notices, dismiss };
}

/** One follow I was not offered, with why; it stays until dismissed. */
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
