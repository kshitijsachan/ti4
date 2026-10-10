import type { Message, PlayState } from "@/discord";
import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";
import { agendas } from "@/entities/data/agendas";
import { actionCards } from "@/entities/data/actionCards";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import type { PendingPrompt } from "../detect/pending";
import type { GameChannels } from "../detect/games";
import { baseId, choicesOf, cleanLabel, idFaction, type Choice } from "./controls";
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
  turn: /^(tacticalAction(?!Build)|componentAction(?!Res)|passingAbilities|passForRound|endOfTurnAbilities|turnEnd|doAnotherAction|confirmSecondAction|strategicAction_)/,
  tactical: /^(ringTile_|getTilesThisFarAway_|ring_|unitTactical|tacticalMoveFrom|doneWithOneSystem|doneMoving|doneLanding|landUnits|tacticalActionBuild|doneWithTacticalAction|concludeMove|planetsTake|place_|placeOneNDone|startCombat|getRaid)/i,
  combat: /^(combatRoll|getDamageButtons|assignHits|retreat_|rollForAmbush|bombardConfirm|assignDamage|autoAssign|automateGroundCombat_)/,
  agendaVote: /^(resolveAgendaVote|vote$|planetOutcomes|outcome|agendaResolution|preVote|exhaustForVotes|abstain|distinguished|planetRider|rider_)/,
  whensAfters: /^(queueAWhen|queueAnAfter|declineToQueueAWhen|declineToQueueAnAfter|no_when|no_after|play_when|play_after|passOnEverythingWhensNAfters|queueWhen_|queueAfter_|lockAftersIn)/,
  transaction: /^(acceptOffer|rejectOffer|resetOffer)/,
  sabotage: /^(no_sabotage|sabotage_)/,
  scoring: /^(po_scoring|po_no_scoring|so_no_scoring|get_so_score_buttons|scoreAnObjective|score_imperial|so_score)/,
  status: /^(redistributeCCButtons|pass_on_abilities)/,
  spend: /^(spend_|reduceTG_|reduceComm_|resetSpend_)/,
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

/** The newest "an agenda has been revealed" post in the action log. */
function latestAgendaReveal(ctx: ClassifyContext): string | undefined {
  const data = ctx.state.messages[ctx.game.actions.id];
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (m?.embeds?.some((e) => /<:Agenda:\d+>/.test(e.title ?? ""))) return m.id;
  }
  return undefined;
}

/** A when / after prompt the table has moved past: an earlier agenda's, or a window that has closed. */
function staleWindow(ctx: ClassifyContext, id: string, window: "when" | "after") {
  const phase = ctx.web?.gameState?.phase ?? "";
  if (/^agenda\.(voting|resolv)/.test(phase)) return true;
  if (window === "after" && /^agenda\.whens/.test(phase)) return true;
  if (window === "when" && /^agenda\.afters/.test(phase)) return true;
  const reveal = latestAgendaReveal(ctx);
  return !!reveal && compareSnowflakes(id, reveal) < 0;
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
  const ids = choices.map((c) => baseId(c.customId));
  const roll = ids.find((id) => /^combatRoll_[^_]+_[^_]+$/.test(id)) ?? ids.find((id) => /^combatRoll_/.test(id));
  const parts = roll?.split("_") ?? [];
  const position = parts[1] ?? name.match(/system-(\w+)-turn/)?.[1];
  const holder = parts[2] ?? "";
  const kind = /ground/i.test(holder) || (!!holder && holder !== "space") || /ground/i.test(prompt.message.content) ? "ground" : "space";
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
    if (it && sides.length)
      sides[sides.length - 1].items.push(
        it[1].replace(/(^|\s)_(.+?)_(?=\s|$)/g, "$1$2").replace(/\*\*/g, "").trim().replace(/^(TG|commodity)$/i, "1 $1"),
      );
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
const NOISE_TEXT = /^\W*(promissory notes|action cards) in your hand|automatically pass on sabos|median time \(in hours\)|your afk times|complete a 1 time survey/i;

export function isNoise(d: Decision): boolean {
  if (d.choices.some((c) => NOISE_ID.test(baseId(c.customId)))) return true;
  return NOISE_TEXT.test(d.prompt.message.content);
}

/** Shapes a pending prompt into what the popup shows: kind, plain-language title and text, ranked choices. */
export function classify(prompt: PendingPrompt, ctx: ClassifyContext): Decision {
  return staleStatusStep(classifyPrompt(prompt, ctx), ctx);
}

function classifyPrompt(prompt: PendingPrompt, ctx: ClassifyContext): Decision {
  const m = prompt.message;
  /* Another faction's locked buttons (FFCC_<them>_…) are never mine to press. */
  const mine = ctx.me?.faction;
  const choices = choicesOf(m)
    .filter((c) => {
      const f = idFaction(c.customId);
      return !f || !mine || f === mine;
    })
    /* Discord conveniences with no meaning here (the map and player areas are always on screen). */
    .filter((c) => !/^(showMap|showPlayerAreas|refreshViewOfSystem|refreshInfoButtons|cardsInfo)$|^showMap|^refreshViewOfSystem_/.test(baseId(c.customId)))
    .map((c) => (baseId(c.customId) === "getModifyTiles" ? { ...c, label: "Edit units (manual fix)" } : c));
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
  if (/you can change your mind|declined to queue an? "?(when|after)/i.test(m.content) && choices.length <= 2) {
    /* "You have declined to queue a when. You can change your mind with this button." — a take-back, not a question. */
    return { ...base, eyebrow: "Optional", title: "Changed your mind?", text: generic.rest || text, optional: true };
  }
  if (has(choices, /^(preVote|resolvePreassignment_)/)) {
    /* "Preset your vote / pre-pass on shenanigans": a shortcut for async play; the real prompt comes in turn. */
    const shenanigans = has(choices, /Shenanigans/i);
    return {
      ...base,
      kind: "agenda",
      eyebrow: "Agenda · optional",
      title: shenanigans ? "Pass on agenda shenanigans ahead of time?" : "Vote or abstain ahead of time?",
      text: shenanigans
        ? "Bribery, Confusing / Confounding Legal Text and Deadly Plot can be played during voting. Pre-passing just saves the table a wait."
        : "Optional: preset your vote now; the game will cast it when your turn to vote comes. It is erased if someone plays an “after”.",
      agenda: currentAgenda(ctx),
      optional: true,
    };
  }
  if (has(choices, /^lockAftersIn$/) && choices.filter((c) => c.rank !== "undo").length === 1) {
    return {
      ...base,
      eyebrow: "Agenda · optional",
      title: "Lock in your “after”?",
      text: "Your queued “after” is cancelled if a player before you in speaker order plays one. Lock it in to play it regardless.",
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
  /* The landing step offers "Roll BOMBARDMENT" alongside "Done Landing Troops": it is a tactical step, not a combat. */
  const landingStep = has(choices, /^(doneLanding|landUnits)/);
  if ((has(choices, ID.combat) && !landingStep) || prompt.reason === "combat") {
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
    const mine = !!ctx.me && text.toLowerCase().startsWith(`${ctx.me.userName.toLowerCase()} played`);
    if (mine) {
      /* My own card: the others get the Sabotage window; nothing for me to answer. */
      return { ...base, kind: "reaction", eyebrow: "", title: `${card ?? "Your card"}: waiting on Sabotage`, optional: true };
    }
    return {
      ...base,
      kind: "reaction",
      eyebrow: "",
      title: card ? `Sabotage ${card}?` : "Sabotage?",
    };
  }
  const leadership = has(choices, /^deleteButtons_leadership$/);
  if (has(choices, ID.gainTokens)) {
    return { ...base, kind: "gainTokens", title: leadership ? "Leadership: gain command tokens" : "Gain command tokens", text };
  }
  if (leadership || (has(choices, ID.spend) && /leadership/i.test(text))) {
    return { ...base, kind: "spend", title: "Leadership: spend influence (3 = 1 token)", text };
  }
  if (has(choices, ID.spend)) {
    const inf = has(choices, /_inf(_|$)/);
    const res = has(choices, /_(res\w*|\w*tech|build\w*)$/);
    const what = inf && !res ? "influence" : res && !inf ? "resources" : "resources or influence";
    if (has(choices, /tech$/)) {
      const tech = lastTechAcquired(ctx, m.id);
      const primary = ctx.me?.scs?.includes(7);
      const cost = primary
        ? "Technology primary: the first technology is free (exhaust nothing, press Done); a second costs 6 resources."
        : ctx.web?.strategyCards?.some((sc) => sc.initiative === 7 && sc.played)
          ? "Technology secondary: 4 resources."
          : "";
      return { ...base, kind: "spend", title: tech ? `Pay for ${tech}` : "Pay for the technology", text: cost ? `${cost}\n\n${text}` : text };
    }
    return { ...base, kind: "spend", title: `Pay with ${what}`, text };
  }
  if (has(choices, ID.whensAfters)) {
    const agenda = currentAgenda(ctx);
    const after = has(choices, /after/i) && !has(choices, /when/i);
    const what = after ? "“after”" : has(choices, /after/i) ? "“when” or “after”" : "“when”";
    const window = after
      ? "After the agenda is revealed and before voting, players may play “after” cards (riders and the like) in speaker order."
      : "Before anything else, players may play “when” cards (like Veto) in speaker order.";
    return {
      ...base,
      kind: "reaction",
      eyebrow: agenda ? `Agenda · ${agenda.name}` : "Agenda phase",
      title: `Play ${after ? "an" : "a"} ${what} card?`,
      text: window,
      agenda,
      /* The table moved past this window (the bot keeps an old prompt when a press changed nothing). */
      optional: staleWindow(ctx, m.id, after ? "after" : "when") || undefined,
    };
  }
  if (has(choices, /^resolveAgendaVote_outcomeTie/)) {
    const agenda = currentAgenda(ctx);
    return {
      ...base,
      kind: "agenda",
      eyebrow: agenda ? `Agenda · ${agenda.name} · speaker` : "Agenda phase · speaker",
      title: "Tied vote — you decide the winner",
      text: "The outcomes below are tied on votes. As speaker, you choose which one wins.",
      agenda,
    };
  }
  if (has(choices, /^rider_/)) {
    const agenda = currentAgenda(ctx);
    const rider = choices.map((c) => baseId(c.customId).match(/^rider_[^_]*_(.+)$/)?.[1]).find(Boolean) ?? "your rider";
    const card = actionCards.find((a) => a.name.toLowerCase() === rider.toLowerCase());
    return {
      ...base,
      kind: "agenda",
      eyebrow: agenda ? `Agenda · ${agenda.name}` : "Agenda phase",
      title: `${rider}: predict the outcome`,
      text: `${card?.text.replace(/^.*?:\s*/, "").replace(/predict aloud/i, "Predict") ?? "Predict an outcome of this agenda."} If a Sabotage cancels the card, the prediction is erased.`,
      agenda,
    };
  }
  if (has(choices, /^agendaResolution_/)) {
    const agenda = currentAgenda(ctx);
    const winner = m.content.match(/current winner is "([^"]+)"/i)?.[1];
    return {
      ...base,
      kind: "agenda",
      eyebrow: agenda ? `Agenda · ${agenda.name} · speaker` : "Agenda phase · speaker",
      title: winner ? `Resolve: ${winnerName(ctx, winner)} wins` : "Resolve the agenda",
      text: "Everyone has voted. Once nobody is playing Bribery, Deadly Plot or a Legal Text card, resolve the agenda with the winning outcome.",
      agenda,
    };
  }
  if (/confirm no _?confusing\/confounding legal texts?/i.test(m.content)) {
    return {
      ...base,
      kind: "reaction",
      eyebrow: "Agenda · after voting",
      title: "Playing Confusing or Confounding Legal Text?",
      text: "These cards change who is elected after the votes are in. Confirm you are not playing them so the speaker can resolve.",
      agenda: currentAgenda(ctx),
      optional: true,
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
      /* Factions that choose two (Argent Flight, …) get one prompt per pick: never offer one already taken. */
      const owned = new Set(ctx.me?.techs ?? []);
      const offered = choices.filter((c) => !owned.has(baseId(c.customId).match(/^getTech_([^_]+)/)?.[1] ?? ""));
      const already = choices.length - offered.length;
      return {
        ...base,
        choices: offered,
        kind: "tech",
        eyebrow: "Game setup",
        title: already ? "Choose another starting technology" : "Choose your starting technology",
        text: already
          ? "Your faction starts with more than one of these. Pick the next one, for free."
          : "Your faction starts the game with one of these technologies, for free.",
        setup: true,
        /* Every offered technology is already mine: this prompt is spent. */
        optional: !offered.some((c) => /^getTech_/.test(baseId(c.customId))),
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
    const fresh = has(choices, /^tacticalAction(?!Build)/);
    const abilities = has(choices, /^turnEnd/) && !has(choices, /^(endOfTurnAbilities|doAnotherAction)/) && choices.some((c) => c.rank !== "undo" && !/^turnEnd/.test(baseId(c.customId)));
    return {
      ...base,
      kind: "turn",
      eyebrow: "",
      title: fresh
        ? "Your turn — choose an action"
        : has(choices, /^passForRound/)
          ? "Pass — use an ability first?"
          : abilities
            ? "End of turn — use an ability first?"
            : "End your turn",
    };
  }
  if (has(choices, /^componentActionRes_/)) {
    return {
      ...base,
      kind: "tactical",
      eyebrow: "Component action",
      title: "Component action — what do you use?",
      choices: choices.map((c) => (baseId(c.customId) === "deleteButtons" ? { ...c, label: "Cancel", rank: "undo" as const } : c)),
      text: "Pick the card, technology, leader or ability whose ACTION you use. “Generic” is for anything not listed (you then resolve it by hand).",
    };
  }
  if (has(choices, /^beginTacticalTeWarfare/)) {
    return {
      ...base,
      kind: "tactical",
      eyebrow: "Warfare",
      title: "Warfare — take a tactical action",
      text: "Activate any system without placing a command token (even one that already has yours). You may redistribute your command tokens before and after.",
    };
  }
  if (has(choices, /^movedNExplored_/)) {
    const trait = choices.map((c) => baseId(c.customId).match(/_(cultural|industrial|hazardous|frontier)$/)?.[1]).find(Boolean);
    const planet = choices
      .find((c) => /^movedNExplored_/.test(baseId(c.customId)))
      ?.label.replace(/^Explore\s+/i, "")
      .replace(/\s*\(\d+\/\d+\)$/, "");
    return {
      ...base,
      kind: "tactical",
      eyebrow: "",
      title: planet ? `Explore ${planet}` : "Explore the planet",
      text: `You took ${planet ?? "a planet"} — draw ${trait ? `a ${trait}` : "an"} exploration card for it.`,
      position: ctx.web?.gameState?.activeSystem ?? undefined,
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
  if (has(choices, /^proceed_to_strategy$/) && !has(choices, /^flip_agenda$/)) {
    return {
      ...base,
      kind: "agenda",
      eyebrow: "Agenda phase · speaker",
      title: "End the agenda phase",
      text: "Both agendas are resolved (finish any riders first). Start the strategy phase of the next round; the agenda cleanup runs automatically.",
    };
  }
  if (has(choices, /^flip_agenda$/)) {
    const n = choices.find((c) => baseId(c.customId) === "flip_agenda")?.label.match(/#\s*(\d+)/)?.[1];
    return {
      ...base,
      kind: "agenda",
      eyebrow: "Agenda phase · speaker",
      title: n === "2" ? "Reveal the second agenda" : "Reveal the agenda",
      text:
        n === "2"
          ? "The first agenda is resolved (finish any riders first). Reveal the second agenda of this phase."
          : "Reveal the top card of the agenda deck. Everyone then gets a chance to play “when” and “after” cards before voting.",
    };
  }
  if (has(choices, /^(startStrategyPhase|startAgendaPhase)$/)) {
    const agenda = has(choices, /^startAgendaPhase$/);
    const noAgenda = /custodians token is still on mecatol rex/i.test(m.content);
    return {
      ...base,
      kind: "status",
      eyebrow: "Status phase · anyone can press",
      title: agenda ? "Start the agenda phase" : "Start the next round",
      text: agenda
        ? "Everyone is done with the status phase. Start the agenda phase: the speaker reveals the first agenda."
        : `Everyone is done with the status phase.${noAgenda ? " There is no agenda phase until someone takes the custodians token from Mecatol Rex." : ""} Start the strategy phase of the next round.`,
      table: true,
    };
  }
  if (has(choices, /(^|_)reveal_stage_/)) {
    const stage2 = has(choices, /reveal_stage_2/) && !has(choices, /reveal_stage_1/);
    return {
      ...base,
      kind: "status",
      eyebrow: "Status phase · anyone can press",
      title: `Reveal the next stage ${stage2 ? "II" : "I"} objective`,
      text: "Everyone has scored. Revealing the next public objective also readies cards, returns command tokens and deals action cards (status-phase cleanup).",
      table: true,
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
  if (has(choices, /^redistributeCCButtons/) && /Warfare/i.test(m.content) && !ctx.web?.gameState?.phase?.startsWith("action")) {
    /* Warfare's leftover "redistribute" from the action phase: over once the phase is. */
    return { ...base, kind: "generic", title: "Redistribute your command tokens", optional: true };
  }
  if (has(choices, /^redistributeCCButtons/) && ctx.web?.gameState?.phase?.startsWith("action")) {
    /* Warfare's "redistribute your command tokens" (before or after its tactical action): optional, nothing waits. */
    return { ...base, kind: "generic", title: "Redistribute your command tokens", text: "Optional, from Warfare.", offer: true };
  }
  if (has(choices, ID.status)) {
    return {
      ...base,
      kind: "status",
      eyebrow: `Status phase${ctx.web?.gameRound ? ` · round ${ctx.web.gameRound}` : ""}`,
      title: "Command tokens, then ready",
    };
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

/** "Winnu" → "Bot Alpha (Winnu)"; other outcomes as they are. */
function winnerName(ctx: ClassifyContext, outcome: string) {
  const p = ctx.web?.playerData.find((x) => x.faction?.toLowerCase() === outcome.toLowerCase() || x.color?.toLowerCase() === outcome.toLowerCase());
  return p ? `${p.userName} (${outcome})` : `“${outcome}”`;
}

/** A status-phase table step left over after the game moved on (an agenda started by command, a new round). */
function staleStatusStep(d: Decision, ctx: ClassifyContext): Decision {
  const phase = ctx.web?.gameState?.phase ?? "";
  if (d.kind !== "status" || !d.table || !phase || phase.startsWith("status")) return d;
  return { ...d, optional: true };
}

/** The technology I acquired just before `beforeId` ("<me> acquired the technology Gravity Drive."), from any channel. */
function lastTechAcquired(ctx: ClassifyContext, beforeId: string): string | undefined {
  const who = [ctx.me?.userName, ctx.me?.faction].filter(Boolean).map((x) => String(x).toLowerCase());
  let best: { id: string; name: string } | undefined;
  for (const data of Object.values(ctx.state.messages)) {
    for (let i = data.ids.length - 1; i >= 0; i--) {
      const id = data.ids[i];
      if (id > beforeId && id.length >= beforeId.length) continue;
      const m = data.byId[id];
      const hit = m?.author.bot ? m.content.match(/acquired the technology (.+?)\.\s*$/m) : null;
      if (!hit) continue;
      if (who.length && !who.some((w) => m.content.toLowerCase().includes(w))) continue;
      if (!best || id.length > best.id.length || (id.length === best.id.length && id > best.id))
        best = { id, name: cleanLabel(hit[1]).replace(/[_*]/g, "").trim() };
      break;
    }
  }
  return best?.name;
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
  const forward = choices.filter((c) => c.rank !== "undo" && c.rank !== "more");
  if (forward.length && forward.every((c) => /^doneWithTacticalAction/.test(baseId(c.customId)))) return "Finish the tactical action";
  if (has(choices, /^placeOneNDone_skipbuild/)) {
    const where = /hope'?s end/i.test(text) ? "Hope's End: " : "";
    const ac = choices.some((c) => /action card/i.test(c.label));
    return `${where}place 1 mech${ac ? " or draw 1 action card" : ""}`.replace(/^p/, (x) => (where ? x : x.toUpperCase()));
  }
  if (has(choices, /^(tacticalActionBuild|place_|placeOneNDone)/) || /produce/i.test(text)) return "Produce units";
  if (has(choices, /^(landUnits|doneLanding|planetsTake)/) || /land/i.test(text)) return "Land ground forces";
  if (has(choices, /^(unitTactical|tacticalMoveFrom|doneWithOneSystem|doneMoving|concludeMove)/)) return "Move ships into the system";
  if (has(choices, /^doneWithTacticalAction/)) return "Finish the tactical action";
  return "Tactical action";
}
