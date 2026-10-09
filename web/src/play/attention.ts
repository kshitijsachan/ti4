import { useEffect, useMemo } from "react";
import {
  usePlay,
  usePlayConnection,
  type Component,
  type Message,
  type PlayState,
} from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { readStored, writeStored } from "@/discord/client/lastRead";
import { controlSignature } from "@/discord/client/store";
import { findGame, type GameChannels } from "@/play/games";

/** One bot prompt that is waiting on me. */
export type AttentionItem = {
  message: Message;
  channelId: string;
  /** Where it lives, for the tray's label ("Actions", "Your hand", a thread name). */
  where: string;
  /** Why we think it is mine. */
  reason: "ephemeral" | "reply" | "mention" | "role" | "follow-up" | "own";
  /** A table-wide call I made myself: shown once, its copies in threads are dropped. */
  ownCall?: boolean;
  /** Set on an own call I already pressed (kept only so its copies can be recognised). */
  answered?: boolean;
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

/** Controls that take a press back rather than move on ("Undo", "Un-move 1 Destroyer", "Reassign…"). */
const TAKE_BACK = /^(undo|un-|reassign|retrieve|reset)/i;

function hasForwardControl(m: Message) {
  return actionableControls(m.components).some(
    (l) => !TRIVIAL.test(l.trim()) && !TAKE_BACK.test(l.trim()),
  );
}

export function needsAnswer(m: Message): boolean {
  return hasForwardControl(m);
}

/** The custom ids of a prompt's controls. */
function customIds(it: AttentionItem) {
  const ids: string[] = [];
  const walk = (list: Component[] | undefined) => {
    for (const c of list ?? []) {
      if (c.custom_id) ids.push(c.custom_id);
      walk(c.components);
    }
  };
  walk(it.message.components);
  return ids;
}

/** The bot posts the same question again (and copies a card's buttons into its thread). */
function buttonSignature(it: AttentionItem) {
  return customIds(it).sort().join("|");
}

/**
 * Messages that called my role ("@pbd7, please score objectives"). The bot often edits such a message as
 * players answer and drops the role mention, so remember them (per browser) once seen.
 */
const rolePrompts = new Map<string, Set<string>>();

function isRolePrompt(
  meId: string,
  m: Message,
  myRoles: Set<string>,
  followsRolePing = false,
) {
  let seen = rolePrompts.get(meId);
  if (!seen) {
    seen = new Set(Object.keys(readStored<true>(`rolePrompts.${meId}`)));
    rolePrompts.set(meId, seen);
  }
  if (seen.has(m.id)) return true;
  if (!followsRolePing && !(m.mention_roles ?? []).some((r) => myRoles.has(r)))
    return false;
  seen.add(m.id);
  const keep = [...seen].sort(compareSnowflakes).slice(-200);
  writeStored(`rolePrompts.${meId}`, Object.fromEntries(keep.map((id) => [id, true])));
  return true;
}

/** How many of the newest messages of a channel a role-wide prompt stays relevant for. */
const ROLE_WINDOW = 40;
/** Messages the bot posts right after pinging me belong to the same prompt. */
const FOLLOW_UP_MS = 5000;
/** How soon after my press an edit of that message counts as the bot's answer to it. */
const EDIT_ANSWER_MS = 15000;

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
  roleCalls = true,
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
  let rolePingAt = -Infinity;
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
    if ((m.mention_roles ?? []).some((r) => myRoles.has(r))) rolePingAt = at;
    /* "@pbd7 Status Cleanup Run!" + "Resolve status homework using the buttons": everyone's buttons. */
    const roleFollowUp =
      !ping && !pingsOther && at - rolePingAt <= FOLLOW_UP_MS;
    /* "<@other>, it is now your turn" + "Use buttons to do your turn": the buttons are theirs. */
    const forOther = pingsOther || (!ping && at - otherPingAt <= FOLLOW_UP_MS);
    if (!m.author.bot || state.dismissedPrompts[id] || !needsAnswer(m)) return;
    /* The shim records my presses on every device; this browser's own record covers older messages. */
    const pressedAt = m.my_press
      ? Date.parse(m.my_press.at)
      : state.pressed[id];
    const pressedControls = m.my_press?.controls ?? state.pressedControls[id];
    const editedAt = m.edited_timestamp ? Date.parse(m.edited_timestamp) : 0;
    /* Only an edit soon after my press is the bot's answer to it; later ones come from other players. */
    /* A prompt addressed to me by name stays live while the bot keeps updating it ("gain 1 token", again);
       a table-wide one only if the edit gave it new controls (a scoring tally just changes its text). */
    const editedSincePress =
      editedAt > pressedAt &&
      editedAt - pressedAt < EDIT_ANSWER_MS &&
      (ping || controlSignature(m.components) !== pressedControls);
    /* An edit after my press is the next step, unless all it left me is a way to take the press back. */
    const answered =
      pressedAt !== undefined && (!editedSincePress || !hasForwardControl(m));
    /* A table-wide call I made myself ("Construction played by @me, @everyone choose…"). It can carry my
       primary, so it stays (once); its copies in the card's thread are dropped. */
    if (
      m.prompted_user_id === me.id &&
      ping &&
      (m.mention_roles ?? []).some((r) => myRoles.has(r))
    ) {
      const stale = index < ids.length - ROLE_WINDOW;
      items.push({ message: m, channelId, where, reason: "own", ownCall: true, answered: answered || stale });
      return;
    }
    if (answered) return;

    const role =
      roleCalls &&
      index >= ids.length - ROLE_WINDOW &&
      isRolePrompt(me.id, m, myRoles, roleFollowUp);
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

function latestRoundStart(state: PlayState, actionsId: string) {
  const data = state.messages[actionsId];
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (m?.author.bot && /^Started Round \d+/.test(m.content)) return m.id;
  }
  return undefined;
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
/** Sorted oldest first, action-log prompts last (the tray shows the list newest / action log on top). */
export function useAttention(
  gameName: string,
  myTurn: boolean,
): AttentionItem[] {
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
    const rank = (it: AttentionItem) => (it.channelId === game.actions.id ? 1 : 0);
    /* Table talk is chatter: its table-wide buttons (e.g. "Purge Overrule") are not calls to act. */
    const all = targets.flatMap((id) =>
      scanChannel(
        state,
        id,
        channelLabel(game, id, state),
        id !== game.tableTalk?.id,
      ),
    );
    const ownCalls = all.filter((it) => it.ownCall);
    const own = new Set(ownCalls.flatMap(customIds));
    /* Only the card I played last can still need my primary. */
    const newestOwn = ownCalls.reduce<string | undefined>(
      (max, it) =>
        !max || compareSnowflakes(it.message.id, max) > 0 ? it.message.id : max,
      undefined,
    );
    /* The bot sometimes asks the same question twice; keep the newest copy. */
    const newestBySignature = new Map<string, string>();
    for (const it of all) newestBySignature.set(`${it.channelId}:${buttonSignature(it)}`, it.message.id);
    /* A new round ("Started Round 2") retires whatever the last one left unanswered. */
    const roundStart = latestRoundStart(state, game.actions.id);
    return all
      .filter((it) => !roundStart || compareSnowflakes(it.message.id, roundStart) > 0)
      .filter((it) =>
        it.ownCall
          ? myTurn && !it.answered && it.message.id === newestOwn
          : it.message.prompted_user_id !== me.id ||
            !customIds(it).some((id) => own.has(id)),
      )
      .filter(
        (it) =>
          newestBySignature.get(`${it.channelId}:${buttonSignature(it)}`) ===
          it.message.id,
      )
      .sort(
        (a, b) =>
          rank(a) - rank(b) || compareSnowflakes(a.message.id, b.message.id),
      );
    // The store slices below are what scanChannel reads.
  }, [game, me, myTurn, targets, messages, interacted, dismissed, pressed, conn]);
}
