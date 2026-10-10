import type { ChannelMessages } from "@/discord/client/store";
import type { Component, Message } from "@/discord";
import type { HandCard } from "./model";

/** A live bot button somewhere in the player's cards-info thread. */
export type BotButton = {
  channelId: string;
  messageId: string;
  customId: string;
  label: string;
};

/**
 * What the bot currently offers in the cards-info thread. The bot numbers each
 * card instance (`(903) Trade Rider`); its buttons carry those numbers, while
 * the hand endpoint returns card aliases, so the numbers are read back from the
 * bot's own hand listings.
 */
export type ThreadIndex = {
  acPlay: Map<number, BotButton>;
  acDiscard: Map<number, BotButton>;
  soScore: Map<number, BotButton>;
  soDiscard: Map<number, BotButton>;
  pnPlay: Map<string, BotButton>;
  openAcDiscard?: BotButton;
  openSoScore?: BotButton;
  openSoDiscard?: BotButton;
  refresh?: BotButton;
  /**
   * The bot's newest word on which secrets I meet this status phase (lower-cased names); empty when it says none,
   * undefined when it has not said.
   */
  soMet?: string[];
  /** The action card hand limit, from the bot's newest hand listing (`__Action Cards__ (9/7)`). */
  acLimit?: number;
  /** Lower-cased card name → numbers, from the newest listing of each kind. */
  acNumbers: Map<string, number[]>;
  soNumbers: Map<string, number[]>;
  pnNumbers: Map<string, number[]>;
};

const NUMBERED = /_([^_\n]+?)_[^\n]*?`\(\s*(\d+)\)`/g;
const LABEL_NUMBER = /^(?:Discard )?\((\d+)\)\s+(.+)$/;

function buttonsOf(message: Message): Component[] {
  const out: Component[] = [];
  const walk = (list?: Component[]) => {
    for (const c of list ?? []) {
      if (c.type === 2 && c.custom_id && !c.disabled) out.push(c);
      walk(c.components);
      if (c.accessory) walk([c.accessory]);
    }
  };
  walk(message.components);
  return out;
}

const OWNER_COLOR = /\*\*([A-Za-z]+)\*\*[^`\n]*`\(\s*\d+\)`/;

/**
 * Card name → numbers in a bot hand listing. Promissory lines also name the
 * owning colour (`_Ceasefire_ … **Vapourwave** \`(56)\``), so two players'
 * notes of the same name are told apart under `name|color` keys.
 */
function numbersIn(text: string): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const add = (key: string, n: number) => map.set(key, [...(map.get(key) ?? []), n]);
  for (const line of text.split("\n")) {
    for (const match of line.matchAll(NUMBERED)) {
      const name = match[1].trim().toLowerCase();
      add(name, Number(match[2]));
      const color = OWNER_COLOR.exec(line)?.[1];
      if (color) add(`${name}|${color.toLowerCase()}`, Number(match[2]));
    }
  }
  return map;
}

function section(content: string, start: RegExp, end?: RegExp): string {
  const from = content.search(start);
  if (from < 0) return "";
  const rest = content.slice(from);
  if (!end) return rest;
  const to = rest.slice(1).search(end);
  return to < 0 ? rest : rest.slice(0, to + 1);
}

const numberedId = (prefix: RegExp, id: string) => {
  const m = prefix.exec(id);
  return m ? Number(m[1]) : undefined;
};

/** Indexes the thread newest → oldest, so the newest offer of each button wins. */
export function indexThread(channel: ChannelMessages | undefined): ThreadIndex {
  const index: ThreadIndex = {
    acPlay: new Map(),
    acDiscard: new Map(),
    soScore: new Map(),
    soDiscard: new Map(),
    pnPlay: new Map(),
    acNumbers: new Map(),
    soNumbers: new Map(),
    pnNumbers: new Map(),
  };
  if (!channel) return index;
  const labelNumbers = new Map<string, number[]>();
  let acSeen = false;
  let soSeen = false;
  let pnSeen = false;
  let metSeen = false;

  for (let i = channel.ids.length - 1; i >= 0; i--) {
    const message = channel.byId[channel.ids[i]];
    if (!message || !message.author?.bot) continue;
    const content = message.content ?? "";

    if (!metSeen && /does not believe that you can score any of your secret/i.test(content)) {
      metSeen = true;
      index.soMet = [];
    }
    const able = metSeen ? undefined : /capable of scoring the following secret objectives?:\s*([\s\S]*)$/i.exec(content)?.[1];
    if (able) {
      metSeen = true;
      index.soMet = able
        .split("\n")
        .map((l) => l.replace(/<a?:\w+:\d+>/g, "").replace(/[_*`]/g, "").replace(/\(\s*\d+\)/, "").trim())
        .filter(Boolean)
        .map((l) => l.split(/\s+[-–—:]\s+/)[0].replace(/^\d+\\?\.\s*/, "").toLowerCase());
    }
    if (!acSeen && content.startsWith("__Action Cards__")) {
      acSeen = true;
      index.acNumbers = numbersIn(content);
      const limit = /^__Action Cards__ \((\d+)\/(\d+)\)/.exec(content);
      if (limit) index.acLimit = Number(limit[2]);
    }
    if (!soSeen && content.includes("__Unscored Secret Objectives")) {
      soSeen = true;
      index.soNumbers = numbersIn(section(content, /__Unscored Secret Objectives/));
    }
    if (!pnSeen && content.includes("Promissory notes in your hand")) {
      pnSeen = true;
      index.pnNumbers = numbersIn(
        section(content, /Promissory notes in your hand/, /Promissory notes in your play area/),
      );
    }

    for (const component of buttonsOf(message)) {
      const ref: BotButton = {
        channelId: message.channel_id,
        messageId: message.id,
        customId: component.custom_id!,
        label: component.label ?? "",
      };
      classify(index, ref);
      const labelled = LABEL_NUMBER.exec(ref.label);
      if (labelled) {
        const name = labelled[2].trim().toLowerCase();
        const list = labelNumbers.get(name) ?? [];
        if (!list.includes(Number(labelled[1]))) list.push(Number(labelled[1]));
        labelNumbers.set(name, list);
      }
    }
  }
  // Button labels fill in names the listings do not (yet) mention.
  for (const [name, numbers] of labelNumbers) {
    if (!index.acNumbers.has(name) && !acSeen) index.acNumbers.set(name, numbers);
    if (!index.soNumbers.has(name) && !soSeen) index.soNumbers.set(name, numbers);
  }
  return index;
}

function classify(index: ThreadIndex, ref: BotButton) {
  const id = ref.customId;
  const setFirst = <K>(map: Map<K, BotButton>, key: K | undefined) => {
    if (key === undefined || Number.isNaN(key) || map.has(key)) return;
    map.set(key, ref);
  };
  if (id.startsWith("ac_play_from_hand_"))
    return setFirst(index.acPlay, numberedId(/^ac_play_from_hand_(\d+)$/, id));
  if (id.startsWith("ac_discard_from_hand_"))
    return setFirst(index.acDiscard, numberedId(/^ac_discard_from_hand_(\d+)$/, id));
  if (id.startsWith("so_score_hand_"))
    return setFirst(index.soScore, numberedId(/^so_score_hand_(\d+)$/, id));
  if (id.startsWith("discardSecret_") || id.startsWith("SODISCARD_"))
    return setFirst(index.soDiscard, numberedId(/^(?:discardSecret_|SODISCARD_)(\d+)$/, id));
  if (id.startsWith("resolvePNPlay_"))
    return setFirst(index.pnPlay, id.slice("resolvePNPlay_".length));
  if (id === "getDiscardButtonsACs") index.openAcDiscard ??= ref;
  else if (id === "get_so_score_buttons") index.openSoScore ??= ref;
  else if (id === "get_so_discard_buttons") index.openSoDiscard ??= ref;
  else if (id === "cardsInfo") index.refresh ??= ref;
}

/** Assigns the bot's per-instance numbers to cards of one kind, by name. */
export function assignNumbers(
  cards: HandCard[],
  numbers: Map<string, number[]>,
): Map<string, number> {
  const used = new Set<number>();
  const out = new Map<string, number>();
  for (const card of cards) {
    const name = card.name.toLowerCase();
    const owned = card.owner && numbers.get(`${name}|${card.owner.color.toLowerCase()}`);
    const candidates = owned || (numbers.get(name) ?? []);
    const free = candidates.find((n) => !used.has(n));
    if (free === undefined) continue;
    used.add(free);
    out.set(card.key, free);
  }
  return out;
}

/** The newest button in a channel, after `afterId`, whose custom id matches. */
export function findNewButton(
  channel: ChannelMessages | undefined,
  afterId: string | undefined,
  match: (customId: string) => boolean,
): BotButton | undefined {
  if (!channel) return undefined;
  for (let i = channel.ids.length - 1; i >= 0; i--) {
    const id = channel.ids[i];
    if (afterId && BigInt(id) <= BigInt(afterId)) return undefined;
    const message = channel.byId[id];
    if (!message) continue;
    const hit = buttonsOf(message).find((c) => match(c.custom_id!));
    if (hit)
      return {
        channelId: message.channel_id,
        messageId: message.id,
        customId: hit.custom_id!,
        label: hit.label ?? "",
      };
  }
  return undefined;
}

const HAND_NOISE =
  /^(__Action Cards__|__Scored Secret Objectives|#+ __Promissory notes|Click a button below to play an action card|Use these buttons to (score|discard)|You may use these buttons to do various things)|someone refreshed your|^You pressed: |If your cards info thread disappears|the bot could auto pass|automatically pass on Sabos|gentle reminder|quick nudge|end of round thoughts|This is a nudge that|is currently waiting on \d+ players?|These buttons can help with bugs|now is the time to decide whether or not you will play|placed the agendas in this order|^#*\s*Vote Count/;

const HAND_BUTTON = /^(ac_play_from_hand_|ac_discard_from_hand_|so_score_hand_|discardSecret_|SODISCARD_|getDiscardButtonsACs|get_so_)/;

/**
 * Hand listings and menus the bot reposts after every change, card pickers the
 * tray already answered, and command echoes: the tray shows all of that itself.
 */
function isHandNoise(message: Message): boolean {
  const content = message.content ?? "";
  if (HAND_NOISE.test(content) || content.startsWith("```notSus")) return true;
  const buttons = buttonsOf(message);
  return buttons.length > 0 && buttons.every((b) => HAND_BUTTON.test(b.custom_id ?? ""));
}

function newBotMessages(
  channel: ChannelMessages | undefined,
  afterId: string,
  keep: (message: Message) => boolean,
): Message[] {
  if (!channel) return [];
  const out: Message[] = [];
  for (let i = channel.ids.length - 1; i >= 0; i--) {
    const id = channel.ids[i];
    if (BigInt(id) <= BigInt(afterId)) break;
    const message = channel.byId[id];
    if (message?.author?.bot && keep(message)) out.push(message);
  }
  return out;
}

/**
 * What the bot said back after an action: its new posts in the cards thread
 * (minus the hand listings it reposts), plus posts in the actions channel
 * that name me. Snowflakes are time-ordered across channels, so one baseline
 * serves both.
 */
export function botReplies(
  thread: ChannelMessages | undefined,
  actions: ChannelMessages | undefined,
  afterId: string | undefined,
  meId: string | undefined,
): Message[] {
  if (!afterId) return [];
  const mine = (m: Message) => !!meId && ((m.content ?? "").includes(`<@${meId}>`) || m.prompted_user_id === meId);
  return [
    ...newBotMessages(thread, afterId, (m) => !isHandNoise(m)),
    ...newBotMessages(actions, afterId, (m) => mine(m) && !isHandNoise(m)),
  ].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

const REFUSAL = /denied|cannot|can't|not able|unable|not allowed|will not allow|over the limit|try again|rebooting|no such|does not think|please retry|something went wrong/i;

/** True when a bot reply reads as a refusal. */
export function isRefusal(message: Message): boolean {
  return REFUSAL.test(message.content ?? "");
}

export function messageButtons(message: Message): Component[] {
  return buttonsOf(message);
}

/**
 * Whether the active player has already taken this turn's action: the bot's newest turn prompt in the
 * actions channel offers "End Turn" but no longer a fresh "Tactical Action".
 */
export function actionTakenThisTurn(actions: ChannelMessages | undefined): boolean {
  if (!actions) return false;
  const stop = Math.max(0, actions.ids.length - 60);
  for (let i = actions.ids.length - 1; i >= stop; i--) {
    const message = actions.byId[actions.ids[i]];
    if (!message?.author?.bot) continue;
    const ids = buttonsOf(message).map((b) => (b.custom_id ?? "").replace(/^FFCC_[^_]+_/, ""));
    const fresh = ids.some((id) => /^tacticalAction(?!Build)/.test(id));
    const end = ids.some((id) => /^(turnEnd|endOfTurnAbilities)/.test(id));
    if (fresh) return false;
    if (end) return true;
  }
  return false;
}

/**
 * The open Sabotage window: the newest "Cancel Action Card With Sabotage" prompt for another player's card that
 * the bot has not closed yet ("all players have indicated No Sabotage").
 */
export function sabotageWindow(actions: ChannelMessages | undefined, myFaction: string | undefined): BotButton | undefined {
  if (!actions || !myFaction) return undefined;
  const stop = Math.max(0, actions.ids.length - 25);
  for (let i = actions.ids.length - 1; i >= stop; i--) {
    const message = actions.byId[actions.ids[i]];
    if (!message?.author?.bot) continue;
    if (/all players have indicated "?No Sabotage"?/i.test(message.content ?? "")) return undefined;
    const button = buttonsOf(message).find((b) => /^sabotage_ac_/.test(b.custom_id ?? ""));
    if (!button) continue;
    if ((button.custom_id ?? "").endsWith(`_${myFaction}`)) return undefined;
    return { channelId: message.channel_id, messageId: message.id, customId: button.custom_id!, label: button.label ?? "" };
  }
  return undefined;
}
