import type { Message, PlayState } from "@/discord";
import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";
import { agendas } from "@/entities/data/agendas";
import type { PendingPrompt } from "../detect/pending";
import type { GameChannels } from "../detect/games";
import { baseId, choicesOf, cleanLabel, type Choice } from "./controls";
import { cleanText, firstLine, namesFrom } from "./text";
import { isScoringSummary, myScoringLine, scoringSummary, type ScoringLine } from "./scoring";

export type DecisionKind =
  | "tech"
  | "agendaPeek"
  | "scPrimary"
  | "spend"
  | "gainTokens"
  | "scPick"
  | "scFollow"
  | "turn"
  | "tactical"
  | "agenda"
  | "combat"
  | "transaction"
  | "reaction"
  | "scoring"
  | "status"
  | "setup"
  | "secretDiscard"
  | "generic";

export type AgendaInfo = {
  name: string;
  /** "Law" / "Directive". */
  type?: string;
  /** "For/Against", "Elect Player", ... */
  target?: string;
  text1?: string;
  text2?: string;
};

export type CombatInfo = {
  position?: string;
  kind: "space" | "ground";
  round?: number;
  /** Factions in the fight, from the thread name. */
  factions: string[];
  planet?: string;
};

export type ScoringInfo = {
  /** Picking which secret objective to score (the bot's follow-up to "Score A Secret Objective"). */
  secretPick?: boolean;
  /** Every player's answers so far, from the bot's live scoring summary. */
  lines: ScoringLine[];
  mine?: ScoringLine;
  /** What the bot told me in my hand thread about my secret objectives this status phase. */
  soHint?: string;
};

export type TradeSide = { who: string; items: string[] };
export type TradeInfo = { from: string; sides: TradeSide[] };

export type Decision = {
  id: string;
  prompt: PendingPrompt;
  kind: DecisionKind;
  /** Small caps line above the title: phase or place ("Strategy phase", "Combat · system 301"). */
  eyebrow: string;
  title: string;
  /** The bot's prose, cleaned to calm markdown. */
  text: string;
  choices: Choice[];
  sc?: number;
  agenda?: AgendaInfo;
  combat?: CombatInfo;
  trade?: TradeInfo;
  scoring?: ScoringInfo;
  /** System the prompt is about, for the map highlight. */
  position?: string;
  /** Prompts the bot posted together with this one that belong to it (my strategy card's follow-up steps). */
  steps?: Decision[];
  /** Can be answered ahead of time but nothing waits on it yet (pre-declining a card): listed last. */
  optional?: boolean;
  /**
   * An ability the game offers but does not wait on ("you may use these buttons to resolve your agent"): kept out of
   * the must-answer queue, listed under "Available now".
   */
  offer?: boolean;
  /** A table-wide step anyone may take (deal secret objectives, start round 1): listed after my own choices. */
  table?: boolean;
  /** Part of setting the game up (starting technology, which secret objective to keep). */
  setup?: boolean;
};

export type ClassifyContext = {
  state: Pick<PlayState, "users" | "channels" | "messages">;
  game: GameChannels;
  web?: PlayerDataResponse;
  me?: PlayerData;
};

const ID = {
  scPick: /^scPick_(\d+)/,
  scFollow: /^(sc_follow_|sc_no_follow_|sc_\w+_follow|preDeclineSC_|leadershipGenerateCCButtons|diploRefresh|construction_|acquireATechWithSC|warfareTeBuild|primaryOfTeWarfare|sendTradeHolder)/,
  turn: /^(tacticalAction|componentAction|passingAbilities|endOfTurnAbilities|turnEnd|doAnotherAction|confirmSecondAction|strategicAction_)/,
  tactical: /^(ringTile_|getTilesThisFarAway_|ring_|unitTactical|tacticalMoveFrom|doneWithOneSystem|doneMoving|doneLanding|landUnits|tacticalActionBuild|doneWithTacticalAction|concludeMove|planetsTake|place_|placeOneNDone|startCombat|getRaid)/i,
  combat: /^(combatRoll|getDamageButtons|assignHits|retreat_|rollForAmbush|bombardConfirm|assignDamage|autoAssign)/,
  agendaVote: /^(resolveAgendaVote|vote$|planetOutcomes|outcome|agendaResolution|preVote|exhaustForVotes|abstain|distinguished|planetRider|rider_)/,
  whensAfters: /^(queueAWhen|queueAnAfter|declineToQueueAWhen|declineToQueueAnAfter|no_when|no_after|play_when|play_after|passOnEverythingWhensNAfters|queueWhen_|queueAfter_|lockAftersIn)/,
  transaction: /^(acceptOffer|rejectOffer|resetOffer)/,
  sabotage: /^(no_sabotage|sabotage_)/,
  scoring: /^(po_scoring|po_no_scoring|so_no_scoring|get_so_score_buttons|scoreAnObjective|score_imperial|so_score)/,
  status: /^(redistributeCCButtons|pass_on_abilities)/,
  spend: /^(spend_|reduceTG_|reduceComm_)/,
  gainTokens: /^increase_(tactic|fleet|strategy)_cc/,
};

function has(choices: Choice[], re: RegExp) {
  return choices.some((c) => re.test(baseId(c.customId)));
}

function scName(ctx: ClassifyContext, n: number) {
  return getStrategyCardByInitiative(n, ctx.web?.strategyCardIdMap)?.name;
}

/** Strategy card number a follow prompt is about: from its buttons, else from the card emoji in the text. */
function scOfFollow(m: Message, choices: Choice[]): number | undefined {
  for (const c of choices) {
    const id = baseId(c.customId);
    const n = id.match(/^(?:sc_follow_|sc_no_follow_|preDeclineSC_)(\d+)/)?.[1];
    if (n) return Number(n);
  }
  if (has(choices, /^sc_trade_follow/)) return 5;
  const emoji = m.content.match(/<:sc_(\d+)_1:\d+>/)?.[1];
  return emoji ? Number(emoji) : undefined;
}

/** The agenda named by a message's own embed (agenda deck peeks), with its card data. */
function embeddedAgenda(m: Message): AgendaInfo | undefined {
  const embed = m.embeds?.find((e) => /<:Agenda:\d+>/.test(e.title ?? ""));
  if (!embed?.title) return undefined;
  return agendaInfo(embed.title, embed.description);
}

function agendaInfo(title: string, description?: string): AgendaInfo {
  const name = cleanLabel(title).replace(/[_*]/g, "").trim();
  const known =
    agendas.find((a) => a.name.toLowerCase() === name.toLowerCase() && (a.source === "base" || a.source === "pok")) ??
    agendas.find((a) => a.name.toLowerCase() === name.toLowerCase());
  const lines = (description ?? "").split("\n").map((l) => l.replace(/[_*]/g, "").trim()).filter(Boolean);
  const head = lines[0]?.match(/^(\w+):\s*(.+)$/);
  const body = head ? lines.slice(1) : lines;
  const forLine = body.find((l) => /^for:/i.test(l));
  const againstLine = body.find((l) => /^against:/i.test(l));
  const printed = forLine || againstLine ? { text1: forLine, text2: againstLine } : body.length ? { text1: body.join(" ") } : {};
  return {
    name,
    type: head?.[1] ?? known?.type,
    target: head?.[2] ?? known?.target,
    text1: printed.text1 ?? known?.text1,
    text2: printed.text1 ? printed.text2 : known?.text2,
  };
}

/** The agenda currently on the table: the newest "an agenda has been revealed" embed in the action log. */
export function currentAgenda(ctx: ClassifyContext): AgendaInfo | undefined {
  const data = ctx.state.messages[ctx.game.actions.id];
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    const embed = m?.embeds?.find((e) => /<:Agenda:\d+>/.test(e.title ?? ""));
    if (!embed?.title) continue;
    return agendaInfo(embed.title, embed.description);
  }
  return undefined;
}

/** Parses "<faction> pbd8-round-3-system-301-turn-1-sol-vs-keleresa" style combat threads. */
function combatOf(ctx: ClassifyContext, prompt: PendingPrompt, choices: Choice[]): CombatInfo {
  const name = ctx.state.channels[prompt.channelId]?.name ?? "";
  const roll = choices.map((c) => baseId(c.customId)).find((id) => /^combatRoll_/.test(id));
  const parts = roll?.split("_") ?? [];
  const position = parts[1] ?? name.match(/system-(\w+)-turn/)?.[1];
  const kind = /ground/i.test(parts[2] ?? "") || /ground/i.test(prompt.message.content) ? "ground" : "space";
  const factions = (name.split("-turn-")[1] ?? "").replace(/^\d+-/, "").split("-vs-").filter(Boolean);
  const active = ctx.web?.gameState?.activeCombat;
  const round = active && (!position || active.system === position) ? (active.round ?? undefined) : undefined;
  const planet = parts[2] && !/^(space|ground)$/.test(parts[2]) ? parts[2] : undefined;
  return { position, kind, round, factions, planet };
}

const GIVES = /^>?\s*(.+?) gives:\s*$/;
const ITEM = /^>?\s*-\s*(.+)$/;

/** "X gives: - 2 TG" blocks of a transaction offer. */
function tradeOf(text: string): TradeInfo {
  const from = text.match(/offer from (.+?):/)?.[1]?.replace(/\*\*/g, "").trim() ?? "Another player";
  const sides: TradeSide[] = [];
  for (const line of text.split("\n")) {
    const g = line.match(GIVES);
    if (g) {
      sides.push({ who: g[1].replace(/\*\*/g, "").trim(), items: [] });
      continue;
    }
    const it = line.match(ITEM);
    if (it && sides.length) sides[sides.length - 1].items.push(it[1].replace(/(^|\s)_(.+?)_(?=\s|$)/g, "$1$2").replace(/\*\*/g, "").trim());
  }
  return { from, sides };
}

/**
 * A title from the bot's first sentence ("Tess, please choose the planets to exhaust." → "Please choose the
 * planets to exhaust"), with that sentence then dropped from the body. Long openings get a neutral title.
 */
function genericTitle(text: string): { title: string; rest: string } {
  const first = firstLine(text, 400);
  const sentence = first.split(/(?<=[.!?])\s/)[0] ?? "";
  let bare = sentence.replace(/^[\w' -]{1,32},\s+/, "").replace(/[.:]$/, "").trim();
  if (bare.length > 72) {
    const ask =
      bare.match(/\b(choose|select|pick|decide)\b[^.!?,]{3,60}/i)?.[0] ??
      bare.match(/\buse (?:the |these |this )?buttons? to\b[^.!?,]{3,60}/i)?.[0];
    if (!ask) return { title: "The game needs your answer", rest: text };
    bare = ask.replace(/^use (the |these |this )?buttons? to\s*/i, "");
    const title = bare.charAt(0).toUpperCase() + bare.slice(1);
    return { title, rest: text };
  }
  if (!bare) return { title: "The game needs your answer", rest: text };
  const title = bare.charAt(0).toUpperCase() + bare.slice(1);
  const idx = text.indexOf(sentence.slice(-Math.min(sentence.length, 24)));
  const rest = idx >= 0 ? text.slice(idx + Math.min(sentence.length, 24)).replace(/^[\s*_]+/, "") : text;
  return { title, rest: rest.trim() };
}

/**
 * Async-Discord housekeeping that means nothing at a live table: the new-player survey, auto-pass timers in hours,
 * AFK hours, per-user preferences. Never a decision.
 */
const NOISE_ID = /^(answerSurvey_|offerSurvey|setAutoPass|setHourAsAFK_|playerPref|offerPlayerPref|sandbagPref_|setOptIn|setPersonalAutoPing|offerAFK)/;
const NOISE_TEXT = /automatically pass on sabos|median time \(in hours\)|your afk times|complete a 1 time survey/i;

export function isNoise(d: Decision): boolean {
  if (d.choices.some((c) => NOISE_ID.test(baseId(c.customId)))) return true;
  return NOISE_TEXT.test(d.prompt.message.content);
}

/** Shapes a pending prompt into what the popup shows: kind, plain-language title and text, ranked choices. */
export function classify(prompt: PendingPrompt, ctx: ClassifyContext): Decision {
  const m = prompt.message;
  const choices = choicesOf(m);
  const names = namesFrom(ctx.state, (n) => scName(ctx, n));
  const embedText = (m.embeds ?? [])
    .map((e) => [e.title, e.description].filter(Boolean).join("\n"))
    .join("\n\n");
  const text = cleanText([m.content, embedText].filter(Boolean).join("\n\n"), names);
  const generic = genericTitle(text);
  const base: Decision = {
    id: m.id,
    prompt,
    kind: "generic",
    eyebrow: "",
    title: generic.title,
    text,
    choices,
  };

  if (prompt.reason === "table" || has(choices, /^(deal2SOToAll|startOfGameObjReveal|startOfGameStrategyPhase)$/)) {
    return { ...base, ...tableSetup(choices), kind: "setup", eyebrow: "Setup · anyone can press", table: true, setup: true };
  }
  if (prompt.reason === "setup" || has(choices, /^(discardSecret_|SODISCARD_)\d+/)) {
    const round1 = !ctx.web?.gameRound || ctx.web.gameRound <= 1;
    return {
      ...base,
      kind: "secretDiscard",
      eyebrow: round1 ? "Game setup" : "",
      title: choices.filter((c) => /^(discardSecret_|SODISCARD_)/.test(baseId(c.customId))).length === 2 ? "Keep one secret objective" : "Discard a secret objective",
      text: round1
        ? "You were dealt two secret objectives. Keep one — it stays hidden in your hand until you score it — and discard the other."
        : "You hold more secret objectives than you may keep. Choose one to discard.",
      setup: round1,
    };
  }
  if (/choose your starting tech/i.test(m.content) && !has(choices, /^getTech_/)) {
    return {
      ...base,
      eyebrow: "Game setup",
      title: "Choose your starting technology",
      text: "Your faction starts with a technology of your choice, for free. Press “Get a Technology” to see the options.",
      setup: true,
    };
  }
  if (has(choices, /^sandbagPref_/)) {
    return {
      ...base,
      kind: "generic",
      eyebrow: "Preference · optional",
      title: "Let the bot auto-pass secret scoring?",
      text: "When you cannot score any secret objective in the status phase, the bot can pass for you so nobody waits. You are only asked once.",
      optional: true,
    };
  }
  if (has(choices, /^editRoundSummary_/)) {
    return {
      ...base,
      eyebrow: "Status phase · optional",
      title: "Write a note about this round?",
      text: "Jot down your plans or how things stand with your neighbours. The notes are shown to everyone when the game ends. Nothing waits on this.",
      optional: true,
    };
  }
  if (has(choices, /^(playerPref|setAutoPass|answerSurvey)/)) {
    return { ...base, text: generic.rest, eyebrow: "Preference · optional", optional: true };
  }
  if (has(choices, /^(topAgenda_|bottomAgenda_)/)) {
    const agenda = embeddedAgenda(m);
    return {
      ...base,
      kind: "agendaPeek",
      eyebrow: "Only you see this",
      title: agenda ? `${agenda.name}: top or bottom?` : "Top or bottom of the agenda deck?",
      agenda,
    };
  }
  if (has(choices, ID.scPick)) {
    return { ...base, kind: "scPick", eyebrow: "", title: "Pick a strategy card" };
  }
  if (has(choices, ID.transaction)) {
    const trade = tradeOf(text);
    return { ...base, kind: "transaction", eyebrow: "", title: `${trade.from} offers a trade`, trade };
  }
  if (has(choices, ID.combat) || prompt.reason === "combat") {
    const combat = combatOf(ctx, prompt, choices);
    const step = has(choices, /^(assignHits|getDamageButtons|autoAssign|assignDamage)/) && !has(choices, /^combatRoll/)
      ? "assign hits"
      : "roll dice";
    const kindLabel = combat.kind === "ground" ? "Ground combat" : "Space combat";
    return {
      ...base,
      kind: "combat",
      eyebrow: "",
      title: `${kindLabel} — ${step}`,
      combat,
      position: combat.position,
    };
  }
  if (has(choices, ID.sabotage)) {
    const card = m.embeds?.[0]?.title ? cleanLabel(m.embeds[0].title).replace(/[_*]/g, "") : undefined;
    return {
      ...base,
      kind: "reaction",
      eyebrow: "",
      title: card ? `Sabotage ${card}?` : "Sabotage?",
    };
  }
  if (has(choices, ID.gainTokens)) {
    return { ...base, kind: "gainTokens", title: "Gain command tokens", text };
  }
  if (has(choices, ID.spend)) {
    const inf = has(choices, /_inf(_|$)/);
    const res = has(choices, /_(res\w*|\w*tech|build\w*)$/);
    const what = inf && !res ? "influence" : res && !inf ? "resources" : "resources or influence";
    return { ...base, kind: "spend", title: `Pay with ${what}`, text };
  }
  if (has(choices, ID.whensAfters)) {
    const agenda = currentAgenda(ctx);
    const after = has(choices, /after/i) && !has(choices, /when/i);
    const what = after ? `"After"s` : has(choices, /after/i) ? `"When"s or "After"s` : `"When"s`;
    return {
      ...base,
      kind: "reaction",
      eyebrow: agenda ? `Agenda · ${agenda.name}` : "Agenda phase",
      title: `Play any ${what}?`,
      agenda,
    };
  }
  if (has(choices, ID.agendaVote)) {
    const agenda = currentAgenda(ctx);
    return {
      ...base,
      kind: "agenda",
      eyebrow: "",
      title: agenda ? `Agenda: ${agenda.name} — vote` : "Agenda — vote",
      agenda,
    };
  }
  if (has(choices, /^getTech_/)) {
    const freeAtStart = has(choices, /__noPay__comp$/) && !ctx.web?.strategyCards?.some((sc) => sc.played) && (ctx.web?.gameRound ?? 1) <= 1;
    if (/starting tech/i.test(m.content) || freeAtStart) {
      return {
        ...base,
        kind: "tech",
        eyebrow: "Game setup",
        title: "Choose your starting technology",
        text: "Your faction starts the game with one of these technologies, for free.",
        setup: true,
      };
    }
    return { ...base, kind: "tech", title: "Research a technology" };
  }
  if (prompt.ownCall && has(choices, ID.scFollow)) {
    const sc = scOfFollow(m, choices);
    const name = sc ? scName(ctx, sc) : undefined;
    const second = (prompt.presses ?? 0) >= 1 && has(choices, /^construction_/);
    return {
      ...base,
      kind: "scPrimary",
      eyebrow: "",
      title: second ? `${name ?? "Construction"} — place your second structure` : name ? `Resolve ${name}` : "Resolve your strategy card",
      text: second ? "The card's primary places one more structure (PDS or space dock) on a planet you control." : text,
      choices: second ? choices.filter((c) => !/^constructionPrimary_produce/.test(baseId(c.customId))) : choices,
      sc,
    };
  }
  if (has(choices, ID.scFollow)) {
    const sc = scOfFollow(m, choices);
    const name = sc ? scName(ctx, sc) : undefined;
    const pre = has(choices, /^preDeclineSC_/);
    if (pre) {
      return {
        ...base,
        kind: "scFollow",
        eyebrow: "Plan ahead · optional",
        title: name ? `Decide now: follow ${name}?` : "Decide now whether to follow?",
        text: `${name ?? "This card"} has not been played yet. Decide now and the game will not wait on you when it is.`,
        sc,
        optional: true,
      };
    }
    return {
      ...base,
      kind: "scFollow",
      eyebrow: "",
      title: name ? `Follow ${name}?` : "Follow the strategy card?",
      sc,
    };
  }
  if (has(choices, ID.turn)) {
    const fresh = has(choices, /^tacticalAction/);
    const abilities = has(choices, /^turnEnd/) && !has(choices, /^(endOfTurnAbilities|doAnotherAction)/) && choices.some((c) => c.rank !== "undo" && !/^turnEnd/.test(baseId(c.customId)));
    return {
      ...base,
      kind: "turn",
      eyebrow: "",
      title: fresh ? "Your turn — choose an action" : abilities ? "End of turn — use an ability first?" : "End your turn",
    };
  }
  if (has(choices, ID.tactical)) {
    const ring = choices.map((c) => baseId(c.customId).match(/^ringTile_(\w+)/)?.[1]).filter(Boolean);
    const active = ctx.web?.gameState?.activeSystem ?? undefined;
    return {
      ...base,
      kind: "tactical",
      eyebrow: "",
      title: tacticalTitle(choices, text, ring.length > 0),
      position: ring.length ? undefined : active,
    };
  }
  if (has(choices, /^so_score_hand_/)) {
    return {
      ...base,
      kind: "scoring",
      eyebrow: "Status phase · only you see this",
      title: "Score which secret objective?",
      text: "Score one secret objective you meet now. Scoring one you do not meet is against the rules — nothing checks it for you.",
      scoring: { secretPick: true, lines: [], soHint: secretHint(ctx) },
    };
  }
  if (has(choices, ID.scoring) || isScoringSummary(m)) {
    const lines = scoringSummary(m.content);
    const user = ctx.me ? ctx.state.users[ctx.me.discordId] : undefined;
    const mine = myScoringLine(lines, [ctx.me?.userName, ctx.me?.displayName, user?.global_name ?? undefined, user?.username]);
    return {
      ...base,
      kind: "scoring",
      eyebrow: `Status phase${ctx.web?.gameRound ? ` · round ${ctx.web.gameRound}` : ""}`,
      title: "Score objectives",
      text: "",
      scoring: { lines, mine, soHint: secretHint(ctx) },
    };
  }
  if (has(choices, ID.status)) {
    return { ...base, kind: "status", eyebrow: "", title: "Status phase — tidy up" };
  }
  return { ...base, text: generic.rest, offer: isOffer(text) };
}

const OFFER = /\b(you (?:can|may)(?: choose to)? (?:use|resolve|exhaust|play|purge|spend)|if you (?:wish|want|would like)|use these buttons to resolve (?:the |your )?\S+(?: \S+)?,? the \S+ (?:agent|commander|hero))\b/i;
const MUST = /\b(must|please (?:choose|select|pick|decide|assign|resolve the secondary))\b/i;

/** Prompts that offer an optional ability rather than ask for something the game waits on. */
function isOffer(text: string) {
  return OFFER.test(text) && !MUST.test(text);
}

/** The bot's newest word in my hand thread on whether I can score a secret objective this status phase. */
function secretHint(ctx: ClassifyContext): string | undefined {
  const data = ctx.game.hand ? ctx.state.messages[ctx.game.hand.id] : undefined;
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= Math.max(0, data.ids.length - 40); i--) {
    const m = data.byId[data.ids[i]];
    if (!m?.author.bot) continue;
    if (/does not believe that you can score/i.test(m.content)) return "The game does not think you meet any of your secret objectives.";
    const able = m.content.match(/capable of scoring the following secret objectives?:\s*([\s\S]*)$/i)?.[1];
    if (!able) continue;
    const names = able
      .split("\n")
      .map((l) => l.replace(/<a?:\w+:\d+>/g, "").replace(/[_*]/g, "").replace(/\(\d+\)/, "").trim())
      .filter(Boolean)
      .map((l) => l.split(/\s+[-–—:]\s+/)[0]);
    return names.length ? `The game thinks you meet: ${names.join(", ")}.` : undefined;
  }
  return undefined;
}

/** Friendly copy for the table-wide setup buttons the bot addresses to nobody. */
function tableSetup(choices: Choice[]): { title: string; text: string } {
  if (has(choices, /^deal2SOToAll$/)) {
    return {
      title: "Everyone's set up — deal secret objectives",
      text: "Once every player has their starting technology, deal everyone two secret objectives. Anyone at the table can press this; it only needs pressing once.",
    };
  }
  if (has(choices, /^startOfGameObjReveal$/)) {
    return {
      title: "Start the game",
      text: "When everyone has kept one secret objective, reveal the first public objectives and begin the strategy phase. Anyone at the table can press this.",
    };
  }
  return { title: "Start the strategy phase", text: "Setup is done: begin round 1. Anyone at the table can press this." };
}

function tacticalTitle(choices: Choice[], text: string, choosingSystem: boolean) {
  if (choosingSystem || has(choices, /^(getTilesThisFarAway_|ring_)/)) return "Tactical action — choose a system";
  const placing = choices.map((c) => baseId(c.customId).match(/^place_(\w+?)_/)?.[1]).filter(Boolean);
  if (placing.length && placing.every((u) => u === "pds")) return "Place a PDS — choose a planet";
  if (placing.length && placing.every((u) => u === "sd" || u === "spacedock")) return "Place a space dock — choose a planet";
  if (has(choices, /^(tacticalActionBuild|place_|placeOneNDone)/) || /produce/i.test(text)) return "Produce units";
  if (has(choices, /^(landUnits|doneLanding|planetsTake)/) || /land/i.test(text)) return "Land ground forces";
  if (has(choices, /^(unitTactical|tacticalMoveFrom|doneWithOneSystem|doneMoving|concludeMove)/)) return "Move ships into the system";
  if (has(choices, /^doneWithTacticalAction/)) return "Finish the tactical action";
  return "Tactical action";
}
