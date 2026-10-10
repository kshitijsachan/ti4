import { useEffect, useMemo } from "react";
import { usePlay, usePlayConnection, type Message, type PlayState } from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { readStored, writeStored } from "@/discord/client/lastRead";
import { controlSignature } from "@/discord/client/store";
import {
  baseId,
  buttonSignature,
  choicesOf,
  forwardChoices,
  idFaction,
  isDraftPrompt,
  isHandMenu,
  isSecretDiscardPrompt,
  isTableSetupPrompt,
  needsAnswer,
} from "../model/controls";
import { findGame, type GameChannels } from "./games";

/** Why a prompt is considered mine. */
export type PendingReason =
  | "ephemeral"
  | "reply"
  | "mention"
  | "role"
  | "follow-up"
  | "own"
  | "faction"
  | "combat"
  /** A table-wide setup step addressed to nobody (deal secret objectives, start round 1): anyone may press it. */
  | "table"
  /** A setup choice in my hand thread (which secret objective to keep). */
  | "setup";

/** One bot prompt that waits on me. */
export type PendingPrompt = {
  message: Message;
  channelId: string;
  /** Channel or thread name without the game prefix ("actions", "round-2-system-301-…"). */
  where: string;
  reason: PendingReason;
  /** A table-wide call I made myself (my strategy card): shown once. */
  ownCall?: boolean;
  answered?: boolean;
};

export type PendingContext = {
  /** It is my strategy- or action-phase turn. */
  myTurn: boolean;
  /** My faction (lower case, as in `FFCC_<faction>_` button ids). */
  faction?: string;
  /**
   * The setup draft is over (or there was none): the table-wide setup steps that follow it are live. While the
   * draft runs the draft view owns the screen and those stay hidden.
   */
  setupOpen?: boolean;
};

/**
 * Messages that called my role ("@pbd7, please score objectives"). The bot often edits such a message as
 * players answer and drops the role mention, so remember them (per browser) once seen.
 */
const rolePrompts = new Map<string, Set<string>>();

function isRolePrompt(meId: string, m: Message, myRoles: Set<string>, followsRolePing = false) {
  let seen = rolePrompts.get(meId);
  if (!seen) {
    seen = new Set(Object.keys(readStored<true>(`rolePrompts.${meId}`)));
    rolePrompts.set(meId, seen);
  }
  if (seen.has(m.id)) return true;
  if (!followsRolePing && !(m.mention_roles ?? []).some((r) => myRoles.has(r))) return false;
  seen.add(m.id);
  const keep = [...seen].sort(compareSnowflakes).slice(-200);
  writeStored(`rolePrompts.${meId}`, Object.fromEntries(keep.map((id) => [id, true])));
  return true;
}

/** How many of the newest messages of a channel a role-wide prompt stays relevant for. */
const ROLE_WINDOW = 40;
/** Messages the bot posts right after pinging someone belong to the same prompt. */
const FOLLOW_UP_MS = 5000;
/** How soon after my press an edit of that message counts as the bot's answer to it. */
const EDIT_ANSWER_MS = 15000;
/** A table-wide setup button I pressed that is still there after this long can be pressed again. */
const TABLE_RETRY_MS = 20000;
/** Combat-thread buttons: rolling dice, assigning hits, retreating. */
const FOLLOW_ID = /^(sc_follow_|sc_no_follow_|sc_\w+_follow|requestAllFollow)/;
const COMBAT_ID = /^(combatRoll|getDamageButtons|assignHits|retreat_|rollForAmbush|bombardConfirm|assignDamage|autoAssign)/;

function whereLabel(game: GameChannels, id: string, state: PlayState) {
  if (id === game.actions.id) return "actions";
  if (id === game.hand?.id) return "hand";
  if (id === game.tableTalk?.id) return "table talk";
  const name = state.channels[id]?.name ?? "thread";
  return name.startsWith(`${game.name}-`) ? name.slice(game.name.length + 1) : name;
}

/** A combat thread I fight in: `pbd8-round-3-system-301-turn-1-sol-vs-keleresa`. */
function isMyCombatThread(name: string, faction?: string) {
  if (!faction || !/-vs-/.test(name)) return false;
  const sides = name.split("-turn-")[1]?.split(/-\d+-|-/) ?? [];
  return sides.includes(faction);
}

type ScanOptions = {
  roleCalls: boolean;
  combat: boolean;
  faction?: string;
  /** Table-wide setup buttons posted here are everyone's (the action log and table talk). */
  tableSetup: boolean;
  /** This is my hand thread. */
  hand: boolean;
  setupOpen: boolean;
};

/** When I pressed something on a message, and whether the bot's edit since made it a new step. */
function answeredState(state: PlayState, m: Message, ping: boolean) {
  const pressedAt = m.my_press ? Date.parse(m.my_press.at) : state.pressed[m.id];
  const pressedControls = m.my_press?.controls ?? state.pressedControls[m.id];
  if (pressedAt === undefined) return false;
  const editedAt = m.edited_timestamp ? Date.parse(m.edited_timestamp) : 0;
  const editedSincePress =
    editedAt > pressedAt &&
    editedAt - pressedAt < EDIT_ANSWER_MS &&
    (ping || controlSignature(m.components) !== pressedControls);
  return !editedSincePress || !needsAnswer(m);
}

/**
 * The prompts in one channel that wait on me, oldest first.
 *
 * A prompt is answered once I press something on it (unless the bot then edits it into the next step).
 * It goes stale when the bot moves on: a newer prompt addressed to another player in the same channel
 * (the turn passed), or, for pings and their follow-ups, a newer ping to me.
 */
function scanChannel(state: PlayState, channelId: string, where: string, opts: ScanOptions): PendingPrompt[] {
  const me = state.me;
  const data = state.messages[channelId];
  if (!me || !data?.ids.length) return [];
  const myRoles = new Set(state.users[me.id]?.roles ?? []);
  const mentionsMe = (m: Message) => !!m.mentions?.some((u) => u.id === me.id) || m.content.includes(`<@${me.id}>`);
  const mentionsOther = (m: Message) => !!m.mentions?.some((u) => u.id !== me.id && !u.bot) && !mentionsMe(m);
  const otherFaction = (m: Message) =>
    forwardChoices(m).some((c) => {
      const f = idFaction(c.customId);
      return !!f && !!opts.faction && f !== opts.faction;
    });
  const mineByFaction = (m: Message) =>
    !!opts.faction && forwardChoices(m).some((c) => idFaction(c.customId) === opts.faction);

  const ids = data.ids;
  let newestMention: string | null = null;
  let newestOtherPrompt: string | null = null;
  for (let i = ids.length - 1; i >= 0; i--) {
    const m = data.byId[ids[i]];
    if (!newestMention && mentionsMe(m)) newestMention = ids[i];
    if (!newestOtherPrompt && (mentionsOther(m) || otherFaction(m)) && needsAnswer(m)) newestOtherPrompt = ids[i];
    if (newestMention && newestOtherPrompt) break;
  }
  const after = (id: string, mark: string | null) => !mark || compareSnowflakes(id, mark) >= 0;
  const newestCombat = opts.combat
    ? [...ids].reverse().find((id) => choicesOf(data.byId[id]).some((c) => COMBAT_ID.test(c.customId ?? "")))
    : undefined;

  const items: PendingPrompt[] = [];
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
    const roleFollowUp = !ping && !pingsOther && at - rolePingAt <= FOLLOW_UP_MS;
    const forOther = pingsOther || (!ping && at - otherPingAt <= FOLLOW_UP_MS) || otherFaction(m);
    if (!m.author.bot || state.dismissedPrompts[id] || !needsAnswer(m) || isDraftPrompt(m) || isHandMenu(m)) return;
    const tableSetup = isTableSetupPrompt(m);
    // Table-wide setup steps (deal secret objectives, start the game) are pressed by the server once everyone is
    // ready (shim/src/solo.ts steward), so they are never a decision for a person.
    if (tableSetup) return;
    let answered = answeredState(state, m, ping);
    if (tableSetup) {
      /*
       * Addressed to nobody, so nobody else's prompt retires it: the bot deletes it once a press goes through. One
       * still here a while after my press was refused ("not everyone has discarded yet"): offer it again.
       */
      const pressedAt = m.my_press ? Date.parse(m.my_press.at) : state.pressed[m.id];
      if (pressedAt !== undefined && Date.now() - pressedAt < TABLE_RETRY_MS) return;
      items.push({ message: m, channelId, where, reason: "table" });
      return;
    }
    if (m.prompted_user_id === me.id && ping && (m.mention_roles ?? []).some((r) => myRoles.has(r))) {
      /* Only the card's own buttons are mine; the follow buttons are the other players'. */
      if (!forwardChoices(m).some((c) => !FOLLOW_ID.test(baseId(c.customId)))) answered = true;
      const stale = index < ids.length - ROLE_WINDOW;
      items.push({ message: m, channelId, where, reason: "own", ownCall: true, answered: answered || stale });
      return;
    }
    if (answered) return;

    const role = opts.roleCalls && index >= ids.length - ROLE_WINDOW && isRolePrompt(me.id, m, myRoles, roleFollowUp);
    let reason: PendingReason | null = null;
    if (opts.hand && isSecretDiscardPrompt(m)) {
      items.push({ message: m, channelId, where, reason: "setup" });
      return;
    }
    if (m.ephemeral) reason = "ephemeral";
    else if (!forOther && (m.interaction_metadata?.user?.id === me.id || m.prompted_user_id === me.id)) reason = "reply";
    else if (id === newestCombat) reason = "combat";
    else if (ping) reason = id === newestMention ? "mention" : null;
    else if (at - pingAt <= FOLLOW_UP_MS) reason = after(id, newestMention) ? "follow-up" : null;
    else if (mineByFaction(m) && !otherFaction(m)) reason = "faction";
    else if (role) reason = "role";
    if (!reason) return;
    if (reason !== "role" && reason !== "combat" && !after(id, newestOtherPrompt)) return;
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
      .slice(0, 10)
      .map((t) => t.id),
  ].filter((id): id is string => !!id);
}

/** Pure selection over a store snapshot, newest first. Exported for the fixtures harness and tests. */
export function selectPending(state: PlayState, game: GameChannels, ctx: PendingContext): PendingPrompt[] {
  const me = state.me;
  if (!me) return [];
  const all = scanTargets(game).flatMap((id) => {
    const name = state.channels[id]?.name ?? "";
    return scanChannel(state, id, whereLabel(game, id, state), {
      /* Table talk is chatter: its table-wide buttons (e.g. "Purge Overrule") are not calls to act. */
      roleCalls: id !== game.tableTalk?.id,
      combat: isMyCombatThread(name, ctx.faction),
      faction: ctx.faction,
      tableSetup: id === game.actions.id || id === game.tableTalk?.id,
      hand: id === game.hand?.id,
      setupOpen: !!ctx.setupOpen,
    });
  });
  const ownCalls = all.filter((it) => it.ownCall);
  const own = new Set(ownCalls.flatMap((it) => choicesOf(it.message).map((c) => c.customId ?? "")));
  const newestOwn = ownCalls.reduce<string | undefined>(
    (max, it) => (!max || compareSnowflakes(it.message.id, max) > 0 ? it.message.id : max),
    undefined,
  );
  /* The bot sometimes asks the same question twice (and copies a card's buttons into its thread). */
  const newestBySignature = new Map<string, string>();
  for (const it of all) newestBySignature.set(`${it.channelId}:${buttonSignature(it.message)}`, it.message.id);
  /* A new round ("Started Round 2") retires whatever the last one left unanswered. */
  const roundStart = latestRoundStart(state, game.actions.id);
  return all
    .filter((it) => !roundStart || compareSnowflakes(it.message.id, roundStart) > 0)
    .filter((it) =>
      it.ownCall
        ? ctx.myTurn && !it.answered && it.message.id === newestOwn
        : it.message.prompted_user_id !== me.id || !choicesOf(it.message).some((c) => own.has(c.customId ?? "")),
    )
    .filter((it) => newestBySignature.get(`${it.channelId}:${buttonSignature(it.message)}`) === it.message.id)
    .sort((a, b) => compareSnowflakes(b.message.id, a.message.id));
}

/**
 * Everything in this game that waits on me, newest first: prompts the bot addressed to me (pings, replies
 * to my presses, "only you can see this" messages, my faction's buttons, my combat threads, role-wide
 * calls like strategy-card follows) that I have not answered or hidden. Loads the history of the game's
 * channels so it also works after a reload.
 */
export function usePendingPrompts(gameName: string, ctx: PendingContext): PendingPrompt[] {
  const conn = usePlayConnection();
  const status = usePlay((s) => s.status);
  const channels = usePlay((s) => s.channels);
  const game = useMemo(() => findGame(channels, gameName), [channels, gameName]);
  const targetKey = game ? scanTargets(game).join(",") : "";

  useEffect(() => {
    if (status !== "open") return;
    for (const id of targetKey.split(",").filter(Boolean)) {
      if (!conn.store.getState().messages[id]?.loaded) conn.loadHistory(id);
    }
  }, [targetKey, status, conn]);

  const messages = usePlay((s) => s.messages);
  const dismissed = usePlay((s) => s.dismissedPrompts);
  const pressed = usePlay((s) => s.pressed);
  const me = usePlay((s) => s.me);
  const { myTurn, faction, setupOpen } = ctx;

  return useMemo(() => {
    if (!game || !me) return [];
    return selectPending(conn.store.getState(), game, { myTurn, faction, setupOpen });
    // The store slices below are what the scan reads.
  }, [game, me, myTurn, faction, setupOpen, messages, dismissed, pressed, conn]);
}
