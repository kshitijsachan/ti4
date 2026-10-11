import { useMemo } from "react";
import type { Decision, GameState } from "./contract";
import { openToAll } from "./reducer";
import { factionName } from "./names";
import { useEngine, useMyDecisions } from "./store";
import { nothingToDecide, setupOnly } from "./optionKinds";

/** Plain-words titles per kind; `legacy` (untyped) prompts take a title from their own text. */
const TITLES: Record<string, string> = {
  "strategy_card.pick": "Pick a strategy card",
  "strategy_card.resolve": "Strategy card",
  "strategy_card.pre_decline": "Pre-decline a strategy card",
  "strategy_card.queue_pick": "Queue a strategy card pick",
  "strategy_card.construction_place": "Construction: place a structure",
  "strategy_card.diplomacy_system": "Diplomacy: choose a system",
  "strategy_card.politics_agenda": "Politics: look at the agenda deck",
  "strategy_card.politics_speaker": "Politics: choose the speaker",
  "strategy_card.strategic_action": "Strategic action",
  "tech.gain": "Research a technology",
  "tech.choose_type": "Choose a technology type",
  "secret_objective.discard": "Keep a secret objective",
  "draft.milty.pick": "Your draft pick",
  "draft.milty.queue": "Queue a draft pick",
  "draft.milty.info": "Draft",
  "setup.game_settings": "Game settings",
  "setup.player": "Set up your faction",
  "setup.preference": "Setup preference",
  "setup.keleres_flavor": "Choose a Keleres flavour",
  "setup.keleres_tech": "Keleres starting technology",
  "setup.deal_secrets": "Deal secret objectives",
  "setup.reveal_objectives": "Reveal objectives and start",
  "turn.action": "Your turn",
  "tactical.activate": "Activate a system",
  "tactical.move": "Move ships",
  "tactical.land": "Land ground forces",
  "tactical.rift": "Gravity rift",
  "tactical.conclude": "Finish the tactical action",
  "production.produce": "Produce units",
  "payment.spend": "Pay",
  "planet.ready": "Ready planets",
  "command_tokens.adjust": "Command tokens",
  "combat.round": "Combat",
  "combat.hits": "Assign hits",
  "combat.assign_hits": "Assign hits",
  "combat.assign_units": "Choose units",
  "combat.retreat": "Retreat?",
  "action_card.play": "Play an action card",
  "action_card.resolve": "Resolve an action card",
  "action_card.target": "Choose a target",
  "action_card.sabotage": "Sabotage?",
  "action_card.discard": "Discard action cards",
  "action_card.draw": "Draw action cards",
  "action_card.preassign": "Plan an action card",
  "promissory_note.play": "Promissory note",
  "explore.planet": "Explore",
  "explore.card_pick": "Choose an exploration card",
  "explore.outcome": "Exploration",
  "explore.frontier": "Explore the frontier",
  "relic.draw": "Relic",
  "relic.fragments": "Purge relic fragments",
  "agenda.when": "Agenda: whens",
  "agenda.after": "Agenda: afters",
  "agenda.vote": "Vote on the agenda",
  "agenda.vote_step": "Vote on the agenda",
  "agenda.rider": "Agenda: riders",
  "agenda.shenanigans": "Agenda: shenanigans",
  "agenda.tiebreak": "Break the agenda tie",
  "agenda.resolve": "Resolve the agenda",
  "agenda.next": "Next agenda",
  "agenda.preassign": "Plan your agenda play",
  "status.score": "Score objectives",
  "status.score_secret": "Score a secret objective",
  "status.homework": "Status phase",
  "status.ready": "Ready for the agenda phase",
  "status.advance": "Continue",
  "status.imperial": "Imperial point",
  "status.reveal_objective": "Reveal the next objective",
  "trade.offer": "Trade offer",
  "trade.offer_sent": "Your trade offer",
  "trade.force_replenish": "Replenish commodities",
  "te.expedition": "Expedition",
  "te.fracture.roll": "The Fracture",
  "te.fracture.ingress": "Fracture ingress",
  "te.galvanize": "Galvanize",
  "te.thunders_edge.place": "Thunder's Edge",
  "te.visionaria.respond": "Visionaria",
  "token_ingress.png": "Place an ingress token",
  "input.form": "Fill in",
};

/** First line of an untyped prompt's text as a title: no markdown, mentions or emoji; empty when there is none. */
function promptTitle(prompt: string | null | undefined): string {
  if (!prompt) return "";
  const line = prompt
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/<@[!&]?\d+>\s*/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/[*_~`>#|]/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .find((l) => l.length > 2);
  if (!line) return "";
  return line.length > 64 ? `${line.slice(0, 61).replace(/\s+\S*$/, "")}…` : line;
}

/** A decision's title for the popup head, the queue and the header pill. */
export function decisionTitle(d: Decision, state?: GameState | null): string {
  if (d.kind === "strategy_card.resolve") {
    const sc = d.window?.subject?.strategyCard;
    const card = typeof sc === "number" ? state?.strategyCards.find((c) => c.number === sc) : undefined;
    if (card) {
      const mine = card.holder && state?.players.find((p) => p.self)?.userId === card.holder;
      return mine ? `${card.name}: your primary` : `Follow ${card.name}?`;
    }
  }
  const typed = TITLES[d.kind];
  if (typed) return typed;
  if (d.kind !== "legacy") {
    const words = d.kind.replace(/[._]/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return promptTitle(d.prompt) || (d.scope === "table" ? "Open to everyone" : "Your move");
}

/** The small line above the title: who it is for when it is not just me. */
export function decisionEyebrow(d: Decision): string | null {
  if (d.window) {
    const holder = d.window.subject?.holder;
    if (typeof holder === "string" && holder) return `Played by ${factionName(holder)} · every player answers`;
    return "Every player answers";
  }
  if (d.scope === "table") return "Anyone at the table";
  return null;
}

const COMBAT = /^combat\./;
/** Table-wide steps that move the phase on: after my own homework, so I'm not asked to start the next phase first. */
const PHASE_STEP = new Set(["status.advance", "setup.deal_secrets", "setup.reveal_objectives", "status.reveal_objective", "agenda.next"]);
const HOMEWORK = /^(status\.|command_tokens\.|planet\.ready|secret_objective\.)/;


/**
 * My decisions in the order to answer them (head first), and the background ones behind "Available now":
 * 1. the next step of what I just answered (pay after build, gain after pay), 2. combat, 3. trade offers to me,
 * 4. everything else oldest first, 5. table steps that move the phase on (after my homework), 6. my turn menu,
 * which stays up while what it spawned is answered, 7. untyped prompts (often leftovers). Prompts I hid are left out.
 */
export function orderDecisions(
  mine: Decision[],
  answeredAtSeq: number | null,
  hidden?: ReadonlySet<string>,
  state?: GameState | null,
): { queue: Decision[]; offers: Decision[] } {
  /* Untyped leftovers the game never closed: setup prompts once the game is under way are dropped, info panels
     (nothing but utilities / undo) go behind "Available now". */
  const underWay = !!state && !state.setup && !(state.draft && state.draft.status === "drafting");
  const shown = mine.filter((d) => !hidden?.has(d.id) && !(d.kind === "legacy" && underWay && setupOnly(d.options)));
  const background = (d: Decision) => openToAll(d) || (d.kind === "legacy" && nothingToDecide(d.options));
  const offers = shown.filter(background);
  const own = shown.filter((d) => !background(d));
  const homework = own.some((d) => HOMEWORK.test(d.kind) && !PHASE_STEP.has(d.kind));
  const rank = (d: Decision) => {
    /* Opened since my last answer (stream positions, not clocks): its next step. */
    if (answeredAtSeq !== null && d.scope === "player" && d.seq > answeredAtSeq && (d.revision ?? 1) <= 2) return 1;
    /* Untyped prompts come last: the engine can't tell a live one from a leftover the game never closed. */
    if (d.kind === "legacy") return 7;
    if (d.kind === "turn.action") return 6;
    if (PHASE_STEP.has(d.kind)) return homework ? 5 : 4;
    if (COMBAT.test(d.kind)) return 2;
    if (d.kind === "trade.offer") return 3;
    return 4;
  };
  const queue = own
    .map((d) => ({ d, r: rank(d) }))
    .sort((a, b) => a.r - b.r || a.d.createdAt - b.d.createdAt || a.d.seq - b.d.seq)
    .map((x) => x.d);
  return { queue, offers };
}

/** My decisions in answering order, live (the popup's queue; background prompts excluded). */
export function useMyQueue(): Decision[] {
  const mine = useMyDecisions();
  const answeredAtSeq = useEngine((s) => s.lastAnswer?.seq ?? null);
  const hidden = useEngine((s) => s.hidden);
  const state = useEngine((s) => s.view.state);
  return useMemo(() => orderDecisions(mine, answeredAtSeq, hidden, state).queue, [mine, answeredAtSeq, hidden, state]);
}
