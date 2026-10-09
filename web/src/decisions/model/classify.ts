import type { Message, PlayState } from "@/discord";
import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import { getStrategyCardByInitiative } from "@/entities/lookup/strategyCards";
import { agendas } from "@/entities/data/agendas";
import type { PendingPrompt } from "../detect/pending";
import type { GameChannels } from "../detect/games";
import { baseId, choicesOf, cleanLabel, type Choice } from "./controls";
import { cleanText, firstLine, namesFrom } from "./text";

export type DecisionKind =
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
  /** System the prompt is about, for the map highlight. */
  position?: string;
  /** Can be answered ahead of time but nothing waits on it yet (pre-declining a card): listed last. */
  optional?: boolean;
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
  turn: /^(tacticalAction|componentAction|passingAbilities|endOfTurnAbilities|turnEnd|doAnotherAction|strategicAction_)/,
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

/** The agenda currently on the table: the newest "an agenda has been revealed" embed in the action log. */
export function currentAgenda(ctx: ClassifyContext): AgendaInfo | undefined {
  const data = ctx.state.messages[ctx.game.actions.id];
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    const embed = m?.embeds?.find((e) => /<:Agenda:\d+>/.test(e.title ?? ""));
    if (!embed?.title) continue;
    const name = cleanLabel(embed.title).replace(/[_*]/g, "").trim();
    const known = agendas.find((a) => a.name.toLowerCase() === name.toLowerCase());
    const head = embed.description?.match(/\*\*(\w+):\*\*\s*\*([^*]+)\*/);
    return {
      name,
      type: known?.type ?? head?.[1],
      target: known?.target ?? head?.[2],
      text1: known?.text1,
      text2: known?.text2,
    };
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
    if (it && sides.length) sides[sides.length - 1].items.push(it[1].trim());
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
  const bare = sentence.replace(/^[\w' -]{1,32},\s+/, "").replace(/[.:]$/, "").trim();
  if (!bare || bare.length > 72) return { title: "The game needs your answer", rest: text };
  const title = bare.charAt(0).toUpperCase() + bare.slice(1);
  const idx = text.indexOf(sentence.slice(-Math.min(sentence.length, 24)));
  const rest = idx >= 0 ? text.slice(idx + Math.min(sentence.length, 24)).replace(/^[\s*_]+/, "") : text;
  return { title, rest: rest.trim() };
}

function phaseEyebrow(ctx: ClassifyContext, fallback: string) {
  const phase = ctx.web?.gameState?.phase?.split(".")[0];
  const round = ctx.web?.gameRound;
  const label = phase ? `${phase.charAt(0).toUpperCase()}${phase.slice(1)} phase` : fallback;
  return round ? `Round ${round} · ${label}` : label;
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
    eyebrow: phaseEyebrow(ctx, "Decision"),
    title: generic.title,
    text: generic.rest,
    choices,
  };

  if (has(choices, ID.scPick)) {
    return { ...base, kind: "scPick", eyebrow: phaseEyebrow(ctx, "Strategy phase"), title: "Pick a strategy card" };
  }
  if (has(choices, ID.transaction)) {
    const trade = tradeOf(text);
    return { ...base, kind: "transaction", eyebrow: "Trade offer", title: `${trade.from} offers a trade`, trade };
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
      eyebrow: `Combat${combat.position ? ` · system ${combat.position}` : ""}`,
      title: `${kindLabel}${combat.round ? ` round ${combat.round}` : ""} — ${step}`,
      combat,
      position: combat.position,
    };
  }
  if (has(choices, ID.sabotage)) {
    const card = m.embeds?.[0]?.title ? cleanLabel(m.embeds[0].title).replace(/[_*]/g, "") : undefined;
    return {
      ...base,
      kind: "reaction",
      eyebrow: "Reaction window",
      title: card ? `Sabotage ${card}?` : "Sabotage?",
    };
  }
  if (has(choices, ID.gainTokens)) {
    return { ...base, kind: "gainTokens", title: "Gain command tokens", text };
  }
  if (has(choices, ID.spend)) {
    const inf = has(choices, /_inf(_|$)/);
    const res = has(choices, /_res(_|$)|_tech|_build/);
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
      eyebrow: phaseEyebrow(ctx, "Agenda phase"),
      title: agenda ? `Agenda: ${agenda.name} — vote` : "Agenda — vote",
      agenda,
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
      eyebrow: phaseEyebrow(ctx, "Action phase"),
      title: name ? `Follow ${name}?` : "Follow the strategy card?",
      sc,
    };
  }
  if (has(choices, ID.turn)) {
    const fresh = has(choices, /^tacticalAction/);
    return {
      ...base,
      kind: "turn",
      eyebrow: phaseEyebrow(ctx, "Action phase"),
      title: fresh ? "Your turn — choose an action" : "Finish your turn",
    };
  }
  if (has(choices, ID.tactical)) {
    const ring = choices.map((c) => baseId(c.customId).match(/^ringTile_(\w+)/)?.[1]).filter(Boolean);
    const active = ctx.web?.gameState?.activeSystem ?? undefined;
    return {
      ...base,
      kind: "tactical",
      eyebrow: phaseEyebrow(ctx, "Tactical action"),
      title: tacticalTitle(choices, text, ring.length > 0),
      position: ring.length ? undefined : active,
    };
  }
  if (has(choices, ID.scoring)) {
    return { ...base, kind: "scoring", eyebrow: phaseEyebrow(ctx, "Status phase"), title: "Score objectives" };
  }
  if (has(choices, ID.status)) {
    return { ...base, kind: "status", eyebrow: phaseEyebrow(ctx, "Status phase"), title: "Status phase — tidy up" };
  }
  return base;
}

function tacticalTitle(choices: Choice[], text: string, choosingSystem: boolean) {
  if (choosingSystem || has(choices, /^(getTilesThisFarAway_|ring_)/)) return "Tactical action — choose a system";
  if (has(choices, /^(tacticalActionBuild|place_|placeOneNDone)/) || /produce/i.test(text)) return "Produce units";
  if (has(choices, /^(landUnits|doneLanding|planetsTake)/) || /land/i.test(text)) return "Land ground forces";
  if (has(choices, /^(unitTactical|tacticalMoveFrom|doneWithOneSystem|doneMoving|concludeMove)/)) return "Move ships into the system";
  if (has(choices, /^doneWithTacticalAction/)) return "Finish the tactical action";
  return "Tactical action";
}
