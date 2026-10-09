import { useEffect, useMemo } from "react";
import {
  usePlay,
  usePlayConnection,
  type Component,
  type Message,
  type PlayState,
} from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { findGame, type GameChannels } from "@/play/games";

/** One bot prompt that is waiting on me. */
export type AttentionItem = {
  message: Message;
  channelId: string;
  /** Where it lives, for the tray's label ("Actions", "Your hand", a thread name). */
  where: string;
  /** Why we think it is mine. */
  reason: "ephemeral" | "reply" | "mention" | "role" | "follow-up";
};

/** Buttons that ride along on most bot posts and never need an answer. */
const TRIVIAL =
  /^(undo|delete( these)?( buttons?)?|dismiss|done|refresh|show draft again|.*\binfo)$/i;

/** Labels of the enabled, non-link controls in a message (buttons and selects, V1 or V2 layouts). */
function actionableControls(components: Component[] | undefined): string[] {
  const out: string[] = [];
  const walk = (list: Component[] | undefined) => {
    for (const c of list ?? []) {
      if (c.type === 2 && !c.disabled && c.style !== 5 && c.style !== 6) {
        out.push(c.label ?? c.emoji?.name ?? "");
      } else if ([3, 5, 6, 7, 8].includes(c.type) && !c.disabled) {
        out.push(c.placeholder ?? "select");
      }
      walk(c.components);
      if (c.accessory) walk([c.accessory]);
      if (c.component) walk([c.component]);
    }
  };
  walk(components);
  return out;
}

export function needsAnswer(m: Message): boolean {
  return actionableControls(m.components).some((l) => !TRIVIAL.test(l.trim()));
}

/** How many of the newest messages of a channel a role-wide prompt stays relevant for. */
const ROLE_WINDOW = 40;
/** Messages the bot posts right after pinging me belong to the same prompt. */
const FOLLOW_UP_MS = 5000;

function channelLabel(game: GameChannels, id: string, state: PlayState) {
  if (id === game.actions.id) return "Actions";
  if (id === game.hand?.id) return "Your hand";
  if (id === game.tableTalk?.id) return "Table talk";
  const name = state.channels[id]?.name ?? "Thread";
  return name.startsWith(`${game.name}-`) ? name.slice(game.name.length + 1) : name;
}

/**
 * The prompts in one channel that wait on me, oldest first.
 *
 * A prompt is answered once I press something on it (unless the bot then edits it into the next step).
 * It goes stale when the bot moves on: a newer prompt with buttons addressed to another player in the
 * same channel (the turn passed), or, for pings and their follow-ups, a newer ping to me.
 */
function scanChannel(
  state: PlayState,
  channelId: string,
  where: string,
): AttentionItem[] {
  const me = state.me;
  const data = state.messages[channelId];
  if (!me || !data?.ids.length) return [];
  const myRoles = new Set(state.users[me.id]?.roles ?? []);
  const mentionsMe = (m: Message) =>
    !!m.mentions?.some((u) => u.id === me.id) ||
    m.content.includes(`<@${me.id}>`);
  const mentionsOther = (m: Message) =>
    !!m.mentions?.some((u) => u.id !== me.id && !u.bot) && !mentionsMe(m);

  const ids = data.ids;
  let newestMention: string | null = null;
  let newestOtherPrompt: string | null = null;
  for (let i = ids.length - 1; i >= 0; i--) {
    const m = data.byId[ids[i]];
    if (!newestMention && mentionsMe(m)) newestMention = ids[i];
    if (!newestOtherPrompt && mentionsOther(m) && needsAnswer(m))
      newestOtherPrompt = ids[i];
    if (newestMention && newestOtherPrompt) break;
  }
  const after = (id: string, mark: string | null) =>
    !mark || compareSnowflakes(id, mark) >= 0;

  const items: AttentionItem[] = [];
  let pingAt = -Infinity;
  let otherPingAt = -Infinity;
  ids.forEach((id, index) => {
    const m = data.byId[id];
    if (!m) return;
    const at = Date.parse(m.timestamp);
    const ping = mentionsMe(m);
    const pingsOther = mentionsOther(m);
    if (ping) {
      pingAt = at;
      otherPingAt = -Infinity;
    } else if (pingsOther) {
      pingAt = -Infinity;
      otherPingAt = at;
    }
    /* "<@other>, it is now your turn" + "Use buttons to do your turn": the buttons are theirs. */
    const forOther = pingsOther || (!ping && at - otherPingAt <= FOLLOW_UP_MS);
    if (!m.author.bot || state.dismissedPrompts[id] || !needsAnswer(m)) return;
    const pressedAt = state.pressed[id];
    const editedSincePress =
      !!m.edited_timestamp && Date.parse(m.edited_timestamp) > pressedAt;
    if (pressedAt !== undefined && !editedSincePress) return;

    const role =
      index >= ids.length - ROLE_WINDOW &&
      (m.mention_roles ?? []).some((r) => myRoles.has(r));
    let reason: AttentionItem["reason"] | null = null;
    if (m.ephemeral) reason = "ephemeral";
    else if (
      !forOther &&
      (m.interaction_metadata?.user?.id === me.id ||
        m.prompted_user_id === me.id)
    )
      reason = "reply";
    else if (ping) reason = id === newestMention ? "mention" : null;
    else if (at - pingAt <= FOLLOW_UP_MS)
      reason = after(id, newestMention) ? "follow-up" : null;
    else if (role) reason = "role";
    if (!reason) return;
    if (reason !== "role" && !after(id, newestOtherPrompt)) return;
    items.push({ message: m, channelId, where, reason });
  });
  return items;
}

/** Channels of a game worth scanning: actions, my hand, table talk, and the newest threads. */
function scanTargets(game: GameChannels) {
  return [
    game.actions.id,
    game.hand?.id,
    game.tableTalk?.id,
    ...game.threads
      .filter((t) => t.id !== game.mapUpdates?.id)
      .slice(0, 8)
      .map((t) => t.id),
  ].filter((id): id is string => !!id);
}

/**
 * Everything in this game that waits on me: prompts the bot addressed to me
 * (pings, replies to my clicks, "only you can see this" messages, role-wide
 * calls like strategy-card follows) that I have not answered or dismissed.
 * Loads the history of the game's channels so it also works after a reload.
 */
/** Sorted so the most pressing prompt (an only-you reply, then the action log) comes last. */
export function useAttention(gameName: string): AttentionItem[] {
  const conn = usePlayConnection();
  const status = usePlay((s) => s.status);
  const channels = usePlay((s) => s.channels);
  const game = findGame(channels, gameName);
  const targets = useMemo(() => (game ? scanTargets(game) : []), [game]);
  const targetKey = targets.join(",");

  useEffect(() => {
    if (status !== "open") return;
    for (const id of targetKey.split(",").filter(Boolean)) {
      if (!conn.store.getState().messages[id]?.loaded) conn.loadHistory(id);
    }
  }, [targetKey, status, conn]);

  const messages = usePlay((s) => s.messages);
  const interacted = usePlay((s) => s.interacted);
  const dismissed = usePlay((s) => s.dismissedPrompts);
  const pressed = usePlay((s) => s.pressed);
  const me = usePlay((s) => s.me);

  return useMemo(() => {
    if (!game || !me) return [];
    const state = conn.store.getState();
    const rank = (it: AttentionItem) => {
      if (it.reason === "ephemeral" || it.reason === "reply") return 2;
      return it.channelId === game.actions.id ? 1 : 0;
    };
    return targets
      .flatMap((id) => scanChannel(state, id, channelLabel(game, id, state)))
      .sort(
        (a, b) =>
          rank(a) - rank(b) || compareSnowflakes(a.message.id, b.message.id),
      );
    // The store slices below are what scanChannel reads.
  }, [game, me, targets, messages, interacted, dismissed, pressed, conn]);
}
