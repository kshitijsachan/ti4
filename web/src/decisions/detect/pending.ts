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
  isUtilityMenu,
  isSecretDiscardPrompt,
  isTableSetupPrompt,
  needsAnswer,
} from "../model/controls";
import { isScoringSummary, scoringOpenFor } from "../model/scoring";
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
  /** Presses I made on this prompt so far (own calls whose primary takes more than one press). */
  presses?: number;
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

/**
 * Presses seen per message (distinct press times, persisted per browser). Construction's primary is two presses on
 * the card's own message (one structure, then another), and the bot posts no second prompt for it.
 */
const pressLog = new Map<string, Record<string, number[]>>();
const SAME_PRESS_MS = 4000;

function pressCount(meId: string, m: Message, pressedAt: number | undefined) {
  let log = pressLog.get(meId);
  if (!log) {
    log = readStored<number[]>(`pressLog.${meId}`);
    pressLog.set(meId, log);
  }
  const seen = log[m.id] ?? [];
  if (pressedAt === undefined || seen.some((t) => Math.abs(t - pressedAt) < SAME_PRESS_MS)) return seen.length;
  log[m.id] = [...seen, pressedAt];
  const keep = Object.keys(log).sort(compareSnowflakes).slice(-50);
  writeStored(`pressLog.${meId}`, Object.fromEntries(keep.map((id) => [id, log[id]])));
  return log[m.id].length;
}

/** How many presses my own strategy card's message takes before its primary is resolved. */
const TWO_PRESS_PRIMARY = /^(construction_|constructionPrimary_produce|diploSystem|diploRefresh2|score_imperial|scoreAnObjective)/;
function pressesNeeded(m: Message) {
  return choicesOf(m).some((c) => TWO_PRESS_PRIMARY.test(baseId(c.customId))) ? 2 : 1;
}

/**
 * Prompts answered with many presses on one message and closed by their own Done button (which deletes it or strips
 * its buttons): produce units, exhaust planets / spend TG, gain command tokens. They stay open while their buttons do.
 */
function isMultiPress(m: Message) {
  const ids = choicesOf(m).map((c) => baseId(c.customId));
  return (
    ids.some((id) => /^(place_|spend_|reduceTG_|reduceComm_|increase_\w+_cc|riftUnit_|riftAllUnits_|wormholeUnit_|wormholeAllShips_)/.test(id)) &&
    ids.some((id) => /^(deleteButtons|resetProducedThings|resetSpend_|resetCCs|doneRifting$)/.test(id))
  );
}

/**
 * The steps after moving (land ground forces; roll for the gravity rift, produce, conclude the tactical action): the bot
 * leaves them up while the rift roll or another of their buttons is answered, and deletes them once I finish landing,
 * produce or conclude.
 */
function isTacticalHub(m: Message) {
  const ids = choicesOf(m).map((c) => baseId(c.customId));
  return ids.includes("doneWithTacticalAction") || ids.some((id) => /^doneLanding/.test(id));
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
const SC_CALL_ID = /^(sc_follow_\d|sc_trade_follow|sc_no_follow_\d)/;
const COMBAT_ID = /^(combatRoll|getDamageButtons|assignHits|retreat_|rollForAmbush|bombardConfirm|assignDamage|autoAssign)/;

/** After a homework prompt: the bot's "<faction> … is ready for strategy phase." line for this faction. */
export function declaredReady(after: (Message | undefined)[], faction: string) {
  const f = faction.toLowerCase();
  const mine = (m: Message) =>
    [...m.content.matchAll(/<a?:(\w+):\d+>/g)].some(([, name]) => {
      const n = name.toLowerCase();
      return n === f || f.startsWith(n) || n.startsWith(f);
    });
  return after.some((m) => !!m?.author.bot && /\bis ready for strategy phase\b/i.test(m.content) && mine(m));
}

/** The bot marks who has answered a table-wide prompt with that faction's emoji as a reaction. */
export function reactedBy(m: Message, faction: string) {
  const f = faction.toLowerCase();
  const reactions = (m as Message & { reactions?: { emoji?: { name?: string | null } }[] }).reactions ?? [];
  return reactions.some((r) => {
    const name = (r.emoji?.name ?? "").toLowerCase();
    return !!name && (name === f || f.startsWith(name) || name.startsWith(f));
  });
}

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
  /* My newest fresh turn menu (Tactical / Component / Strategic action): a strategy card I played before it is done. */
  const newestTurnMenu = [...ids].reverse().find((id) => {
    const m = data.byId[id];
    if (/\bit is now your turn\b/i.test(m.content) && mentionsMe(m)) return true;
    return choicesOf(m).some((c) => /^tacticalAction(?!Build)/.test(baseId(c.customId)) && idFaction(c.customId) === opts.faction);
  });
  const newestCombat = opts.combat
    ? [...ids].reverse().find((id) => choicesOf(data.byId[id]).some((c) => COMBAT_ID.test(c.customId ?? "")))
    : undefined;

  const items: PendingPrompt[] = [];
  let pingAt = -Infinity;
  let otherPingAt = -Infinity;
  let rolePingAt = -Infinity;
  let scoringClosed = false;
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
    /* "Score A Secret Objective" pressed on the status-phase summary (not from the hand tray) answers in the action log. */
    const secretPick = !!m.ephemeral && opts.roleCalls && !opts.hand && forwardChoices(m).some((c) => /^so_score_hand_/.test(baseId(c.customId)));
    if (!m.author.bot || state.dismissedPrompts[id] || !needsAnswer(m) || isDraftPrompt(m) || (isHandMenu(m) && !secretPick) || isUtilityMenu(m)) return;
    const tableSetup = isTableSetupPrompt(m);
    // Table-wide setup steps (deal secret objectives, start the game) are pressed by the server once everyone is
    // ready (shim/src/solo.ts steward), so they are never a decision for a person.
    if (tableSetup) return;
    let answered = answeredState(state, m, ping);
    /* Production takes many presses on one message (a unit each) and ends with its Done button, which removes it. */
    if (answered && isMultiPress(m)) answered = false;
    if (answered && isTacticalHub(m)) answered = false;
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
      const stale = index < ids.length - ROLE_WINDOW || (!!newestTurnMenu && compareSnowflakes(id, newestTurnMenu) < 0);
      const presses = pressCount(me.id, m, m.my_press ? Date.parse(m.my_press.at) : state.pressed[m.id]);
      if (answered && presses > 0 && presses < pressesNeeded(m)) answered = false;
      items.push({ message: m, channelId, where, reason: "own", ownCall: true, answered: answered || stale, presses });
      return;
    }
    if (opts.roleCalls && isScoringSummary(m)) {
      /* Status-phase scoring has two halves (public, secret): it waits on me until the bot's summary has both. */
      const meUser = state.users[me.id] ?? me;
      const open = scoringOpenFor(m, [meUser.global_name ?? undefined, meUser.username]);
      if (open === false) {
        scoringClosed = true;
        return;
      }
      if (open) {
        items.push({ message: m, channelId, where, reason: "role" });
        return;
      }
    }
    if (opts.roleCalls && opts.faction && forwardChoices(m).some((c) => baseId(c.customId) === "pass_on_abilities")) {
      /* Status homework: I may press "redistribute tokens" first; it waits on me until my faction reacts "ready". */
      /* The bot also reacts with my faction when I only redistribute: ready means its "is ready for strategy phase" line. */
      if (declaredReady(ids.slice(index + 1).map((x) => data.byId[x]), opts.faction)) return;
      items.push({ message: m, channelId, where, reason: "role" });
      return;
    }
    /* A played strategy card my faction has reacted to (followed, declined, or resolved as its holder) is answered,
       even after a reload, unless I am its holder halfway through a two-press primary (Construction) this turn. */
    if (opts.faction && reactedBy(m, opts.faction) && forwardChoices(m).some((c) => SC_CALL_ID.test(baseId(c.customId)))) {
      const pressedAt = m.my_press ? Date.parse(m.my_press.at) : state.pressed[m.id];
      const thisTurn = !newestTurnMenu || compareSnowflakes(id, newestTurnMenu) > 0;
      const midway = ping && thisTurn && pressesNeeded(m) > 1 && pressCount(me.id, m, pressedAt) === 1;
      if (!midway) return;
    }
    /*
     * Prompts the bot deletes once acted on stay until it does: the when / after queue (kept when I asked to play but
     * hold no card), the speaker's tie-break, resolution and agenda reveal (a press lost to a restart must not hide them).
     */
    const queuePrompt = forwardChoices(m).some((c) =>
      /^(declineToQueueA(When|nAfter)$|resolveAgendaVote_outcomeTie|agendaResolution_|flip_agenda$)/.test(baseId(c.customId)),
    );
    if (answered && !queuePrompt) return;
    /* The list of secrets to score, left over after I answered the secret half another way. */
    if (scoringClosed && forwardChoices(m).some((c) => /^so_score_hand_/.test(baseId(c.customId)))) return;

    /* A played strategy card waits on my follow however busy the log gets (bots play on); the round's end retires it. */
    const scCall = forwardChoices(m).some((c) => SC_CALL_ID.test(baseId(c.customId)));
    const role = opts.roleCalls && (scCall || index >= ids.length - ROLE_WINDOW) && isRolePrompt(me.id, m, myRoles, roleFollowUp);
    let reason: PendingReason | null = null;
    if (opts.hand && isSecretDiscardPrompt(m)) {
      items.push({ message: m, channelId, where, reason: "setup" });
      return;
    }
    if (m.ephemeral) reason = "ephemeral";
    else if (!forOther && (m.interaction_metadata?.user?.id === me.id || m.prompted_user_id === me.id)) reason = "reply";
    else if (id === newestCombat) reason = "combat";
    else if (ping && id === newestMention) reason = "mention";
    else if (!ping && at - pingAt <= FOLLOW_UP_MS && after(id, newestMention)) reason = "follow-up";
    /* An older ping or follow-up that carries my faction's own buttons (choose the speaker, draw agendas) is still mine. */
    else if (mineByFaction(m) && !otherFaction(m)) reason = "faction";
    else if (ping || at - pingAt <= FOLLOW_UP_MS) reason = null;
    else if (role) reason = "role";
    if (!reason) return;
    /* Only I see an ephemeral prompt or the reply to my own press: someone else's newer prompt never retires it. */
    /* A rider's prediction is mine alone and waits until the vote resolves: other players' voting prompts never retire it. */
    const rider = forwardChoices(m).some((c) => /^rider_/.test(baseId(c.customId)));
    if (reason !== "role" && reason !== "combat" && reason !== "ephemeral" && reason !== "reply" && !rider && !after(id, newestOtherPrompt)) return;
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
  /*
   * A tactical step is over once a newer one exists (movement done through the map's API never presses the bot's
   * "move from" message) or a new turn of mine started.
   */
  const isStep = (it: PendingPrompt) => choicesOf(it.message).some((c) => TACTICAL_STEP.test(baseId(c.customId)));
  const newestStep = all.filter(isStep).reduce<string | undefined>(
    (max, it) => (!max || compareSnowflakes(it.message.id, max) > 0 ? it.message.id : max),
    undefined,
  );
  const turnStart = latestTurnStart(state, game.actions.id, me.id);
  const flowMarks = laterFlowMarks(state, [...new Set(all.filter(isStep).map((it) => it.channelId))]);
  const retired = retiredSteps(me.id);
  const stepRetired = (it: PendingPrompt) => {
    if (retired.has(it.message.id)) return true;
    const later = (flowMarks.get(it.channelId) ?? []).some((id) => compareSnowflakes(id, it.message.id) > 0);
    const stale = later || it.message.id !== newestStep || (!!turnStart && compareSnowflakes(it.message.id, turnStart) < 0);
    if (stale) retireStep(me.id, it.message.id);
    return stale;
  };
  /* The bot posts a fresh "assign N hits" each time and leaves the old ones: only the newest of a kind counts. */
  const hitKind = (m: Message) =>
    choicesOf(m).map((c) => baseId(c.customId).match(/^autoAssign(\w*?)Hits/)?.[1]).find((k) => k !== undefined);
  const newestHit = new Map<string, string>();
  for (const it of all) {
    const data = state.messages[it.channelId];
    if (!data || newestHit.has(it.channelId)) continue;
    for (const id of data.ids) {
      const k = data.byId[id] && hitKind(data.byId[id]);
      if (k !== undefined) newestHit.set(`${it.channelId}:${k}`, id);
    }
    newestHit.set(it.channelId, "scanned");
  }
  const staleHit = (it: PendingPrompt) => {
    const k = hitKind(it.message);
    if (k === undefined) return false;
    if (retired.has(it.message.id)) return true;
    /* Remembered, because the bot deletes the newer one once it is answered and the old one would surface again. */
    const stale = newestHit.get(`${it.channelId}:${k}`) !== it.message.id;
    if (stale) retireStep(me.id, it.message.id);
    return stale;
  };
  /* My fresh turn menu is spent once I acted: a later step of mine, an activation, a card played (the bot leaves it up). */
  const actionsMarks = laterFlowMarks(state, [game.actions.id]).get(game.actions.id) ?? [];
  const playedSince = (id: string) =>
    (state.messages[game.actions.id]?.ids ?? []).some(
      (x) => compareSnowflakes(x, id) > 0 && /\bplayed by\b/i.test(state.messages[game.actions.id]?.byId[x]?.content ?? "") && (state.messages[game.actions.id]?.byId[x]?.mentions ?? []).some((u) => u.id === me.id),
    );
  const spentTurnMenu = (it: PendingPrompt) => {
    if (it.channelId !== game.actions.id) return false;
    if (!choicesOf(it.message).some((c) => /^tacticalAction(?!Build)/.test(baseId(c.customId)))) return false;
    if (retired.has(it.message.id)) return true;
    const spent = actionsMarks.some((id) => compareSnowflakes(id, it.message.id) > 0) || playedSince(it.message.id);
    if (spent) retireStep(me.id, it.message.id);
    return spent;
  };
  return all
    .filter((it) => !staleHit(it) && !spentTurnMenu(it))
    .filter((it) => !isStep(it) || !stepRetired(it))
    .filter((it) => !roundStart || compareSnowflakes(it.message.id, roundStart) > 0)
    .filter((it) =>
      it.ownCall
        ? ctx.myTurn && !it.answered && it.message.id === newestOwn
        : it.message.prompted_user_id !== me.id || !choicesOf(it.message).some((c) => own.has(c.customId ?? "")),
    )
    .filter((it) => newestBySignature.get(`${it.channelId}:${buttonSignature(it.message)}`) === it.message.id)
    .sort((a, b) => compareSnowflakes(b.message.id, a.message.id));
}

const TURN_MENU = /^(tacticalAction(?!Build)|endOfTurnAbilities|turnEnd)/;
/** The steps inside one tactical action: pick a system, the ships, land, conclude. */
const TACTICAL_STEP = /^(ringTile_|ring_|getTilesThisFarAway_|tacticalMoveFrom_|unitTacticalMove_|doneWithOneSystem|concludeMove_|landUnits_|doneLanding_|doneWithTacticalAction)/;

/** Anything that shows a tactical step is behind me: a later step's buttons, a new activation, the end-of-turn menu. */
const LATER_FLOW = /^(landUnits_|doneLanding_|movedNExplored_|tacticalActionBuild|deleteButtons_tacticalAction|doneWithTacticalAction|endOfTurnAbilities|turnEnd|passForRound|tacticalMoveFrom_|ringTile_)/;

function laterFlowMarks(state: PlayState, channelIds: string[]) {
  const marks = new Map<string, string[]>();
  for (const ch of channelIds) {
    const data = state.messages[ch];
    if (!data) continue;
    marks.set(
      ch,
      data.ids.filter((id) => {
        const m = data.byId[id];
        if (!m?.author.bot) return false;
        if (/\bactivated \d+\b|\bended turn\b/i.test(m.content)) return true;
        return choicesOf(m).some((c) => LATER_FLOW.test(baseId(c.customId)));
      }),
    );
  }
  return marks;
}

/** Tactical steps once seen superseded stay retired, even when what superseded them is gone (persisted per browser). */
const retiredByUser = new Map<string, Set<string>>();
function retiredSteps(meId: string) {
  let set = retiredByUser.get(meId);
  if (!set) {
    set = new Set(Object.keys(readStored<true>(`retiredSteps.${meId}`)));
    retiredByUser.set(meId, set);
  }
  return set;
}
function retireStep(meId: string, id: string) {
  const set = retiredSteps(meId);
  if (set.has(id)) return;
  set.add(id);
  const keep = [...set].sort(compareSnowflakes).slice(-200);
  writeStored(`retiredSteps.${meId}`, Object.fromEntries(keep.map((k) => [k, true])));
}

/** The newest "it is now your turn" ping to me in the action log. */
function latestTurnStart(state: PlayState, actionsId: string, meId: string) {
  const data = state.messages[actionsId];
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (m?.author.bot && /\bit is now your turn\b/i.test(m.content) && (m.mentions ?? []).some((u) => u.id === meId)) return m.id;
  }
  return undefined;
}

/**
 * My turn, yet nothing waits on me: a step got lost (an "only you can see this" prompt dropped by a reconnect, a press
 * that failed). Offer my newest turn menu again, so the turn never dead-ends.
 */
export function turnMenuFallback(state: PlayState, game: GameChannels, faction: string | undefined): PendingPrompt | undefined {
  const roundStart = latestRoundStart(state, game.actions.id);
  const data = state.messages[game.actions.id];
  if (!data || !faction) return undefined;
  let acted = false;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (!m?.author.bot || state.dismissedPrompts[m.id]) continue;
    if (roundStart && compareSnowflakes(m.id, roundStart) < 0) return undefined;
    if (/\bactivated \d+\b/i.test(m.content)) acted = true;
    const ids = choicesOf(m).filter((c) => idFaction(c.customId) === faction).map((c) => baseId(c.customId));
    /* Mid tactical action: the step that concludes it, not a fresh turn menu (that would start a second action). */
    if (ids.includes("doneWithTacticalAction")) return { message: m, channelId: game.actions.id, where: "actions", reason: "faction" as const };
    if (!ids.some((id) => TURN_MENU.test(id))) continue;
    if (acted && ids.some((id) => /^tacticalAction(?!Build)/.test(id)) && !ids.some((id) => /^turnEnd/.test(id))) return undefined;
    return { message: m, channelId: game.actions.id, where: "actions", reason: "faction" as const };
  }
  return undefined;
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
