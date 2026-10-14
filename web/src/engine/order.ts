import type { Decision, GameState } from "./contract";
import { openToAll } from "./reducer";
import { factionName } from "./names";
import { nothingToDecide, setupOnly } from "./optionKinds";
import { readDecisionState } from "./draftState";
import { autoDeclinedFollow, owesFollow } from "./follows";
import { sourceName } from "./sourceNames";

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
  "choose.select": "Make a choice",
  "faction.ability": "Faction ability",
  "leader.use": "Use a leader",
  "player.preference": "Preference",
  "te.breach": "Breach",
  "te.breakthrough": "Breakthrough",
  "te.plot": "Plots",
  "ui.undo_affordance": "Undo",
  "ui.optional": "Optional",
  "ui.info_menu": "Info",
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
  "combat.engage": "Engage in combat?",
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
  "game.end": "End the game",
  "units.remove": "Remove units",
  "units.modify": "Change units",
  "production.place": "Place units",
  "action_card.step": "Resolve an action card",
  "action_card.when_after": "Action card window",
  "combat.automate": "Automate combat",
  "combat.bombard": "Bombardment",
  "combat.modifier": "Combat modifiers",
  "commodities.gain": "Gain commodities",
  "component.action": "Component action",
  "promissory_note.resolve": "Resolve a promissory note",
  "relic.use": "Use a relic",
  "strategy_card.construction_build": "Construction: place a structure",
  "tech.step": "Technology",
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
  if (d.kind === "strategy_card.politics_agenda" && d.options.some((o) => politicsPlacement(o.value))) return "Politics: place an agenda";
  if (d.kind === "strategy_card.pre_decline") {
    const sc = d.options.map((o) => (o.value as { strategyCard?: number } | null)?.strategyCard).find((n) => typeof n === "number");
    const card = sc !== undefined ? state?.strategyCards.find((c) => c.number === sc) : undefined;
    if (card) return `Pre-decline ${card.name}`;
  }
  if (d.kind.startsWith("choose.")) {
    const title = chooseTitle(d);
    if (title) return title;
  }
  const typed = TITLES[d.kind];
  if (typed) return typed;
  if (d.kind !== "legacy") {
    const words = d.kind.replace(/[._]/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return promptTitle(d.prompt) || (d.scope === "table" ? "Open to everyone" : "Your move");
}

type ChooseTitleValue = { source?: unknown; choice?: unknown } | null;

/**
 * A choose.* step's title from what asks it (its options' `source`), not the raw kind ("Choose confirm"): Warfare's
 * offers say what they are, others name their card / ability.
 */
function chooseTitle(d: Decision): string {
  const values = d.options.map((o) => o.value as ChooseTitleValue).filter((v): v is NonNullable<ChooseTitleValue> => !!v);
  const source = values.map((v) => v.source).find((x): x is string => typeof x === "string" && !!x);
  if (!source) return "";
  if (source === "warfare") {
    const tactical = values.some((v) => v.source === "warfare" && v.choice === "tactical");
    return tactical ? "Warfare: your primary" : "Warfare: redistribute command tokens?";
  }
  return sourceName(source);
}

/** A turn menu that starts an action (or passes), as opposed to the "end turn" menu once the action is taken. */
export function startsAction(d: Decision): boolean {
  return d.options.some((o) => {
    const a = (o.value as { action?: string } | null)?.action;
    return a === "tactical" || a === "component" || a === "strategic" || a === "pass";
  });
}

/** The redistribute offer of Warfare (before / after its tactical action), no other choice on it. */
function warfareRedistribute(d: Decision): boolean {
  if (d.kind !== "choose.confirm") return false;
  const values = d.options.map((o) => o.value as ChooseTitleValue).filter((v): v is NonNullable<ChooseTitleValue> => !!v);
  return values.length > 0 && values.every((v) => v.source === "warfare" && v.choice === "redistribute");
}

/** The small line above the title: who it is for when it is not just me. */
export function decisionEyebrow(d: Decision, state?: GameState | null): string | null {
  if (d.window) {
    const holder = d.window.subject?.holder;
    /* Only a card a player played names its player (combat windows carry "space" / a planet as their holder). */
    const player = typeof holder === "string" && holder && state?.players.find((p) => p.faction === holder);
    if (player) return `${player.self ? "Your card" : `Played by ${factionName(holder)}`} · every player answers`;
    return "Every player answers";
  }
  if (d.scope === "table") return "Anyone at the table";
  return null;
}

const COMBAT = /^combat\./;
const TACTICAL_STEP = /^tactical\./;
/** Agenda prompts that belong to a running agenda phase only. */
const AGENDA_LIVE = new Set(["agenda.when", "agenda.after", "agenda.vote", "agenda.vote_step", "agenda.rider", "agenda.shenanigans", "agenda.tiebreak", "agenda.resolve", "agenda.next"]);
/** Decide-in-advance prompts the reducer doesn't already treat as background. */
const IN_ADVANCE_EXTRA = new Set(["agenda.preassign"]);
/** Steps of one player's own action; window-less table copies of them are leftovers, not offers. */
const NOT_MINE_AT_TABLE = new Set(["payment.spend", "production.produce", "command_tokens.adjust"]);
const IN_ADVANCE_KINDS = new Set(["strategy_card.pre_decline", "strategy_card.queue_pick"]);
const AGENDA_BLOCKING = new Set(["action_card.sabotage", "agenda.when", "agenda.after", "agenda.vote", "agenda.vote_step", "agenda.tiebreak", "agenda.resolve"]);
/** Table-wide steps that move the phase on: after my own homework, so I'm not asked to start the next phase first. */
const PHASE_STEP = new Set(["status.advance", "setup.deal_secrets", "setup.reveal_objectives", "status.reveal_objective", "agenda.next"]);
/** Hand upkeep answers: what they reopen (the hand panel) is not something I asked to play from. */
const CARD_UPKEEP = new Set(["action_card.discard", "action_card.draw"]);
const HOMEWORK = /^(status\.|command_tokens\.|planet\.ready|secret_objective\.)/;


/**
 * My decisions in the order to answer them (head first), and the background ones behind "Available now":
 * 0. combat (then agenda windows, then a strategy card I owe a follow on: the table waits on it), 1. the next step of what I just answered (pay after build, gain after pay), 3. trade offers to me,
 * 4. everything else oldest first (on my turn: then my turn menu, then reaction windows like follows), 5. table steps that move the phase on (after my
 * homework), 6. the turn menu when it is not my turn, 7. untyped prompts (often leftovers). Perpetual action-card
 * panels go behind "Available now"; prompts I hid are left out.
 */
export function orderDecisions(
  mine: Decision[],
  answeredAtSeq: number | null,
  hidden?: ReadonlySet<string>,
  state?: GameState | null,
  answeredKind?: string | null,
  extra: OrderExtras = {},
): { queue: Decision[]; offers: Decision[] } {
  const { answeredId = null, deferred, superseded } = extra;
  /* Untyped leftovers the game never closed: setup prompts once the game is under way are dropped, info panels
     (nothing but utilities / undo) go behind "Available now". */
  const underWay = !!state && !state.setup && !(state.draft && state.draft.status === "drafting");
  /* A played strategy card is followed / resolved in the action phase only; a window left open past it is moot. */
  const actionPhase = !state || /^action/i.test(state.phase ?? "");
  const agendaPhase = !state || /agenda/i.test(state.phase ?? "") || !!state.agenda;
  /* The status-phase secret list once I declared my secret (scored one, or none): the game leaves it open. */
  const selfId = state?.players.find((p) => p.self)?.userId;
  const secretDeclared = !!selfId && !!state?.status?.players[selfId]?.secretScored;
  /* Politics: once the agendas are drawn (a placement prompt is open), the "draw 2 agendas" prompt is done. */
  const agendasDrawn = mine.some((d) => d.kind === "strategy_card.politics_agenda" && d.options.some((o) => politicsPlacement(o.value)));
  const shown = dedupeOffers(dedupe(
    mine.filter(
      (d) =>
        !hidden?.has(d.id) &&
        !superseded?.has(d.id) &&
        !(d.kind === "legacy" && underWay && setupOnly(d.options)) &&
        !(d.kind === "strategy_card.resolve" && !actionPhase) &&
        !(d.kind === "setup.game_settings" && (underWay || !!state?.draft)) &&
        !(d.kind === "status.score_secret" && (secretDeclared || (!!state && !state.status && !secretScorable(d, state)))) &&
        !(d.kind === "strategy_card.politics_agenda" && agendasDrawn && !d.options.some((o) => politicsPlacement(o.value))) &&
        /* Agenda prompts outside the agenda phase, and when / after windows the agenda already moved past: moot. */
        !(AGENDA_LIVE.has(d.kind) && !agendaPhase) &&
        !(d.kind === "agenda.when" && !!state?.agenda?.whensResolved) &&
        !(d.kind === "agenda.after" && !!state?.agenda?.aftersResolved) &&
        /* Pre-declining a card I hold now (an offer left from before I took it): never mine to follow. Nor a card
           already played: its follow window is what I answer now (pt7: "Pre-decline Warfare" stayed on offer). */
        !(d.kind === "strategy_card.pre_decline" && (preDeclinesMine(d, state, selfId) || preDeclinePlayed(d, state))) &&
        /* My played card once its primary is done and every other player answered it: nothing left on it (pt7). */
        !(d.kind === "strategy_card.resolve" && !!myFactionOf(state) && d.window?.subject?.holder === myFactionOf(state) && !primaryOpen(d) && !(myTurnOf(state) && optionalRepeatLeft(d) && !deferred?.has(d.id)) && settledWindow(d)) &&
        /* Imperial's score list once nothing on it scores, outside the status phase: spent, not an offer (pt9 150:
           it lingered under "Available now" as "Score objectives — You meet none…"). */
        !(d.kind === "status.score" && d.scope === "player" && !!state && !state.status && !publicScorable(d, state, selfId)) &&
        /* A turn menu left open from my last turn: not mine while someone else is taking theirs. */
        !(d.kind === "turn.action" && !!state?.activePlayer && !!selfId && state.activePlayer !== selfId),
    ),
  ));
  /* What my last answer opened. Not the decision I answered itself, re-sent with that answer applied (Warfare's panel
     minus "Redistribute", Imperial's score list): its follow-up leads, not the panel I just used (pt8). */
  const nextStep = (d: Decision) =>
    answeredAtSeq !== null && d.scope === "player" && d.seq > answeredAtSeq && (d.revision ?? 1) <= 2 && d.id !== answeredId;
  /* Perpetual "play an action card" panels sit open all game: on offer, unless one is what my last answer opened. */
  /* …a new card drawn (status phase) reopens it too: only "play an action card" from my turn menu or a card prompt brings it up. */
  /* (Not a discard or a draw: the hand panel reopening after one is not a request to play — pt7 status phase.) */
  const askedForCards =
    !!answeredKind && (answeredKind === "turn.action" || (answeredKind.startsWith("action_card.") && !CARD_UPKEEP.has(answeredKind)));
  /* A hand with nothing playable now (every card greyed) is never what I must do: it stays on offer. */
  const closedCards: Partial<Record<string, string>> = state?.players.find((p) => p.self)?.hand?.closedActionCards ?? {};
  const nothingPlayable = (d: Decision) =>
    d.options.filter((o) => o.value).every((o) => o.disabled || !!closedCards[(o.value as { actionCard?: string }).actionCard ?? ""]);
  const perpetual = (d: Decision) => d.kind === "action_card.play" && !d.window && (nothingPlayable(d) || !(nextStep(d) && askedForCards));
  const myFaction = state?.players.find((p) => p.self)?.faction;
  const myTurn = !!state?.activePlayer && state.players.find((p) => p.self)?.userId === state.activePlayer;
  /* A step of a tactical action is only live while it is my turn (else a leftover of an earlier one). */
  const staleStep = (d: Decision) => TACTICAL_STEP.test(d.kind) && !!state?.activePlayer && !myTurn;
  /* The secret list left open past the status phase: on offer (it never takes the head), until nothing on it scores. */
  const lateSecretList = (d: Decision) => d.kind === "status.score_secret" && !!state && !state.status;
  /* My played card with nothing left to press (Trade resolves when played; every part of the checklist done): only
     "request all resolve now" is left, so it goes behind "Available now" and never takes the panel from my turn. */
  const holdingCard = (d: Decision) => d.kind === "strategy_card.resolve" && !!myFaction && d.window?.subject?.holder === myFaction;
  /* Only an optional repeat left (Technology's second research): open on my turn until I say I am done with it. */
  const repeatOffered = (d: Decision) => myTurn && optionalRepeatLeft(d) && !deferred?.has(d.id);
  const finishedCard = (d: Decision) => holdingCard(d) && !primaryOpen(d) && !repeatOffered(d);
  /* A card I can't follow that the game declined for me (no strategy token…): on offer with the follow greyed and why. */
  const autoDeclined = (d: Decision) => autoDeclinedFollow(d, state);
  /* A setup choice the table waits on (my starting technology): mine to answer now, never an optional offer, even
     when the engine still has it as a table prompt (live pbd283: captured before my faction was known). */
  const requiredSetup = (d: Decision) => requiredSetupChoice(d, state, selfId);
  /* Imperial's "score a public" list once nothing on it scores (I scored one, or meet none): finished, so it never
     takes the panel back from what I'm doing (it stays under "Available now"). */
  const finishedImperial = (d: Decision) => d.kind === "status.score" && d.scope === "player" && !publicScorable(d, state, selfId);
  /* A Warfare redistribute offer while a step of my tactical action is open: optional, it waits behind "Available now"
     so the step leads (playtest 7, pbd436: it sat in front of "Activate a system"). */
  const tacticalOpen = shown.some((d) => TACTICAL_STEP.test(d.kind) && d.scope === "player" && !staleStep(d));
  /* While I take a tactical action, a token editor (Warfare's redistribute) waits behind "Available now": it never pops
     up over a step of the action (pt8: it opened over the landing step). */
  const tokensDuringAction = (d: Decision) => tacticalOpen && d.kind === "command_tokens.adjust" && !state?.status;
  /* My turn menu while a step of my tactical action is open (Thunder's Edge Warfare posts "End turn" before its
     tactical action): the action leads, the menu waits behind "Available now" with End turn greyed (pt9 058). */
  const menuDuringAction = (d: Decision) => tacticalOpen && d.kind === "turn.action" && myTurn && !startsAction(d);
  const background = (d: Decision) =>
    !requiredSetup(d) &&
    (deferred?.has(d.id) ||
    autoDeclined(d) ||
    tokensDuringAction(d) ||
    menuDuringAction(d) ||
    (tacticalOpen && warfareRedistribute(d)) ||
    openToAll(d) ||
    lateSecretList(d) ||
    finishedImperial(d) ||
    finishedCard(d) || IN_ADVANCE_EXTRA.has(d.kind) || perpetual(d) || staleStep(d) || (d.kind === "legacy" && nothingToDecide(d.options)));
  /* Background prompts pile up (a new copy per round / per thread): one entry per title, the newest. Someone else's
     payment or production left open at the table is not on offer to me. */
  const newestByTitle = new Map<string, Decision>();
  for (const d of shown.filter(background)) {
    if (d.scope === "table" && NOT_MINE_AT_TABLE.has(d.kind)) continue;
    const t = decisionTitle(d, state);
    const cur = newestByTitle.get(t);
    if (!cur || d.createdAt > cur.createdAt) newestByTitle.set(t, d);
  }
  const offers = [...newestByTitle.values()].sort((a, b) => a.createdAt - b.createdAt);
  const own = shown.filter((d) => !background(d));
  const homework = own.some((d) => HOMEWORK.test(d.kind) && !PHASE_STEP.has(d.kind));
  const rank = (d: Decision) => {
    /* A combat under way is fought before anything else, even what my last answer opened (landing waits on it). */
    if (COMBAT.test(d.kind)) return 0;
    /* The agenda windows hold up the whole table: answered before anything else of mine. */
    if (AGENDA_BLOCKING.has(d.kind)) return 0.5;
    /* A step of something I am in the middle of (paying for research, placing a structure, producing): it keeps the
       panel; a follow prompt that opens meanwhile waits right behind it (pt9 015 / 017: a new follow pushed aside the
       Pay and PDS placement panels I had open). */
    if (inProgressStep(d)) {
      /* …and among those, the one my last answer just opened leads: Deepwrought's two identical "Get a technology"
         starting prompts — pressing the first opened its type picker, but the older second prompt kept the panel, so
         the press looked lost and a second press was needed (user report; pbd1410's e2e then pressed "Done" on it). */
      return nextStep(d) ? 0.6 : 0.7;
    }
    /* A strategy card I still owe a follow / decline on: the next turn cannot begin until I answer (rules), so it
       heads the queue, before my own turn menu. */
    if (owesFollow(d, selfId, myFaction)) return 0.8;
    /* A step of a strategy card's primary (place a structure, choose a system…): before the card's own panel. */
    if (d.kind.startsWith("strategy_card.") && !d.window && !IN_ADVANCE_KINDS.has(d.kind) && d.kind !== "strategy_card.pick") return 1.4;
    /* The strategy card I played: a part of its primary not done yet is what I do now (before the turn menu that
       offers "End turn"); with only an optional repeat left it waits behind the turn menu. */
    if (d.kind === "strategy_card.resolve" && myFaction && d.window?.subject?.holder === myFaction) {
      if (primaryPartMissing(d)) return 1.5;
      /* Only a repeat left (Construction's second structure, Technology's second research): it leads right after I
         resolved the first one (pt8: it queued behind "Your turn"), until "Done" sets it aside. */
      if (myTurn && !deferred?.has(d.id) && continuesCard(d, answeredId, answeredKind)) return 1.5;
      return 4.6;
    }
    /* Opened since my last answer (stream positions, not clocks): its next step. */
    /* (Not the turn menu: it reopens after everything, and waits behind what the action just started.) */
    if (nextStep(d) && d.kind !== "turn.action" && d.kind !== "trade.offer") return 1;
    /* Untyped prompts come last: the engine can't tell a live one from a leftover the game never closed. */
    if (d.kind === "legacy") return 7;
    /* My turn: the table waits on it, so it goes before follows and other answer-any-time windows (after what is
       already under way for me, like a payment). */
    if (d.kind === "turn.action") return myTurn ? 4.4 : 6;
    /* Reaction windows (follow a strategy card…) after my own prompts: the work under way for me comes first. */
    if (d.window) return 4.5;
    if (PHASE_STEP.has(d.kind)) return homework ? 5 : 4;
    /* Trade offers wait behind my turn, votes, combat and reaction windows: answering one never holds up the table. */
    if (d.kind === "trade.offer") return 4.7;
    return 4;
  };
  const queue = own
    .map((d) => ({ d, r: rank(d) }))
    .sort((a, b) => a.r - b.r || a.d.createdAt - b.d.createdAt || a.d.seq - b.d.seq)
    .map((x) => x.d);
  return { queue, offers };
}

/** Steps of an answer already under way (what I opened: a payment, a placement, a technology pick, a production). */
const IN_PROGRESS = new Set([
  "payment.spend",
  "production.produce",
  "production.place",
  "strategy_card.construction_place",
  "strategy_card.construction_build",
  "strategy_card.diplomacy_system",
  "tech.gain",
  "tech.choose_type",
  "planet.ready",
]);

/** One of my own in-progress steps (player-scoped, no reaction window). */
function inProgressStep(d: Decision): boolean {
  return IN_PROGRESS.has(d.kind) && d.scope === "player" && !d.window;
}

/** See orderDecisions: what besides my decisions decides their order. */
export type OrderExtras = {
  /** The decision my last answer was on. */
  answeredId?: string | null;
  /** Prompts I set aside for now: behind "Available now". */
  deferred?: ReadonlySet<string>;
  /** Older copies of a prompt I answered a newer copy of: left out. */
  superseded?: ReadonlySet<string>;
};

/** Steps a strategy card's primary opens (pick the planet, the technology, pay): answering one continues the card. */
const CARD_STEPS = new Set(["strategy_card.construction_place", "strategy_card.construction_build", "tech.gain", "tech.choose_type", "payment.spend"]);

/** My last answer was on this card, or on a step its primary opened. */
function continuesCard(d: Decision, answeredId: string | null, answeredKind: string | null | undefined): boolean {
  if (answeredId === d.id) return true;
  return !!answeredKind && CARD_STEPS.has(answeredKind) && doneCounts(d).size > 0;
}

function myTurnOf(state: GameState | null | undefined): boolean {
  const me = state?.players.find((p) => p.self)?.userId;
  return !!me && state?.activePlayer === me;
}

/**
 * A starting-technology prompt that is mine while setup waits on me for one: aimed at me, or (no target yet) offered
 * while I am the one still owing starting technologies.
 */
export function requiredSetupChoice(d: Decision, state: GameState | null | undefined, selfId: string | undefined): boolean {
  if ((d.kind !== "tech.gain" && d.kind !== "tech.choose_type") || !selfId || !state?.setup) return false;
  if (!d.options.some((o) => (o.value as { starting?: boolean } | null)?.starting)) return false;
  const owing = state.setup.players.find((p) => p.userId === selfId)?.startingTechsNeeded ?? 0;
  if (owing <= 0) return false;
  return d.target?.userId === selfId || (!d.target?.userId && state.setup.players.filter((p) => p.startingTechsNeeded > 0).length === 1);
}

type ResolveValue = { who?: string; action?: string; part?: string | null; primaryParts?: string[] } | null;

/** My card's primary checklist (empty: a card with nothing to resolve by hand). */
function checklist(d: Decision): string[] {
  for (const o of d.options) {
    const p = (o.value as ResolveValue)?.primaryParts;
    if (Array.isArray(p) && p.length > 0) return p;
  }
  return [];
}

/** How often each part is done: the engine's primaryDone, or what I pressed on this page (whichever says more). */
function doneCounts(d: Decision): Map<string, number> {
  const count = (list: string[]) => list.reduce((m, p) => m.set(p, (m.get(p) ?? 0) + 1), new Map<string, number>());
  const engine = count(((d.window?.subject as { primaryDone?: unknown } | undefined)?.primaryDone as string[] | undefined) ?? []);
  const pressedParts = (readDecisionState<string[]>(d.id, "pressed") ?? [])
    .map((id) => (d.options.find((o) => o.id === id)?.value as ResolveValue)?.part)
    .filter((p): p is string => typeof p === "string");
  const page = count(pressedParts);
  for (const [p, n] of page) engine.set(p, Math.max(engine.get(p) ?? 0, n));
  return engine;
}

/**
 * Whether my card's primary still has something to press: a checklist part not done as often as listed, or (a card
 * without a checklist) any primary option besides "request all resolve now".
 */
export function primaryOpen(d: Decision): boolean {
  const parts = checklist(d);
  if (!parts.length) {
    /* Typed primary options only: untyped utilities on the card's message (Transaction, Send 1 Trade Good) are not. */
    return d.options.some((o) => {
      const v = o.value as ResolveValue;
      return !o.disabled && !!v && v.who !== "others" && v.action !== "request_all";
    });
  }
  const done = doneCounts(d);
  return [...new Set(parts)].some((p) => (done.get(p) ?? 0) < parts.filter((x) => x === p).length);
}

/**
 * Whether a part of my card's primary has not been done at all (Politics' "draw 2 action cards" after the agendas):
 * then the card leads, ahead of my turn menu, until it is pressed. A repeat that is left (Construction's optional
 * second structure) does not: the card then waits behind my turn menu.
 */
export function primaryPartMissing(d: Decision): boolean {
  const parts = checklist(d);
  if (!parts.length) return primaryOpen(d) && doneCounts(d).size === 0 && !(readDecisionState<string[]>(d.id, "pressed") ?? []).length;
  const done = doneCounts(d);
  return parts.some((p) => !done.get(p));
}

/**
 * Primary parts a holder may repeat beyond the checklist: Technology's second research (6 resources). The engine
 * lists the card's primary as ["research"] and allows a second press.
 */
const OPTIONAL_REPEAT: Record<string, number> = { research: 1 };

/** Every checklist part is done and an optional repeat (Technology's second research) is still left. */
export function optionalRepeatLeft(d: Decision): boolean {
  const parts = checklist(d);
  if (!parts.length || primaryOpen(d)) return false;
  const done = doneCounts(d);
  return Object.entries(OPTIONAL_REPEAT).some(([p, extra]) => parts.includes(p) && (done.get(p) ?? 0) < parts.filter((x) => x === p).length + extra);
}

/** A Politics "place this agenda" option (top / bottom / discard), as opposed to "draw 2 agendas". */
function politicsPlacement(value: unknown): boolean {
  const a = (value as { action?: string } | null)?.action;
  return a === "top" || a === "bottom" || a === "discard";
}

function myFactionOf(state: GameState | null | undefined): string | undefined {
  return state?.players.find((p) => p.self)?.faction ?? undefined;
}

/** Every player the window waits on has answered it. */
function settledWindow(d: Decision): boolean {
  const w = d.window;
  return !!w && w.eligible.length > 0 && w.eligible.every((u) => w.responded.includes(u));
}

/** A pre-decline offer for a card that is already played (pre-declining is for cards not played yet). */
function preDeclinePlayed(d: Decision, state: GameState | null | undefined): boolean {
  if (!state) return false;
  const sc = d.options.map((o) => (o.value as { strategyCard?: number } | null)?.strategyCard).find((n) => typeof n === "number");
  return sc !== undefined && state.strategyCards.some((c) => c.number === sc && c.played);
}

/** A pre-decline offer for a strategy card I hold. */
function preDeclinesMine(d: Decision, state: GameState | null | undefined, selfId: string | undefined): boolean {
  if (!selfId || !state) return false;
  const sc = d.options.map((o) => (o.value as { strategyCard?: number } | null)?.strategyCard).find((n) => typeof n === "number");
  return sc !== undefined && state.strategyCards.some((c) => c.number === sc && c.holder === selfId);
}

type PublicScoreValue = { action?: string; objective?: string; eligible?: string[] } | null;

/** Whether a score list has a public objective I meet and have not scored yet. */
export function publicScorable(d: Decision, state: GameState | null | undefined, selfId: string | undefined): boolean {
  if (!selfId) return true;
  return d.options.some((o) => {
    const v = o.value as PublicScoreValue;
    if (!v || o.disabled || v.action !== "score_public" || !v.objective) return false;
    return !!v.eligible?.includes(selfId) && !state?.publicObjectives?.[v.objective]?.includes(selfId);
  });
}

type SecretValue = { met?: boolean | null; phase?: string } | null;

/**
 * Whether the status-phase secret list has a secret I could score now: not disabled, not known unmet, and (in the
 * status phase) a status-phase secret. The list stays open after I scored or declined; with nothing to score it is moot.
 */
export function secretScorable(d: Decision, state?: GameState | null): boolean {
  const inStatus = !!state?.status;
  return d.options.some((o) => {
    const v = o.value as SecretValue;
    if (!v || o.disabled || v.met === false) return false;
    return !inStatus || !v.phase || v.phase === "status";
  });
}

type PillageValue = { id?: string; target?: string; action?: string } | null;

/** The faction a Pillage offer (Mentak) is about, or undefined when the decision is not one. */
export function pillageTarget(d: Decision): string | undefined {
  if (d.kind !== "faction.ability") return undefined;
  for (const o of d.options) {
    const v = o.value as PillageValue;
    if (v?.id === "pillage" && v.target) return v.target;
  }
  return undefined;
}

/**
 * Stacked Pillage offers (one per trade good the neighbour gained: pt8 had 5–6 in a row): one per neighbour, the
 * newest; answering it supersedes the older ones (see FactionStep).
 */
function dedupeOffers(list: Decision[]): Decision[] {
  const newest = new Map<string, Decision>();
  for (const d of list) {
    const t = pillageTarget(d);
    if (!t) continue;
    const cur = newest.get(t);
    if (!cur || d.createdAt > cur.createdAt || (d.createdAt === cur.createdAt && d.seq > cur.seq)) newest.set(t, d);
  }
  if (!newest.size) return list;
  return list.filter((d) => {
    const t = pillageTarget(d);
    return !t || newest.get(t) === d;
  });
}

/** One prompt per played strategy card (its message and its thread can both carry it): the newest. */
function dedupe(list: Decision[]): Decision[] {
  const newest = new Map<string, Decision>();
  for (const d of list) {
    const sc = d.kind === "strategy_card.resolve" ? d.window?.subject?.strategyCard : undefined;
    if (sc === undefined) continue;
    const key = `sc:${JSON.stringify(sc)}`;
    const cur = newest.get(key);
    if (!cur || d.createdAt > cur.createdAt) newest.set(key, d);
  }
  return list.filter((d) => {
    const sc = d.kind === "strategy_card.resolve" ? d.window?.subject?.strategyCard : undefined;
    return sc === undefined || newest.get(`sc:${JSON.stringify(sc)}`) === d;
  });
}
