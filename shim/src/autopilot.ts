import type { Hub } from "./hub.js";
import type { Clients } from "./clients.js";
import type { Json, StoredMessage } from "./store.js";
import { log } from "./log.js";
import { Brain } from "./botplay/brain.js";
import { parseBoard, type Board } from "./botplay/board.js";
import { controlsOf, type Control, type Prompt } from "./botplay/prompts.js";
import type { Seat, SeatEngine } from "./botplay/seat.js";
import { TradeDesk } from "./botplay/trade.js";
import { LegacyTradeDesk } from "./botplay/tradeLegacy.js";
import type { EngineClient } from "./engine/client.js";
import { chooseTyped } from "./engine/autopilot.js";
import { answersOutsideWindow, awaits, type AnswerResult } from "./engine/types.js";
import { isTableSetupStep } from "./engine/policy/setup.js";
import { productionPayload } from "./engine/policy/production.js";

/*
 * Autopilot seats: a seat flagged `autopilot` is played by the shim so one person can try the game alone.
 *
 * Each autopilot is a virtual browser client (Clients.attachVirtual): it gets the frames that seat's browser
 * would get and presses buttons with the same `click` / `select` ops, so the bot cannot tell it from a person.
 * Its policy is a table of heuristics over the bot's button custom ids and labels (see RULES): take the first
 * legal draft pick, prefer some strategy cards, play the strategy card then pass, decline every reaction window,
 * abstain on agendas, roll dice and auto-assign hits, reject trades, and otherwise answer prompts addressed to it
 * with their first sensible button. With ANTHROPIC_API_KEY set, prompts no rule covers are put to Claude.
 */

type Choice = {
  msg: StoredMessage;
  control: Control;
  score: number;
  why: string;
};

type GameState = {
  phase: string | null;
  active: string | null;
  colors: Map<string, string>;
  combat: boolean;
  /** The current combat's round and the colors fighting it (web data). */
  combatRound: number | null;
  combatColors: string[];
  /** Per seated player (user id): faction and the technologies it owns. */
  players: Map<string, { faction: string; techs: number; owned: string[] }>;
};

type Ctx = {
  /** Names this seat and nobody else, carries its faction's buttons, is only visible to it, or is in its own thread. */
  addressed: boolean;
  /** Addressed to this seat: ephemeral for it, mentions it, its faction's buttons, its threads, replies to it. */
  direct: boolean;
  /**
   * Certainly waiting on this seat: only it can see the message, the buttons carry its faction, or the bot posted
   * it in answer to this seat's own press. Only these get the "first option" fallback.
   */
  strong: boolean;
  faction?: string;
};

type Rule = {
  /** Matched against the custom id (or `label` against the label). */
  id?: RegExp;
  label?: RegExp;
  score: number;
  why: string;
  /** Table-wide windows every player answers (strategy card follows, sabotage, whens/afters, scoring). */
  table?: boolean;
  /** Among several matching controls of one message, take the last instead of the first. */
  last?: boolean;
  /** May be pressed on a message we already answered (scoring asks for a public and a secret objective). */
  again?: boolean;
  /** Answered by a typed engine kind (engine/policy/*) when the engine is on: the rule only runs without it. */
  typed?: boolean;
  /** Ranks matching controls (lower first). */
  rank?: (c: Control) => number;
  /**
   * Only on prompts that name this seat (or carry its faction's buttons, or only it can see): starting-technology
   * buttons are not faction-locked, and the bot gives the technology to whoever presses.
   */
  addressed?: boolean;
  /** Not a control we chose (by label) in this channel in the last 10 minutes: a second starting technology. */
  distinct?: boolean;
  /**
   * The bot deletes this prompt once it acts on the press: if it is still there, unchanged, RETRY_MS after we
   * pressed, the press was lost (e.g. refused while the bot was busy with the game) and we press it again.
   */
  retry?: boolean;
  /** Retry only while the game phase matches (setup prompts: never once the game is under way). */
  retryIn?: RegExp;
  /**
   * Only while the game is in a matching phase (the bot's web-data phase, e.g. `status.homework`). Table windows stay
   * on the table after their phase ends, and the bot acts on a late press anyway: a "Ready For Strategy Phase" pressed
   * in the next action phase ends that round on the spot.
   */
  phase?: RegExp;
};

/** Strategy cards an autopilot likes, best first (1 Leadership, 7 Technology, 8 Imperial, 6 Warfare, ...). */
const SC_PREFERENCE = [1, 7, 8, 6, 5, 4, 3, 2];
/** How long a typed decision belongs to the engine path before the legacy rules may answer it (see engineOwns). */
const ENGINE_GRACE_MS = 90_000;
/** At most this many engine answers from one seat to one decision (multi-part answers walk a few options). */
const ENGINE_MAX_ANSWERS = 8;

/** Never pressed: take-backs, admin / settings, info, modals, and actions with real consequences we do not plan.
 * The strategy-card pick queue too: the planner picks when it is up, and the fallback filled the queue, pressed its
 * only button left ("Restart Queue") and filled it again, forever (pbd26). */
const BLOCKED_ID =
  /(ultimateUndo|^undo|deleteButtons|queueScPick_|restartSCQueue|requestAllFollow|moveAlongAfterAllHaveReacted|^transaction$|getModifyTiles|showMap|showPlayerAreas|offerPlayerPref|searchMyGames|showObjInfo|chooseMapView|resolvePreassignment_(?!Abstain On Agenda$|Pass On Shenanigans$)|^queueAWhen|^queueAnAfter|^preVote|unlockQueued|distinguished_|eraseMy|proceedToVoting|pingNonresponders|refreshAgenda|refresh|notepad|cardsInfo|showGameAgain|offerDeckButtons|gameInfoButtons|miltyFactionInfo|showMiltyDraft|checkCombatACs|announceARetreat|^retreat_|getRepairButtons|announceReadyForDice|ac_play_from_hand|getDiscardButtonsACs|^sabotage_|forceAbstain|tacticalAction|componentAction|doAnotherAction|endTurnWhenAllReactedTo|^jmf|chooseExp_|setupBaseGameMode|startTFGame|frankenSetup|offerGameOptionButtons|getHomebrewButtons|offerTEOptionButtons|miltySetup|startDraftSystem|addMapString|~MDL|sendTradeHolder|acceptOffer|resetOffer|resetMyVote|wrongButtonEphemeral|leadershipGenerateCCButtons|redistributeCCButtons|^sc_follow|^sc_trade_follow|toggleTfHomebrew|gain_CC|deal2SOToAll|startOfGameObjReveal|run_status_cleanup|^showDeck|^offerInfoButtons|^setPath_|^bindsToGame|^applytoreceive|^getStartingTech|purge|^draftPresets|startPlayerSetup|setupPlayer|^player_setup|purgeOverrule|queueMil|MiltyQueue|drawSpecificSO|get_so_discard_buttons|answerSurvey|noSupportSwaps|offerSurvey|draftPresetKeleres|explain|preScoreObbie|^reduceTG|^reduceComm|resetSpend|^exhaust|^spend|^sc_(?!no_follow|3_assign_speaker_to_)|^score|_score|^po_scoring|^get_so_|endGameMostPoints|^rematch|reveal_stage_none|checkForAllACAssignments|increase_(fleet|strategy|tactic)_cc|getDamageButtons|^assignHits_|^assign_|^remove_|removeThisTypeOfUnit|removeNCaptureThisTypeOfUnit|removeAll|^destroy|^sustain|cancelSpaceHits|cancelGroundHits|blessBoonCC|placeCCBack_|spendAStratCC|getToggleGalvanizeTiles|toggleGalvanize_|^ungalvanize_)/i;
const BLOCKED_LABEL = /^(sustain|destroy|remove all|done removing|manually assign|cancel a hit|undo|un-|unqueue|spend|exhaust|retrieve|reassign|reset|remove|erase|be asked again|delete|dismiss|refresh|.*\binfo$|show |request all|pause timer|\(for others\))/i;

const RULES: Rule[] = [
  // Milty draft (only offered when the draft says it is this seat's pick; see milty()).
  { id: /^milty_slice_/, score: 92, why: "draft: first slice" },
  { id: /^milty_faction_/, score: 91, why: "draft: first faction" },
  { id: /^milty_order_/, score: 90, why: "draft: first speaker order" },
  // Setup: keep the first secret objective, discard the other.
  { id: /^discardSecret_/, score: 80, retry: true, retryIn: /^setup/, addressed: true, last: true, why: "setup: keep the first secret objective" },
  // Setup: Keleres picks its flavor once the draft is over (the player's own setup waits on it).
  { id: /^setupStep5_\d+_keleres[a-z]_/, score: 84, addressed: true, why: "setup: Keleres flavor" },
  // Setup: starting technology. Most factions get a list of their allowed techs (getTech_<alias>__noPay__comp, once
  // or twice); open choices come as "Get a Technology" → a tech type → a tech; Keleres asks once the others are done.
  { id: /(^|_)acquireAFreeTech$/, score: 83, addressed: true, retry: true, retryIn: /^setup/, why: "setup: get a starting technology" },
  { id: /(^|_)getAllTechOfType_/, score: 82, addressed: true, retry: true, retryIn: /^setup/, why: "setup: first technology type" },
  { id: /(^|_)getTech_.+__noPay/, score: 81, addressed: true, retry: true, retryIn: /^setup/, distinct: true, why: "setup: first starting technology" },
  { id: /(^|_)getKeleresTechOptions$/, score: 60, addressed: true, why: "setup: Keleres technology options" },
  // Strategy phase.
  {
    id: /_scPick_\d+$/,
    score: 80,
    retry: true,
    // A pick button outlives its window (a second copy around an undo, a press the bot never answered): pressed in
    // another phase, the bot handed out a third and fourth card (pbd8).
    phase: /^strategy$/,
    why: "strategy phase: preferred card",
    rank: (c) => {
      const n = Number(/_scPick_(\d+)$/.exec(c.custom_id)?.[1]);
      const i = SC_PREFERENCE.indexOf(n);
      return i < 0 ? 99 : i;
    },
  },
  // Action phase: play the strategy card, then pass; always end the turn.
  { id: /_turnEnd$/, score: 88, retry: true, why: "end turn" },
  { id: /_endOfTurnAbilities$/, score: 87, retry: true, why: "end turn" },
  { id: /_strategicAction_\d+$/, score: 86, why: "play strategy card" },
  // Politics primary: someone must get the speaker token before the bot moves on.
  { id: /^sc_3_assign_speaker_to_/, score: 64, why: "Politics: assign the speaker token" },
  { id: /_passForRound$/, score: 85, retry: true, why: "pass" },
  { id: /_passingAbilities$/, score: 84, why: "pass" },
  // Agenda: pre-abstain and pass on whens / afters / shenanigans when asked ahead of time, else abstain.
  { id: /^resolvePreassignment_Abstain On Agenda$/, score: 79, why: "agenda: pre-abstain" },
  { id: /^resolvePreassignment_Pass On Shenanigans$/, score: 72, why: "agenda: pre-pass on shenanigans" },
  { id: /^declineToQueueA(When|nAfter)$/, score: 72, why: "agenda: no whens / afters" },
  { id: /resolveAgendaVote_0$/, score: 78, why: "agenda: abstain" },
  { id: /^resolveAgendaVote_outcomeTie/, score: 74, retry: true, why: "agenda: speaker breaks the tie" },
  { label: /^(?!pre-).*\babstain\b/i, score: 77, why: "agenda: abstain" },
  // Combat: auto-assign hits, roll dice.
  { id: /^autoAssign/, score: 76, why: "combat: auto-assign hits" },
  // The same combat message offers the combat roll for every round, plus one-off rolls (anti-fighter barrage,
  // bombardment, space cannon): roll the combat round first, the extras once each (mayRoll decides).
  {
    id: /^combatRoll_/,
    score: 75,
    again: true,
    why: "combat: roll dice",
    rank: (c) => (/^combatRoll_[^_]+_[^_]+$/.test(c.custom_id) ? 0 : 1),
  },
  // Async-only preference question (auto-pass on Sabotage after N hours): the shortest timer, once; it stops the
  // question for this seat in later games. The autopilot answers Sabotage windows itself anyway.
  { id: /^setAutoPassMedian_1$/, score: 40, typed: true, why: "preferences: auto-pass on Sabotage" },
  // Async-only preference questions: let the bot auto-pass our secret-objective scoring. (Typed: player.preference,
  // engine/policy/ui.ts answers both while the engine is live; these two rules are the engine-off fallback.)
  { id: /^sandbagPref_bot$/, score: 40, typed: true, why: "preferences: let the bot auto-pass secret scoring" },
  // Status phase: after everyone scored, someone reveals the next public objective (once per game per round; see
  // revealOnce).
  { id: /(^|_)reveal_stage_(1|2)(position_\d+)?$/, score: 63, table: true, typed: true, phase: /^status/, why: "status: reveal the next public objective" },
  // Trades offered to us.
  { id: /^rejectOffer_/, score: 74, why: "reject transaction" },
  // Reaction windows everyone answers.
  { id: /^sc_no_follow_\d+$/, score: 70, table: true, why: "strategy card: not following" },
  { id: /^no_sabotage$/, score: 70, table: true, why: "no sabotage" },
  { id: /^no_when(_persistent)?$/, score: 70, table: true, phase: /^agenda/, why: "agenda: no whens" },
  { id: /^no_after(_persistent)?$/, score: 70, table: true, phase: /^agenda/, why: "agenda: no afters" },
  { id: /^po_no_scoring$/, score: 66, table: true, typed: true, again: true, phase: /^status/, why: "status: no public objective" },
  { id: /^so_no_scoring$/, score: 65, table: true, typed: true, again: true, phase: /^status/, why: "status: no secret objective" },
  { id: /^pass_on_abilities$/, score: 60, table: true, typed: true, phase: /^status/, why: "status: ready for strategy phase" },
  // The table-wide "Start Strategy Phase" (posted after the last "Redistribute Command Tokens" when there is no agenda
  // phase): one autopilot presses it once every player said ready (see mayStartStrategy).
  { id: /^startStrategyPhase$/, score: 59, table: true, typed: true, phase: /^status/, why: "status: everyone is ready; start the strategy phase" },
  // Prompts addressed to us: move on.
  {
    label: /^(done|confirm|ready|no\b|decline|skip|pass\b|not following|end turn|continue|finish|none|no thanks)/i,
    score: 30,
    why: "decline / move on",
  },
];

/** Optional ability offers: never the fallback answer (a rule must score them explicitly). */
const OPTIONAL_LABEL = /\b(use|using|agent|commander|hero|promissory|exhaust|play|purge|spend|pay|ability|on someone else|activate|trigger|steal|swap)\b/i;
/** The bot's word that this status phase's public objective is out (or that a reveal press found it out already). */
const REVEALED_TEXT = /public objective has been revealed|already revealed this round/i;
const OPTIONAL_ID = /(reveal_stage|getKeleresTechOptions|agent|commander|hero|leader|^play|^use|getAgentSelection|^pn_|_pn_|resolvePNPlay|steal)/i;

/** Confirmations that offer a way to take the choice back: their lone button is not a question for us. */
const TAKE_BACK_TEXT = /change your mind|if this was an accident|can change (that|your decision)|to undo|remove the preset|be asked (again|to decide)/i;

/** The bot reminding a player that it waits on them. */
const NUDGE = /this is a nudge|currently waiting on you/i;

const BUSY_WRONG = /these buttons are for someone else/i;
/** Pause before each autopilot action so humans can follow along (override with AUTOPILOT_MIN/MAX_DELAY_MS). */
const MIN_DELAY = Number(process.env.AUTOPILOT_MIN_DELAY_MS ?? 700);
const MAX_DELAY = Number(process.env.AUTOPILOT_MAX_DELAY_MS ?? 1400);
/** During a draft nobody needs to follow the bots' picks: keep it snappy. */
const DRAFT_MIN_DELAY = 200;
const DRAFT_MAX_DELAY = 450;
/** A seat counts as drafting for this long after it last saw its game's draft in progress. */
const DRAFTING_WINDOW_MS = 15000;
/** Messages per channel an autopilot looks at (newest). */
const WINDOW = 60;
/** A message whose presses failed this often is ignored. */
const MAX_FAILS = 2;
/** After this many failures in a row the seat rests for a minute. */
const MAX_STREAK = 8;
/** A control on a re-posted prompt with the same text is not pressed again within this time. */
const REPOST_MS = 60000;
/** A lost press on a `retry` prompt is tried again after this long (at most MAX_RETRIES times). */
const RETRY_MS = 20000;
/** The inverse of a control we pressed (X / UnX) is not pressed in the same channel within this time. */
const INVERSE_MS = 60000;
/** Prefix pairs that make one control the take-back of another ("galvanize_..." / "ungalvanize_..."). */
const INVERSE_PREFIXES: [string, string][] = [
  ["un", ""],
  ["un-", ""],
  ["un ", ""],
  ["add", "remove"],
  ["enable", "disable"],
  ["show", "hide"],
  ["activate", "deactivate"],
];
/** How long to wait for our own draft pick to register before picking again. */
const MILTY_WAIT_MS = 15000;
const MAX_RETRIES = 3;
/** A prompt clearly waiting on us this long, with no press of ours in its game meanwhile, is looked at afresh. */
const STALL_MS = 60000;
/** Our action-phase turn buttons. */
const TURN_ID = /^FFCC_[^_]+_(tacticalAction|componentAction|turnEnd|endOfTurnAbilities|passForRound|strategicAction_\d+)$/;
const BUSY_TEXT = /hasn't finished processing the last task/i;

export class Autopilot {
  private pilots = new Map<string, SeatPilot>();
  /** One autopilot press at a time across the table: the bot handles each game's presses in order anyway. */
  private chain: Promise<unknown> = Promise.resolve();
  private drafts = new Map<string, { at: number; data: Json | null }>();
  private webFactions = new Map<string, { at: number; map: Map<string, string> }>();
  /** Typed engine API (docs/ENGINE.md); when it answers, it is authoritative and the heuristics below are skipped. */
  engine?: EngineClient;

  constructor(
    readonly hub: Hub,
    readonly clients: Clients,
    readonly botApi: string,
  ) {
    this.sync();
  }

  /** Starts / stops pilots to match the seats' `autopilot` flags. */
  sync() {
    const seats = Object.values(this.hub.store.state.seats);
    for (const seat of seats) {
      if (seat.autopilot && !this.pilots.has(seat.user_id)) this.pilots.set(seat.user_id, new SeatPilot(this, seat.user_id));
    }
    for (const [userId, pilot] of this.pilots) {
      if (!seats.some((s) => s.user_id === userId && s.autopilot)) {
        pilot.stop();
        this.pilots.delete(userId);
      }
    }
  }

  setEnabled(userId: string, enabled: boolean): boolean {
    const seat = Object.values(this.hub.store.state.seats).find((s) => s.user_id === userId);
    if (!seat) return false;
    if (enabled) seat.autopilot = true;
    else delete seat.autopilot;
    this.hub.store.scheduleSave();
    this.sync();
    log.info(`autopilot ${this.name(userId)}: ${enabled ? "on" : "off"}`);
    return true;
  }

  name(userId: string) {
    return this.hub.store.state.users[userId]?.global_name ?? userId;
  }

  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  forgetDrafts() {
    for (const [game, hit] of this.drafts) if (hit.data?.status !== "finished") this.drafts.delete(game);
  }

  private states = new Map<string, { at: number; state: GameState | null }>();
  /** When an autopilot last revealed a public objective, per game: the bot may post the reveal buttons twice. */
  readonly lastReveal = new Map<string, number>();
  /** When an autopilot last pressed "Start Strategy Phase", per game: one press per status phase, by one seat. */
  readonly lastStrategyStart = new Map<string, number>();

  /** A game's phase (`strategy`, `action`, `status.scoring`, `agenda.voting`, ...) and whose turn it is, cached 3s. */
  async stateOf(game: string): Promise<GameState | null> {
    const hit = this.states.get(game);
    if (hit && Date.now() - hit.at < 3000) return hit.state;
    let state: GameState | null = null;
    try {
      const res = await fetch(`${this.botApi}/api/public/game/${encodeURIComponent(game)}/web-data`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = (await res.json()) as Json;
        const colors = new Map<string, string>();
        const players = new Map<string, { faction: string; techs: number; owned: string[] }>();
        for (const p of data.playerData ?? []) {
          if (p.discordId && p.color) colors.set(String(p.discordId), String(p.color));
          if (p.discordId && p.faction && p.faction !== "null" && p.faction !== "neutral") players.set(String(p.discordId), { faction: String(p.faction), techs: (p.techs ?? []).length, owned: (p.techs ?? []).map(String) });
        }
        state = {
          phase: String(data.gameState?.phase ?? "") || null,
          active: data.gameState?.activePlayer ? String(data.gameState.activePlayer) : null,
          colors,
          combat: !!data.gameState?.activeCombat,
          combatRound: Number(data.gameState?.activeCombat?.round ?? 0) || null,
          combatColors: (data.gameState?.activeCombat?.participantColors ?? []).map(String),
          players,
        };
      }
    } catch {
      state = null;
    }
    this.states.set(game, { at: Date.now(), state });
    return state;
  }

  forgetState(game: string) {
    this.states.delete(game);
  }

  /**
   * Whether the typed engine path owns this prompt, so the legacy rules / jobs must not press it as well. Mandatory
   * fallback rule (every area): only when the engine is reachable (its event stream is live), the message is an open
   * typed decision waiting on this seat, and the decision is younger than ENGINE_GRACE_MS (the typed policy had its
   * chance; a prompt it leaves alone for longer goes back to the legacy rules). Engine off, down or restarting →
   * false → the legacy paths play exactly as before.
   */
  async engineOwns(game: string, messageId: string, userId: string): Promise<boolean> {
    const engine = this.engine;
    if (!engine?.isLive) return false;
    const open = (await engine.openDecisions(game)) ?? [];
    const d = open.find((x) => x.source.messageId === messageId);
    if (!d || d.kind === "legacy") return false;
    const state = await engine.state(game, userId, 2000);
    if (d.scope === "player" ? d.target?.userId !== userId : !!d.window && !awaits(d, userId)) {
      // Not awaited by the window, but ours to answer (the strategy card we played): still the engine's.
      if (!answersOutsideWindow(d, userId, state)) return false;
    }
    // Typed, but no bot policy answers it (now): the legacy rules may, without waiting out the grace period.
    const mine = open.filter((x) => x.id !== d.id && x.target?.userId === userId);
    if (!chooseTyped(d, state, userId, { history: [], open: mine, all: open })) return false;
    return Date.now() - d.createdAt < ENGINE_GRACE_MS;
  }

  async phaseOf(game: string): Promise<string | null> {
    return (await this.stateOf(game))?.phase ?? null;
  }

  /**
   * Each seat's faction in a game, from the bot's web data: the only authority on who plays what. Cached, but read
   * again every 20s (a faction is never taken from a cache forever: a stale one makes a seat press another faction's
   * buttons and ignore its own).
   */
  async factionOf(game: string, userId: string): Promise<string | undefined> {
    const authoritative = await this.engine?.factionOf(game, userId);
    if (authoritative) return authoritative;
    const hit = this.webFactions.get(game);
    if (hit && Date.now() - hit.at < 20000) return hit.map.get(userId);
    const map = new Map<string, string>();
    try {
      const res = await fetch(`${this.botApi}/api/public/game/${encodeURIComponent(game)}/web-data`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = (await res.json()) as Json;
        for (const p of data.playerData ?? []) if (p.discordId && p.faction && p.faction !== "null") map.set(String(p.discordId), String(p.faction));
      }
    } catch {
      /* bot API down: keep what we knew (below), else fall back to the draft state */
    }
    // A failed read keeps the last good one (it is still the bot's word), but tries again soon.
    if (!map.size && hit?.map.size) {
      this.webFactions.set(game, { at: Date.now() - 15000, map: hit.map });
      return hit.map.get(userId);
    }
    this.webFactions.set(game, { at: Date.now(), map });
    return map.get(userId);
  }

  forgetFaction(game: string) {
    this.webFactions.delete(game);
    this.drafts.delete(game);
  }

  /** The bot's draft state for a game (cached briefly): whose pick it is, and each player's faction. */
  async draft(game: string, maxAgeMs = 1500): Promise<Json | null> {
    const hit = this.drafts.get(game);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;
    let data: Json | null = null;
    try {
      const res = await fetch(`${this.botApi}/api/public/game/${encodeURIComponent(game)}/draft`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) data = (await res.json()) as Json;
    } catch {
      data = null;
    }
    this.drafts.set(game, { at: Date.now(), data });
    return data;
  }
}

class SeatPilot {
  private conn: { send(op: Json): void; close(): void };
  private timer: NodeJS.Timeout | null = null;
  private poll: NodeJS.Timeout;
  private busy = false;
  private stopped = false;
  private readonly started = Date.now();
  /** `${message id}:${custom id}` already pressed. */
  private pressed = new Set<string>();
  private fails = new Map<string, number>();
  private streak = 0;
  private restUntil = 0;
  private nonce = 0;
  private waiting: { nonce: string; resolve: (err?: string) => void } | null = null;
  private lastPressed: string | null = null;
  /** Per game: how many draft picks we had when we last pressed a draft button, and when. */
  private miltyPress = new Map<string, { picks: number; at: number }>();
  private startingTechChecked = new Map<string, { ok: boolean; at: number }>();
  /** Our faction per game as last read from the bot (only to log changes; faction() always asks the bot's records). */
  private factions = new Map<string, string>();
  /** When we last pressed a control by `${channel}:${custom id}:${content}`: the bot often re-posts a prompt. */
  private recent = new Map<string, number>();
  /** Controls we pressed lately, per channel: their inverse (X / UnX) is not pressed for INVERSE_MS. */
  private inversePresses: { channel: string; id: string; label: string; at: number }[] = [];
  /** Messages we pressed on, with their controls then: answered until the bot changes them. */
  private answered = new Map<string, { sig: string; at: number }>();
  /** Per channel, when the bot last nudged us there ("the queue is currently waiting on you"). */
  private nudges = new Map<string, number>();
  /** Prompts pinging us but locked to another faction, for which we already re-read our faction. */
  private lockChecked = new Set<string>();
  /** Prompts we reported as having nothing safe to press. */
  private skipped = new Set<string>();
  /**
   * Identical prompts that were on the table together when we answered one of them (a faction choosing two starting
   * technologies gets the same "choose your starting technology" message twice): each is a question of its own, not a
   * re-post of the one we answered.
   */
  private siblings = new Set<string>();
  /** Per message, how often we pressed a `retry` prompt again. */
  private retries = new Map<string, number>();
  /** The planner (tactical actions, strategy card primaries, scoring); the rule table handles the rest. */
  private brain: Brain;
  /** Trades: proposes N-1 washes via the engine (offers are answered by chooseTyped, engine/tradePolicy.ts). */
  private trade: TradeDesk;
  /** Engine off or unreachable: the old desk (bot /trade/pending + offer buttons) trades instead (until INFRA-4). */
  private legacyTrade: LegacyTradeDesk;

  constructor(
    private mgr: Autopilot,
    readonly userId: string,
  ) {
    this.conn = mgr.clients.attachVirtual(userId, (f) => this.onFrame(f));
    this.brain = new Brain(this.seat());
    this.trade = new TradeDesk(this.seat(), () => mgr.engine);
    this.legacyTrade = new LegacyTradeDesk(this.seat(), mgr.botApi, () => Object.entries(this.store.state.seats).find(([, seat]) => seat.user_id === this.userId)?.[0]);
    // Some turns change without a message this seat can see (e.g. the draft); look again now and then.
    this.poll = setInterval(() => this.schedule(), 8000);
    log.info(`autopilot ${this.name}: started`);
    this.schedule();
  }

  get name() {
    return this.mgr.name(this.userId);
  }

  private get store() {
    return this.mgr.hub.store;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.poll);
    if (this.timer) clearTimeout(this.timer);
    this.conn.close();
    log.info(`autopilot ${this.name}: stopped`);
  }

  private onFrame(f: Json) {
    switch (f.t) {
      case "message_create":
        if (f.message?.ephemeral && BUSY_WRONG.test(f.message.content ?? "")) {
          // The bot says we pressed another player's buttons: never that prompt again, and our idea of our own
          // faction in this game was wrong (it decides which locked buttons are ours): read it again from the bot.
          if (this.lastPressed) this.fails.set(this.lastPressed, MAX_FAILS);
          const ch = this.store.channel(String(f.message.channel_id ?? ""));
          const game = ch ? gameOf(ch, this.store.state.channels) : null;
          if (game) {
            log.warn(`autopilot ${this.name}: the bot says we pressed someone else's buttons in ${game}; re-reading our faction`);
            this.forgetFaction(game);
          }
        }
        // The bot refused our press because it was busy (upstream only; self-hosted presses queue for the lock): let `retry`
        // prompts be pressed again soon rather than after RETRY_MS.
        if (f.message?.ephemeral && BUSY_TEXT.test(f.message.content ?? "") && this.lastPressed) {
          const a = this.answered.get(this.lastPressed);
          if (a) a.at = Math.min(a.at, Date.now() - RETRY_MS + 3000);
        }
        this.schedule();
        break;
      case "message_update":
      case "message_delete":
      case "channels":
      case "channel_upsert":
        this.schedule();
        break;
      case "interaction_done":
        if (this.waiting && f.nonce === this.waiting.nonce) this.waiting.resolve(f.error);
        break;
      case "modal":
        if (this.waiting && f.nonce === this.waiting.nonce) this.waiting.resolve(`opened a form (${f.modal?.title ?? "modal"}); autopilot cannot fill forms`);
        break;
    }
  }

  /** When this seat last saw one of its games mid-draft (draft picks get short delays). */
  private draftingSeenAt = 0;

  private get drafting() {
    return Date.now() - this.draftingSeenAt < DRAFTING_WINDOW_MS;
  }

  private schedule(
    delay = this.drafting
      ? DRAFT_MIN_DELAY + Math.random() * (DRAFT_MAX_DELAY - DRAFT_MIN_DELAY)
      : MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY),
  ) {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.think();
    }, delay);
  }

  /** When the current think() began: one hung far longer than any step should is abandoned (never a silent seat). */
  private busySince = 0;

  private async think() {
    if (this.busy && Date.now() - this.busySince > 120000) {
      log.warn(`autopilot ${this.name}: a decision has hung for 2 minutes; starting over`);
      this.busy = false;
    }
    if (this.busy || this.stopped || !this.mgr.hub.gateway.botReady) return;
    this.busySince = Date.now();
    if (Date.now() < this.restUntil) return;
    this.busy = true;
    try {
      for (const game of this.liveGames()) {
        // A planner error must never keep the rule table from answering (it would stall the game).
        const acted = async (name: string, fn: () => Promise<boolean>) => {
          try {
            return await fn();
          } catch (e) {
            log.error(`autopilot ${this.name}: ${name} failed in ${game}: ${(e as Error).stack}`);
            return false;
          }
        };
        if ((await acted("planner", () => this.brain.tick(game))) || (await acted("trade desk", () => (this.mgr.engine?.isLive ? this.trade.tick(game) : this.legacyTrade.tick(game))))) {
          this.busy = false;
          this.schedule();
          return;
        }
      }
      if (await this.engineStep()) {
        this.busy = false;
        this.schedule();
        return;
      }
      const choice = (await this.stalledPrompt()) ?? (await this.decide());
      if (!choice) {
        await this.recoverTurns();
        return;
      }
      await this.mgr.serial(() => this.press(choice));
    } catch (e) {
      log.error(`autopilot ${this.name}: ${(e as Error).stack}`);
    } finally {
      this.busy = false;
    }
    this.schedule();
  }

  /** Per game: since when it has been our action-phase turn with no turn buttons of ours anywhere. */
  private orphanSince = new Map<string, number>();
  private turnStartAt = new Map<string, number>();

  /**
   * The bot's "it is now your turn" post (with the turn buttons) can be lost, e.g. when the shim restarts while the
   * bot posts it; the game then waits on us forever. If it has been our action-phase turn for a while and no prompt
   * of ours is on the table, ask the bot to start our turn again (`/player turn_start`, as a person would).
   */
  private lastRecover = 0;

  private async recoverTurns() {
    if (Date.now() - this.lastRecover < 15000) return;
    this.lastRecover = Date.now();
    const s = this.store.state;
    for (const ch of Object.values(s.channels)) {
      if (ch.type !== 0 || !/^[a-z]+\d+-actions$/i.test(String(ch.name ?? "")) || !this.store.canView(this.userId, ch.id)) continue;
      const game = /^([a-z]+\d+)-actions$/i.exec(String(ch.name))![1];
      // Only live games (something happened in the last hour).
      const last = this.store.messages(ch.id).at(-1);
      if (!last || Date.now() - Date.parse(last.timestamp) > 3600000) continue;
      const st = await this.mgr.stateOf(game);
      const mine = !!st?.active && st.active === st.colors.get(this.userId) && st.phase === "action";
      if (!mine) {
        this.orphanSince.delete(game);
        continue;
      }
      const faction = await this.faction(game);
      if (!faction) continue;
      const hasPrompt = this.store
        .messages(ch.id)
        .slice(-WINDOW)
        .some((m) => controlsOf(m.components).some((c) => family(/^FFCC_([^_]+)_/.exec(c.custom_id)?.[1]) === faction));
      if (hasPrompt) {
        this.orphanSince.delete(game);
        continue;
      }
      const since = this.orphanSince.get(game) ?? Date.now();
      this.orphanSince.set(game, since);
      if (Date.now() - since < 45000 || Date.now() - (this.turnStartAt.get(game) ?? 0) < 180000) continue;
      this.turnStartAt.set(game, Date.now());
      log.info(`autopilot ${this.name}: our turn in ${game} has no turn buttons; asking the bot to start it again`);
      this.conn.send({ op: "command", nonce: `autopilot-turn-${++this.nonce}`, channel_id: ch.id, name: "player", options: [{ type: 1, name: "turn_start", options: [] }] });
    }
  }

  /** Per game, when we last pressed anything in it. */
  private lastPressIn = new Map<string, number>();
  /** Per stalled prompt (message id): how often we re-checked it, and when last. */
  private stallChecks = new Map<string, { n: number; at: number }>();
  private lastStallScan = 0;

  /**
   * Safety net: a prompt clearly waiting on us (the strategy card pick while we are the active picker, our turn
   * buttons while it is our action-phase turn) that has sat unanswered for over a minute. Whatever made us pass it
   * over (a stale faction, a dedupe that took it for answered, a lost press), look at it afresh: forget what we
   * remembered about it and our faction in that game, and answer it.
   */
  private async stalledPrompt(): Promise<Choice | null> {
    if (Date.now() - this.lastStallScan < 10000) return null;
    this.lastStallScan = Date.now();
    const s = this.store.state;
    const me = this.userId;
    for (const game of this.liveGames()) {
      if (Date.now() - (this.lastPressIn.get(game) ?? 0) < STALL_MS) continue;
      const st = await this.mgr.stateOf(game);
      if (!st?.active || st.active !== st.colors.get(me)) continue;
      const turn = st.phase === "action" ? TURN_ID : st.phase === "strategy" ? /_scPick_\d+$/ : null;
      if (!turn) continue;
      let found: { m: StoredMessage; ch: Json } | null = null;
      for (const ch of Object.values(s.channels)) {
        if (![0, 11, 12].includes(ch.type) || !this.store.canView(me, ch.id) || gameOf(ch, s.channels) !== game) continue;
        for (const m of this.store.messages(ch.id).slice(-WINDOW)) {
          if ((m._ephemeral_for && m._ephemeral_for !== me) || !s.users[m.author?.id]?.bot) continue;
          const content = String(m.content ?? "");
          if (!content.includes(`<@${me}>`) || [...content.matchAll(/<@!?(\d+)>/g)].some(([, id]) => id !== me && s.users[id] && !s.users[id].bot)) continue;
          if (!controlsOf(m.components).some((c) => turn.test(c.custom_id))) continue;
          if (!found || BigInt(m.id) > BigInt(found.m.id)) found = { m, ch };
        }
      }
      if (!found) continue;
      const { m, ch } = found;
      if (Date.now() - Date.parse(m.edited_timestamp ?? m.timestamp) < STALL_MS) continue;
      const seen = this.stallChecks.get(m.id);
      if (seen && (Date.now() - seen.at < STALL_MS || seen.n >= 3)) continue;
      this.stallChecks.set(m.id, { n: (seen?.n ?? 0) + 1, at: Date.now() });
      log.info(`autopilot ${this.name}: re-checking stalled prompt "${String(m.content ?? "").slice(0, 80).replace(/\s+/g, " ")}" in #${ch.name} (waiting on us for ${Math.round((Date.now() - Date.parse(m.edited_timestamp ?? m.timestamp)) / 1000)}s)`);
      this.forgetFaction(game);
      this.forgetPrompt(m);
      const choice = await this.consider(m, ch, game);
      if (choice) return { ...choice, why: `${choice.why}; re-checking stalled prompt` };
      log.info(`autopilot ${this.name}: the stalled prompt in #${ch.name} still has nothing for us to press (faction ${(await this.faction(game)) ?? "unknown"}; controls ${controlsOf(m.components).map((c) => c.custom_id).slice(0, 6).join(", ")})`);
    }
    return null;
  }

  /** Forgets that we answered (or gave up on) a prompt, so the next look at it starts afresh. */
  private forgetPrompt(m: StoredMessage) {
    this.answered.delete(m.id);
    this.fails.delete(m.id);
    this.skipped.delete(m.id);
    this.retries.delete(m.id);
    this.lockChecked.delete(m.id);
    for (const k of [...this.pressed]) if (k.startsWith(`${m.id}:`)) this.pressed.delete(k);
    const controls = controlsOf(m.components);
    this.recent.delete(this.promptKey(m, controls));
    for (const c of controls) {
      this.recent.delete(this.repostKey(m, c));
      this.recent.delete(`${m.channel_id}:label:${c.label}`);
    }
  }

  // ---- deciding ----

  private async decide(): Promise<Choice | null> {
    const s = this.store.state;
    const me = this.userId;
    const choices: Choice[] = [];
    for (const ch of Object.values(s.channels)) {
      if (![0, 11, 12].includes(ch.type) || !this.store.canView(me, ch.id)) continue;
      const game = gameOf(ch, s.channels);
      if (!game) continue;
      const list = this.store.messages(ch.id);
      for (const m of list.slice(-WINDOW)) {
        if (NUDGE.test(String(m.content ?? "")) && (!m._ephemeral_for || m._ephemeral_for === me) && (ch.type === 12 || String(m.content).includes(`<@${me}>`))) {
          const at = Date.parse(m.timestamp);
          if (at > (this.nudges.get(ch.id) ?? 0)) this.nudges.set(ch.id, at);
        }
      }
      for (const m of list.slice(-WINDOW)) {
        const c = await this.consider(m, ch, game);
        if (c) choices.push(c);
      }
    }
    if (!choices.length) return null;
    choices.sort((a, b) => b.score - a.score || (BigInt(b.msg.id) > BigInt(a.msg.id) ? 1 : -1));
    const best = choices[0];
    if (best.score <= 30 && process.env.ANTHROPIC_API_KEY) {
      const asked = await this.askClaude(best.msg);
      if (asked) return asked;
    }
    return best;
  }

  private async consider(m: StoredMessage, ch: Json, game: string): Promise<Choice | null> {
    const me = this.userId;
    const s = this.store.state;
    if (m._ephemeral_for && m._ephemeral_for !== me) return null;
    if (!s.users[m.author?.id]?.bot) return null;
    if ((this.fails.get(m.id) ?? 0) >= MAX_FAILS) return null;
    let controls = controlsOf(m.components);
    if (!controls.length) return null;
    if (this.brain.owns(game, { ch, m, controls }) || (this.mgr.engine?.isLive ? this.trade.owns(game, { ch, m, controls }) : this.legacyTrade.owns(game, { ch, m, controls }))) return null;
    // Answered before this pilot started (e.g. before a restart), and unchanged since.
    // When we answered this prompt (unchanged since): this run, a re-posted copy, or before a restart.
    const sig = signature(controls);
    const mine = this.answered.get(m.id);
    const press = m._presses?.[me];
    const sibling = this.siblings.has(m.id);
    const repost = sibling ? undefined : this.recent.get(this.promptKey(m, controls));
    const answeredAt =
      mine?.sig === sig
        ? mine.at
        : repost !== undefined && Date.now() - repost < REPOST_MS
          ? repost
          : press && press.controls === sig
            ? Date.parse(press.at)
            : undefined;
    // A later nudge in this channel says the bot still waits on us: look at the prompt again.
    const answered = answeredAt !== undefined && !((this.nudges.get(m.channel_id) ?? 0) > answeredAt);
    // Still there, unchanged, well after we pressed it: for prompts the bot removes once it acts, the press was lost.
    const pressedAt = mine?.sig === sig ? mine.at : press && press.controls === sig ? Date.parse(press.at) : undefined;
    const lost = pressedAt !== undefined && Date.now() - pressedAt > RETRY_MS && (this.retries.get(m.id) ?? 0) < MAX_RETRIES;
    if (answered && press && !mine && Date.parse(press.at) < this.started && !lost && !this.tableStalled(m, game) && !controls.some((c) => /^combatRoll_|^pass_on_abilities$/.test(c.custom_id))) return null;
    const unpressed = controls;
    // Combat rolls are pressed once per combat round on the same message (mayRoll decides).
    const reusable = (c: Control) => /^combatRoll_/.test(c.custom_id);
    controls = controls.filter((c) => reusable(c) || (!this.pressed.has(`${m.id}:${c.custom_id}`) && (sibling || !this.pressedRecently(m, c))));
    // Never undo what we just did: the inverse (X / UnX, add / remove, ...) of a control we pressed here lately.
    controls = controls.filter((c) => !this.invertsRecentPress(m.channel_id, c));
    // A galvanize menu (Bastion agent: "choose the unit that should be galvanized") stays up after a press, edited to
    // offer the next unit: one galvanize per menu is the answer, never a run through every unit.
    if ((m._presses?.[me] || [...this.pressed].some((k) => k.startsWith(`${m.id}:`))) && controls.some((c) => /(^|_)galvanize_/i.test(c.custom_id))) {
      controls = controls.filter((c) => !/(^|_)(un)?galvanize_/i.test(c.custom_id));
    }

    const faction = await this.faction(game);
    const content = String(m.content ?? "");
    const mentionsMe = content.includes(`<@${me}>`) || (m.mentions ?? []).some((u: Json) => u.id === me);
    // The bot names players as "<faction emoji>Name <color emoji>**Color**", often without a mention.
    const named = (id: string) => {
      const n = s.users[id]?.global_name;
      return !!n && content.includes(`${n} <:`);
    };
    const namesOther = !mentionsMe && !named(me) && Object.values(s.seats).some((seat) => seat.user_id !== me && named(seat.user_id));
    // Another seated player pinged in the text ("<@id>"): the shim's messages do not always carry `mentions`.
    const pingsOther = [...content.matchAll(/<@!?(\d+)>/g)].some(([, id]) => id !== me && s.users[id] && !s.users[id].bot);
    const mentionsOther = namesOther || (!mentionsMe && (pingsOther || (m.mentions ?? []).some((u: Json) => u.id !== me && !s.users[u.id]?.bot)));
    const ffcc = (c: Control) => family(/^FFCC_([^_]+)_/.exec(c.custom_id)?.[1]);
    // Our faction's lock on the prompt makes it ours, unless the text is for another player (it names or pings only
    // them): then the lock and the text disagree, and we take neither as a reason to answer.
    const ffccMine = !!faction && controls.some((c) => ffcc(c) === faction) && !mentionsOther;
    // The prompt carries a lock that is not ours (or any lock while we do not know our faction): its buttons are for
    // that player, so a mention or our thread alone does not make it a question for us (no setup rule, no "only /
    // first option" fallback). Rules for unlocked controls anyone may press (combat rolls on a combat thread's
    // "Buttons for combat.", which also carries a fighter's own ability buttons) still apply.
    const lockedOther = unpressed.some((c) => !!ffcc(c) && ffcc(c) !== faction) && !ffccMine;
    // A prompt that pings only us but is locked to another faction: either it is a "played by @us" post with the
    // followers' buttons, or our faction is not what we think. Re-read it from the bot (once per prompt) before we
    // leave the prompt alone.
    if (lockedOther && mentionsMe && !mentionsOther && !this.lockChecked.has(m.id) && Date.now() - Date.parse(m.edited_timestamp ?? m.timestamp) < 600000) {
      this.lockChecked.add(m.id);
      const locks = [...new Set(unpressed.map(ffcc).filter(Boolean))];
      if (locks.length === 1) {
        this.forgetFaction(game);
        const fresh = await this.faction(game);
        if (fresh !== faction) {
          log.info(`autopilot ${this.name}: a prompt for us in #${ch.name} is locked to ${locks[0]}; our faction is ${fresh ?? "unknown"}, not ${faction ?? "unknown"}`);
          return this.consider(m, ch, game);
        }
      }
    }
    // Only we are named in an actions-channel post ("@Bot Beta, as Speaker, please decide a winner").
    const calledOut = mentionsMe && ch.type === 0 && !(m.mention_roles ?? []).length && !/is up to draft/.test(content);
    // Other factions' buttons, and the controls we never press.
    const ours = controls.filter((c) => !ffcc(c) || ffcc(c) === faction);
    controls = ours.filter((c) => !BLOCKED_ID.test(c.custom_id.replace(/^FFCC_[^_]+_/, "")) && !BLOCKED_LABEL.test(c.label.trim()));
    if (!controls.length) {
      // Say so (once) when a prompt that is certainly ours offers nothing we may press: a likely stall.
      if ((ffccMine || (m._ephemeral_for === me && !BUSY_WRONG.test(content)) || calledOut) && !this.answered.has(m.id) && !this.skipped.has(m.id) && Date.now() - Date.parse(m.timestamp) < 600000) {
        this.skipped.add(m.id);
        const labels = ours.map((c) => c.label || c.custom_id).filter((l) => !/^undo$/i.test(l));
        if (labels.length) log.info(`autopilot ${this.name}: leaving "${content.slice(0, 80).replace(/\s+/g, " ")}" in #${ch.name} to a person (only ${labels.slice(0, 6).join(" / ")})`);
      }
      return null;
    }
    // My own strategy card: its primary is not planned; the copies in its thread are for followers.
    if (/played by/.test(content) && mentionsMe) return null;
    if (/^These buttons will work inside the thread/.test(content)) return null;

    const myThread = ch.type === 12 && (s.thread_members[ch.id] ?? []).includes(me);
    const factionThread = !!faction && ch.type === 11 && String(ch.name).toLowerCase().includes(faction);
    // Our own private thread (cards info) naming only us: e.g. Keleres' "choose a flavor of keleres", prompted by
    // whoever's press finished the draft.
    const ownThread = ch.type === 12 && myThreadOwner(ch, s, me);
    // Only we may see it (and it is not the bot telling us a press was someone else's).
    const ephemeralMine = m._ephemeral_for === me && !BUSY_WRONG.test(content);
    const strong = ephemeralMine || ffccMine || (!lockedOther && !mentionsOther && ((m._prompted_for === me) || (ownThread && mentionsMe)));
    const ctx: Ctx = {
      addressed: ephemeralMine || ffccMine || ((mentionsMe || ownThread) && !mentionsOther && !lockedOther),
      strong,
      direct: strong || calledOut || (mentionsMe && !/is up to draft/.test(content)) || ((myThread || factionThread) && !mentionsOther),
      faction,
    };

    if (controls.some((c) => c.custom_id.startsWith("milty_"))) return this.milty(m, controls, game);
    // Combat dice roll for whoever presses: roll once per round (not ahead of the opponent), and each
    // other kind of roll (anti-fighter barrage, bombardment, space cannon) once per combat.
    if (controls.some((c) => /^combatRoll_/.test(c.custom_id))) {
      // Only while the bot says a combat is on (the roll buttons stay after it ends).
      const st = await this.mgr.stateOf(game);
      const myColor = st?.colors.get(me);
      // Only in a combat we fight, and the combat round from the bot's own state.
      const fighting = !st || (st.combat && (!myColor || !st.combatColors.length || st.combatColors.includes(myColor)));
      const round = st?.combatRound ?? null;
      // An extra roll (anti-fighter barrage, space cannon) whose button we pressed on this message is done, also across
      // restarts (the shim keeps who pressed what).
      const extraDone = (c: Control) => /^combatRoll_[^_]+_[^_]+_\w+/.test(c.custom_id) && !!m._presses?.[me];
      controls = controls.filter((c) => !/^combatRoll_/.test(c.custom_id) || (fighting && !extraDone(c) && this.mayRoll(ch.id, c.custom_id, faction, round)));
    }

    let phase: string | null | undefined;
    // Asked once per message, and only when a typed rule's own conditions hold (it reads the engine mirror + state).
    let owned: boolean | undefined;
    for (const rule of RULES) {
      if (!rule.table && !ctx.direct) continue;
      if (rule.addressed && !ctx.addressed) continue;
      if (rule.typed && rule.id && !controls.some((c) => rule.id!.test(c.custom_id.replace(/^FFCC_[^_]+_/, "")) || rule.id!.test(c.custom_id))) continue;
      if (rule.typed && (owned ??= await this.mgr.engineOwns(game, m.id, me))) continue;
      const retryPhase = rule.retry && lost ? String((await this.mgr.phaseOf(game)) ?? "") : "";
      if (
        rule.retry &&
        lost &&
        (!rule.phase || rule.phase.test(retryPhase)) &&
        (rule.retryIn ? rule.retryIn.test(retryPhase) : this.tableStalled(m, game) || (await this.myTurn(game)))
      ) {
        const again = unpressed.filter((c) => (this.pressed.has(`${m.id}:${c.custom_id}`) || (!mine && press)) && (rule.id!.test(c.custom_id.replace(/^FFCC_[^_]+_/, "")) || rule.id!.test(c.custom_id)));
        const techAlias = /(?:^|_)getTech_(.+?)__noPay/.exec(again[0]?.custom_id ?? "")?.[1];
        if (techAlias) {
          this.mgr.forgetState(game);
          const owned = (await this.mgr.stateOf(game))?.players.get(this.userId)?.owned ?? [];
          if (owned.includes(techAlias)) continue;
        }
        if (again.length && !BLOCKED_ID.test(again[0].custom_id.replace(/^FFCC_[^_]+_/, ""))) {
          this.retries.set(m.id, (this.retries.get(m.id) ?? 0) + 1);
          return { msg: m, control: again[0], score: rule.score, why: `${rule.why}; again, the first press was lost` };
        }
      }
      // The status homework message also carries the planner's "Redistribute, Gain, & Confirm Command Tokens": a press
      // of that one does not answer "Ready For Agenda Phase".
      const otherPressOnly = /pass_on_abilities/.test(String(rule.id)) && !this.pressed.has(`${m.id}:pass_on_abilities`) && controls.some((c) => c.custom_id === "pass_on_abilities");
      if (answered && !rule.again && !otherPressOnly) continue;
      // A table window we answered once stays answered, even if the bot edited it since (e.g. after a restart),
      // unless the whole game has been quiet for a while since: then our answer may have been lost (refused while the
      // bot was busy, or the bot restarted), and answering again is harmless.
      if (rule.table && !rule.why.startsWith("status: reveal") && !/startStrategyPhase/.test(String(rule.id)) && (press || answered) && this.tableStalled(m, game)) {
        if (rule.phase) {
          if (phase === undefined) phase = await this.mgr.phaseOf(game);
          if (phase && !rule.phase.test(phase)) continue;
        }
        const hits = unpressed.filter((c) => rule.id!.test(c.custom_id));
        if (hits.length && (this.retries.get(m.id) ?? 0) < 2) {
          this.retries.set(m.id, (this.retries.get(m.id) ?? 0) + 1);
          this.pressed.delete(`${m.id}:${hits[0].custom_id}`);
          return { msg: m, control: hits[0], score: rule.score, why: `${rule.why}; again, the game has been waiting a while` };
        }
      }
      if (rule.table && !rule.again && press && !otherPressOnly) continue;
      if (rule.again && rule.why !== "combat: roll dice" && press && !mine && Date.parse(press.at) < this.started) continue;
      if (rule.why.startsWith("status: reveal") && !this.mayReveal(m, game)) continue;
      if (rule.why === "setup: Keleres technology options" && !(await this.othersHaveStartingTech(game))) continue;
      // "Ready For Strategy / Agenda Phase": the last press moves the whole table on, so it must never be ours while a
      // person at the table is still doing their status-phase steps. Answer only after every person said ready.
      if (/pass_on_abilities/.test(String(rule.id)) && !(await this.peopleReady(m, game))) continue;
      if (/startStrategyPhase/.test(String(rule.id)) && !(await this.mayStartStrategy(m, game))) continue;
      if (rule.phase) {
        if (phase === undefined) phase = await this.mgr.phaseOf(game);
        if (phase && !rule.phase.test(phase)) continue;
      }
      let hits = controls.filter((c) => (rule.id ? rule.id.test(c.custom_id.replace(/^FFCC_[^_]+_/, "")) || rule.id.test(c.custom_id) : true) && (rule.label ? rule.label.test(c.label.trim()) : true));
      if (rule.distinct) hits = hits.filter((c) => Date.now() - (this.recent.get(`${m.channel_id}:label:${c.label}`) ?? 0) >= 600000);
      if (!hits.length) continue;
      if (rule.rank) hits = [...hits].sort((a, b) => rule.rank!(a) - rule.rank!(b));
      const control = rule.last ? hits[hits.length - 1] : hits[0];
      return { msg: m, control, score: rule.score, why: rule.why };
    }
    // Only for prompts clearly addressed to us: never one for another player, or locked to another faction.
    if (!ctx.strong || mentionsOther || lockedOther || answered || TAKE_BACK_TEXT.test(content)) return null;
    // A prompt certainly waiting on us that no rule covers: its first control (not one we just chose in a
    // similar prompt here, e.g. a second "choose a technology").
    // Optional abilities offered "just in case" (agents, commanders, promissory notes, "use X?") are not questions
    // we must answer: never pressed only because they are the first or only button.
    controls = controls.filter((c) => !OPTIONAL_LABEL.test(c.label) && !OPTIONAL_ID.test(c.custom_id.replace(/^FFCC_[^_]+_/, "")));
    if (!controls.length) return null;
    const fresh = controls.filter((c) => sibling || Date.now() - (this.recent.get(`${m.channel_id}:label:${c.label}`) ?? 0) >= REPOST_MS);
    if (!fresh.length) return null;
    controls = fresh;
    return { msg: m, control: controls[0], score: controls.length === 1 ? 25 : 10, why: controls.length === 1 ? "only option" : "first option" };
  }

  /**
   * Reveal a public objective at most once per status phase: only the newest reveal prompt, none revealed since it was
   * posted, and no autopilot revealed one in this game in the last minute.
   */
  private mayReveal(m: StoredMessage, game: string) {
    if (Date.now() - (this.mgr.lastReveal.get(game) ?? 0) < 60000) return false;
    const all = this.store.messages(m.channel_id);
    for (const other of all) {
      if (BigInt(other.id) <= BigInt(m.id)) continue;
      if (REVEALED_TEXT.test(String(other.content ?? ""))) return false;
      if (controlsOf(other.components).some((c) => /reveal_stage_/.test(c.custom_id))) return false;
    }
    // The bot posts "All players have indicated scoring … Reveal Stage 1" again whenever a late "No Public/Secret
    // Objective Scored" press comes in, also after this round's objective is out (and then only answers "already
    // revealed"). Look back to the start of this status phase ("All players have passed."): an objective revealed
    // there means this prompt is stale.
    for (let i = all.length - 1; i >= 0; i--) {
      const other = all[i];
      if (BigInt(other.id) >= BigInt(m.id)) continue;
      const text = String(other.content ?? "");
      if (REVEALED_TEXT.test(text)) return false;
      if (/^All players have passed\.|it is now your turn|strategy phase has started|an agenda has been revealed/i.test(text)) break;
    }
    return true;
  }

  /**
   * Keleres takes its starting technologies from the other players', and the bot offers them only once (pressed too
   * early, Keleres gets prompts with no buttons and the game cannot deal secrets). Wait until every other player but
   * Sardakk (no starting technology) owns one and no starting-technology prompt is left anywhere in the game.
   */
  private async othersHaveStartingTech(game: string) {
    // Checked on every pass over the prompt: re-reading the game each time costs more than a few seconds' delay.
    const cached = this.startingTechChecked.get(game);
    if (cached && Date.now() - cached.at < 20000) return cached.ok;
    const ok = await this.readOthersHaveStartingTech(game);
    this.startingTechChecked.set(game, { ok, at: Date.now() });
    return ok;
  }

  private async readOthersHaveStartingTech(game: string) {
    this.mgr.forgetState(game);
    const st = await this.mgr.stateOf(game);
    if (!st) return false;
    for (const [id, p] of st.players) {
      if (id === this.userId || p.faction.startsWith("sardakk") || p.faction.startsWith("keleres")) continue;
      if (p.techs < 1) return false;
    }
    const s = this.store.state;
    for (const ch of Object.values(s.channels)) {
      if (gameOf(ch, s.channels) !== game) continue;
      for (const m of this.store.messages(ch.id).slice(-WINDOW)) {
        if (m._ephemeral_for && m._ephemeral_for !== this.userId) continue;
        if (controlsOf(m.components).some((c) => /(^|_)(getTech_.+__noPay|acquireAFreeTech$|getAllTechOfType_)/.test(c.custom_id) && !c.custom_id.includes("keleres"))) {
          if (!String(m.content ?? "").includes(`<@${this.userId}>`)) return false;
        }
      }
    }
    return true;
  }

  /** Every non-autopilot player of the game has said "… is ready for …" since this window was posted. */
  private async peopleReady(m: StoredMessage, game: string) {
    const st = await this.mgr.stateOf(game);
    if (!st) return true;
    const s = this.store.state;
    const autopilot = new Set(Object.values(s.seats).filter((x) => x.autopilot).map((x) => x.user_id));
    const people = [...st.colors.keys()].filter((id) => !autopilot.has(id) && s.users[id] && !s.users[id].bot);
    const later = this.store.messages(m.channel_id).filter((x) => BigInt(x.id) > BigInt(m.id) && / is ready for /i.test(String(x.content ?? "")));
    return people.every((id) => {
      const name = s.users[id]?.global_name;
      return !!name && later.some((x) => String(x.content).includes(`${name} <`) || String(x.content).includes(`<@${id}>`));
    });
  }

  /**
   * "Start Strategy Phase" moves the whole table on: press it only when
   * - the game is still in the status phase (read fresh, not from the 3s cache),
   * - every player of the game (people and autopilots) said "… is ready for strategy phase" after the newest
   *   "Ready For Strategy Phase" window, the last of them a few seconds ago (the bot proceeds on its own once all are
   *   ready, and that must not be doubled),
   * - the bot has not announced the strategy phase since,
   * - this is the newest such button, and no autopilot pressed one in this game in the last few minutes.
   */
  private async mayStartStrategy(m: StoredMessage, game: string) {
    if (Date.now() - (this.mgr.lastStrategyStart.get(game) ?? 0) < 300000) return false;
    const s = this.store.state;
    const channels = Object.values(s.channels).filter((ch) => gameOf(ch, s.channels) === game && [0, 11, 12].includes(ch.type));
    const all = channels.flatMap((ch) => this.store.messages(ch.id)).filter((x) => !x._ephemeral_for);
    if (all.some((x) => BigInt(x.id) > BigInt(m.id) && controlsOf(x.components).some((c) => c.custom_id === "startStrategyPhase"))) return false;
    const windows = all.filter((x) => controlsOf(x.components).some((c) => c.custom_id === "pass_on_abilities") || /^Ready For Strategy Phase/i.test(controlsOf(x.components).map((c) => c.label).join(" ")));
    const window = windows.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).at(-1);
    if (!window) return false;
    const after = all.filter((x) => BigInt(x.id) > BigInt(window.id) && s.users[x.author?.id]?.bot);
    if (after.some((x) => /proceeding to strategy phase|strategy phase has started|indicated completion of status phase/i.test(String(x.content ?? "")))) return false;
    this.mgr.forgetState(game);
    const st = await this.mgr.stateOf(game);
    if (!st || !st.phase || !/^status/.test(st.phase) || !st.players.size) return false;
    const ready = after.filter((x) => / is ready for strategy phase/i.test(String(x.content ?? "")));
    let last = 0;
    for (const id of st.players.keys()) {
      const name = s.users[id]?.global_name;
      const said = ready.filter((x) => String(x.content).includes(`<@${id}>`) || (!!name && String(x.content).includes(`${name} <`)));
      if (!said.length) return false;
      last = Math.max(last, Date.parse(said[0].timestamp));
    }
    return Date.now() - last > 8000;
  }

  /** The game this table window belongs to has been silent for 3 minutes (nothing new in its actions channel). */
  private tableStalled(m: StoredMessage, game: string) {
    const actions = Object.values(this.store.state.channels).find((c) => c.name === `${game}-actions`);
    const last = actions ? this.store.messages(actions.id).at(-1) : undefined;
    const lastAt = last ? Date.parse(last.edited_timestamp ?? last.timestamp) : 0;
    return Date.now() - Math.max(lastAt, Date.parse(m.edited_timestamp ?? m.timestamp)) > 180000;
  }

  /** Whether the bot's web data says it is this seat's turn (in the strategy or action phase). */
  private async myTurn(game: string) {
    const st = await this.mgr.stateOf(game);
    return !!st?.active && st.active === st.colors.get(this.userId);
  }

  private repostKey(m: StoredMessage, c: Control) {
    return `${m.channel_id}:${c.custom_id}:${String(m.content ?? "").slice(0, 200)}`;
  }

  /** A prompt by its text and controls: the bot often deletes a prompt and posts it again after a press. */
  private promptKey(m: StoredMessage, controls: Control[]) {
    return `${m.channel_id}:${signature(controls)}:${String(m.content ?? "").slice(0, 200)}`;
  }

  /** Whether `c` would take back (X / UnX, add / remove, ...) a control we pressed in this channel within INVERSE_MS. */
  private invertsRecentPress(channel: string, c: Control) {
    const now = Date.now();
    this.inversePresses = this.inversePresses.filter((p) => now - p.at < INVERSE_MS);
    const id = normId(c.custom_id);
    const label = normLabel(c.label);
    return this.inversePresses.some((p) => p.channel === channel && (areInverse(p.id, id) || (!!label && areInverse(p.label, label))));
  }

  /** The same control on a re-posted copy of a prompt we answered within the last minute. */
  private pressedRecently(m: StoredMessage, c: Control) {
    const at = this.recent.get(this.repostKey(m, c));
    return at !== undefined && Date.now() - at < REPOST_MS;
  }

  private mayRoll(channelId: string, customId: string, faction: string | undefined, round: number | null = null): boolean {
    const kind = /^combatRoll_[^_]+_[^_]+_?(\w+)?/.exec(customId)?.[1];
    if (kind && kind !== "space" && kind !== "ground") {
      // Bombardment is the attacker's choice before an invasion: a passive bot never bombards.
      if (/bombard/i.test(kind)) return false;
      // Anti-fighter barrage / space cannon: once per combat, judged from the combat's own messages so a restart
      // does not roll them again.
      const key = `${channelId}:roll:${kind}`;
      if (this.recent.has(key)) return false;
      const label = /afb/i.test(kind) ? /anti-fighter barrage/i : /offence/i.test(kind) ? /space cannon offence/i : /defence/i.test(kind) ? /space cannon defence/i : null;
      if (faction && label) {
        for (const m of this.store.messages(channelId)) {
          const c = String(m.content ?? "");
          const who = /^<a?:(\w+):\d+>\s*rolls for /i.exec(c)?.[1]?.toLowerCase();
          if (who && (faction.startsWith(who) || who.startsWith(faction)) && label.test(c)) return false;
        }
      }
      return true;
    }
    if (!faction) return false;
    // A combat thread ("…-turn-4-letnev-vs-ralnel") is only ours to roll in if our faction fights in it.
    const chName = String(this.store.channel(channelId)?.name ?? "").toLowerCase();
    if (/-vs-/.test(chName) && !chName.includes(faction)) return false;
    // Our roll's result may not have arrived yet.
    if (Date.now() - (this.recent.get(`${channelId}:roll:combat`) ?? 0) < 15000) return false;
    const myRounds = new Set<number>();
    for (const m of this.store.messages(channelId)) {
      const r = /rolls for .*combat \(round #(\d+)\)/i.exec(String(m.content ?? ""))?.[1];
      const w = /^<a?:(\w+):\d+>\s*rolls for /i.exec(String(m.content ?? ""))?.[1]?.toLowerCase();
      if (r && w && (faction.startsWith(w) || w.startsWith(faction))) myRounds.add(Number(r));
    }
    // Once per combat round. The round under way is the newest one anybody started ("Start of Combat Round #N", or a
    // roll for round N; the bot's web data does not advance it): roll it unless we already did.
    let current = round ?? 1;
    for (const m of this.store.messages(channelId)) {
      const c = String(m.content ?? "");
      const n = Number(/Start of Combat Round #(\d+)/i.exec(c)?.[1] ?? /rolls for .*combat \(round #(\d+)\)/i.exec(c)?.[1] ?? 0);
      if (n > current) current = n;
    }
    return !myRounds.has(current);
  }

  /** Milty draft: when it is our pick, the first option of a category we have not drafted yet. */
  private async milty(m: StoredMessage, controls: Control[], game: string): Promise<Choice | null> {
    // With the engine up, drafting is typed (draft.milty.pick in engineStep): the engine validates turn, category and
    // availability, so a pick cannot be doubled. Pressing board buttons here as well would race it.
    if ((await this.mgr.engineOwns(game, m.id, this.userId)) && (await this.mgr.engine?.state(game, this.userId, 1000))?.draft) {
      this.draftingSeenAt = Date.now();
      return null;
    }
    // Always read the draft fresh: a stale copy makes us miss our turn until the next poll.
    const draft = await this.mgr.draft(game, 0);
    if (draft?.status === "drafting") this.draftingSeenAt = Date.now();
    if (!draft || draft.status !== "drafting" || String(draft.currentPlayer) !== this.userId) return null;
    const mine = (draft.players ?? []).find((p: Json) => String(p.userId) === this.userId);
    const have = new Set<string>((mine?.picks ?? []).map((p: Json) => (p.type === "speakerOrder" ? "order" : p.type)));
    // Our last pick is still on its way (the draft says it is our turn until the bot records it): pressing again on a
    // refreshed draft board would pick twice, and a doubled last pick finishes the draft (and sets everyone up) twice.
    const last = this.miltyPress.get(game);
    if (last && last.picks === have.size && Date.now() - last.at < MILTY_WAIT_MS) return null;
    const open = controls.filter((c) => {
      const kind = /^milty_(slice|faction|order)_/.exec(c.custom_id)?.[1];
      return kind && !have.has(kind);
    });
    if (!open.length) return null;
    const kind = /^milty_(\w+?)_/.exec(open[0].custom_id)![1];
    const rule = RULES.find((r) => r.id?.test(open[0].custom_id))!;
    this.miltyPress.set(game, { picks: have.size, at: Date.now() });
    return { msg: m, control: open[0], score: rule.score, why: `draft: first ${kind}` };
  }

  /**
   * This seat's faction in a game, only ever from the bot's own records: its web data (read again every 20s), else the
   * faction the draft recorded for us. Never guessed from the buttons of a message that pings us: a strategy card's
   * "played by @us" post carries other factions' follow buttons, and a guess cached for the game made a seat press
   * another faction's setup buttons and ignore its own strategy card pick (pbd10). Unknown means: no faction-locked
   * button is ours.
   */
  private async faction(game: string): Promise<string | undefined> {
    const authoritative = family((await this.mgr.engine?.factionOf(game, this.userId)) ?? undefined);
    if (authoritative) return this.noteFaction(game, authoritative, "the engine");
    // The engine is up and says we have no faction yet (drafting, or Keleres choosing a flavour): believe it.
    if (this.mgr.engine && (await this.mgr.engine.state(game, undefined, 5000))) {
      this.factions.delete(game);
      return undefined;
    }
    const fromWeb = family(await this.mgr.factionOf(game, this.userId));
    if (fromWeb) return this.noteFaction(game, fromWeb, "the bot's game data");
    const draft = await this.mgr.draft(game, 10000);
    const mine = (draft?.players ?? []).find((p: Json) => String(p.userId) === this.userId);
    if (mine?.faction) return this.noteFaction(game, family(String(mine.faction))!, "the draft");
    return undefined;
  }

  /** Logs when our faction in a game changes (first learned, or corrected). */
  private noteFaction(game: string, faction: string, source: string) {
    const was = this.factions.get(game);
    if (was !== faction) {
      this.factions.set(game, faction);
      log.info(`autopilot ${this.name}: ${was ? `faction in ${game} is ${faction}, not ${was}` : `plays ${faction} in ${game}`} (from ${source})`);
    }
    return faction;
  }

  /** Our faction in this game may be wrong: read it again from the bot before the next decision. */
  private forgetFaction(game: string) {
    this.mgr.forgetFaction(game);
    this.mgr.forgetState(game);
  }

  // ---- Claude (optional) ----

  private async askClaude(msg: StoredMessage): Promise<Choice | null> {
    const controls = controlsOf(msg.components).filter((c) => !BLOCKED_ID.test(c.custom_id.replace(/^FFCC_[^_]+_/, "")) && !BLOCKED_LABEL.test(c.label.trim()));
    if (controls.length < 2) return null;
    const recent = this.store
      .messages(msg.channel_id)
      .filter((m) => !m._ephemeral_for || m._ephemeral_for === this.userId)
      .slice(-8)
      .map((m) => `${m.author?.global_name ?? m.author?.username}: ${String(m.content ?? "").slice(0, 400)}`)
      .join("\n");
    const prompt =
      `You are playing Twilight Imperium 4 (AsyncTI4 bot) as ${this.name}. Play simply and safely; avoid anything that spends resources unless needed to move the game on.\n` +
      `Recent messages:\n${recent}\n\nThe bot asks:\n${String(msg.content ?? "").slice(0, 1500)}\n\nOptions:\n` +
      controls.map((c, i) => `${i + 1}. ${c.label} (${c.custom_id})`).join("\n") +
      `\n\nAnswer with only the number of the option to choose.`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: process.env.AUTOPILOT_MODEL ?? "claude-sonnet-5-5", max_tokens: 16, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Json;
      const text = String(body.content?.find((b: Json) => b.type === "text")?.text ?? "");
      const n = Number(/\d+/.exec(text)?.[0]);
      const control = controls[n - 1];
      if (!control || this.pressed.has(`${msg.id}:${control.custom_id}`)) return null;
      return { msg, control, score: 30, why: "Claude's choice" };
    } catch (e) {
      log.warn(`autopilot ${this.name}: Claude unavailable (${(e as Error).message}); using heuristics`);
      return null;
    }
  }

  // ---- acting ----

  private async press(choice: Choice): Promise<string | undefined> {
    const { msg, control } = choice;
    // The prompt may have gone while we waited for our turn.
    const fresh = this.store.findMessage(msg.channel_id, msg.id);
    if (!fresh || !controlsOf(fresh.components).some((c) => c.custom_id === control.custom_id)) return "the prompt is gone";
    // Another pilot may have revealed the objective while we were deciding.
    if (/reveal_stage_/.test(control.custom_id)) {
      const game = gameOf(this.store.channel(msg.channel_id) ?? {}, this.store.state.channels) ?? "";
      if (!this.mayReveal(fresh, game)) return "already revealed";
    }
    // Another pilot may have started the strategy phase while we were deciding.
    if (control.custom_id === "startStrategyPhase") {
      const game = gameOf(this.store.channel(msg.channel_id) ?? {}, this.store.state.channels) ?? "";
      if (!(await this.mayStartStrategy(fresh, game))) return "the strategy phase is under way";
      this.mgr.lastStrategyStart.set(game, Date.now());
    }
    await sleep(0);
    const key = `${msg.id}:${control.custom_id}`;
    if (this.siblings.has(msg.id)) {
      // Answering the second copy of a prompt starts its follow-ups afresh: they are not re-posts of the first's.
      for (const k of [...this.recent.keys()]) if (k.startsWith(`${msg.channel_id}:`) && !k.includes(":roll:") && !k.includes(":label:")) this.recent.delete(k);
    }
    this.pressed.add(key);
    this.answered.set(msg.id, { sig: signature(controlsOf(fresh.components)), at: Date.now() });
    this.recent.set(`${msg.channel_id}:label:${control.label}`, Date.now());
    this.inversePresses.push({ channel: msg.channel_id, id: normId(control.custom_id), label: normLabel(control.label), at: Date.now() });
    if (/reveal_stage_/.test(control.custom_id)) this.mgr.lastReveal.set(gameOf(this.store.channel(msg.channel_id) ?? {}, this.store.state.channels) ?? "", Date.now());
    const rollKind = /^combatRoll_[^_]+_[^_]+_(\w+)/.exec(control.custom_id)?.[1];
    if (rollKind) this.recent.set(`${msg.channel_id}:roll:${rollKind}`, Date.now());
    else if (/^combatRoll_/.test(control.custom_id)) this.recent.set(`${msg.channel_id}:roll:combat`, Date.now());
    const key0 = this.promptKey(fresh, controlsOf(fresh.components));
    for (const other of this.store.messages(msg.channel_id)) {
      if (other.id !== msg.id && (!other._ephemeral_for || other._ephemeral_for === this.userId) && this.promptKey(other, controlsOf(other.components)) === key0) this.siblings.add(other.id);
    }
    this.recent.set(key0, Date.now());
    this.recent.set(this.repostKey(msg, control), Date.now());
    this.lastPressed = msg.id;
    const pressGame = gameOf(this.store.channel(msg.channel_id) ?? {}, this.store.state.channels);
    if (pressGame) this.lastPressIn.set(pressGame, Date.now());
    const nonce = `autopilot-${++this.nonce}`;
    const done = new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => resolve("no answer from the bot"), 20000);
      this.waiting = {
        nonce,
        resolve: (err) => {
          clearTimeout(timer);
          resolve(err);
        },
      };
    });
    const op =
      control.kind === "select"
        ? { op: "select", nonce, channel_id: msg.channel_id, message_id: msg.id, custom_id: control.custom_id, values: control.values, component_type: 3 }
        : { op: "click", nonce, channel_id: msg.channel_id, message_id: msg.id, custom_id: control.custom_id };
    this.conn.send(op);
    const err = await done;
    this.mgr.forgetDrafts();
    this.waiting = null;
    const ch = this.store.channel(msg.channel_id);
    log.info(`autopilot ${this.name}: pressed "${control.label || control.custom_id}" in #${ch?.name ?? msg.channel_id} (${choice.why})${err ? ` -> failed: ${err}` : ""}`);
    if (err) {
      this.fails.set(msg.id, (this.fails.get(msg.id) ?? 0) + 1);
      if (++this.streak >= MAX_STREAK) {
        log.warn(`autopilot ${this.name}: ${this.streak} failures in a row; resting for a minute`);
        this.streak = 0;
        this.restUntil = Date.now() + 60000;
      }
    } else this.streak = 0;
    // Let the bot's answer land before deciding again.
    await sleep(this.drafting ? 250 : 600);
    return err;
  }

  // ---- the planner's view of this seat ----

  /** Engine answers already sent (decision id | option id): each is tried once; afterwards the heuristics take over. */
  private engineTried = new Set<string>();
  /** Answers this seat sent per decision id (capped at ENGINE_MAX_ANSWERS). */
  private engineAttempts = new Map<string, number>();
  /** Per decision id: the options this seat answered successfully (in order) and the revision of the last one. */
  private engineDone = new Map<string, { options: string[]; revision: number }>();

  /**
   * Typed decisions addressed to this seat (engine API): answered directly, with the target resolved by the engine
   * (no faction guessing from buttons). Returns false when the engine is unavailable or nothing typed is ours, so
   * the legacy rule table runs as before.
   */
  private async engineStep(): Promise<boolean> {
    const engine = this.mgr.engine;
    if (!engine) return false;
    for (const game of this.liveGames()) {
      const own = await engine.decisionsFor(game, this.userId);
      // Plus the table-wide setup steps (deal secrets, reveal objectives): no target and no window, any seat may
      // take them; the policy answers only when GameState.setup says the table is ready, the engine refuses otherwise.
      const open = (await engine.openDecisions(game)) ?? [];
      const table = open.filter(isTableSetupStep);
      const state = await engine.state(game, this.userId, 2000);
      // And the strategy cards we played: their windows list only followers; we resolve the primary on them.
      const holding = open.filter((d) => answersOutsideWindow(d, this.userId, state) && !own?.some((x) => x.id === d.id));
      const mine = [...(own ?? []), ...table, ...holding];
      if (!mine.length) continue;
      for (const d of mine) {
        const done = this.engineDone.get(d.id);
        const pick = chooseTyped(d, state, this.userId, {
          history: done?.options ?? [],
          lastRevision: done?.revision,
          open: mine.filter((x) => x.id !== d.id),
          all: open,
        });
        if (!pick) continue;
        // Reaction windows (table decisions) are re-revised by every save at the table, so their key leaves the revision
        // out: one answer per option per seat. Every decision gets at most ENGINE_MAX_ANSWERS answers from this seat
        // (live pbd36: a press that never registered in the window was re-sent 142 times).
        const windowed = d.scope === "table" || !!d.window;
        const what = pick.option ? pick.option.id : JSON.stringify(pick.payload);
        const key = windowed ? `${d.id}#${done?.options.length ?? 0}|${what}` : `${d.id}@${d.revision}#${done?.options.length ?? 0}|${what}`;
        if (this.engineTried.has(key)) continue;
        const attempts = (this.engineAttempts.get(d.id) ?? 0) + 1;
        if (attempts > ENGINE_MAX_ANSWERS) continue;
        this.engineAttempts.set(d.id, attempts);
        if (this.engineAttempts.size > 2000) this.engineAttempts.delete(this.engineAttempts.keys().next().value!);
        this.engineTried.add(key);
        if (this.engineTried.size > 5000) this.engineTried.clear();
        // The seq in the request id: a retry after "stale" (a window re-revised meanwhile) is a new request.
        const requestId = `${key}@${d.seq}`;
        const req = pick.payload
          ? { payload: pick.payload, expectedSeq: d.seq, requestId, userId: this.userId }
          : { optionId: pick.option?.id, expectedSeq: d.seq, requestId, userId: this.userId };
        const r = await this.mgr.serial(() => engine.answer(game, d.id, req));
        if (!r) return false;
        log.info(`autopilot ${this.name}: engine ${d.kind} "${pick.option?.label ?? "payload"}" in ${game} (${pick.why}) -> ${r.status}${r.error ? `: ${r.error}` : ""}`);
        if (d.kind === "draft.milty.pick") this.draftingSeenAt = Date.now();
        // The decision changed under us (windows are re-revised by every save at the table): not an answer; try again
        // on the next look with the fresh revision (live: bots' "Not Following" went stale and was never re-sent).
        if (r.status === "stale" && /changed/i.test(r.error ?? "")) {
          this.engineTried.delete(key);
          this.engineAttempts.set(d.id, attempts - 1);
          continue;
        }
        // Tell the legacy roll guard (mayRoll) about rolls made here, so it never rolls the same dice again.
        const rolled = pick.option?.value?.action === "roll" ? String(pick.option.value.rollType ?? "") : "";
        if (r.ok && rolled) this.recent.set(`${d.source.channelId}:roll:${rolled}`, Date.now());
        if (r.ok) {
          // What we answered on this decision (multi-part answers walk it; see engine/kinds/strategyPolicy.ts).
          this.engineDone.set(d.id, { options: [...(done?.options ?? []), ...(pick.option ? [pick.option.id] : [])], revision: d.revision });
          if (this.engineDone.size > 2000) this.engineDone.delete(this.engineDone.keys().next().value!);
          return true;
        }
      }
    }
    return false;
  }

  /** Games this seat sits in with something happening in the last hour (by their actions channel). */
  private liveGames(): string[] {
    const out: string[] = [];
    for (const ch of Object.values(this.store.state.channels)) {
      if (ch.type !== 0 || !/^[a-z]+\d+-actions$/i.test(String(ch.name ?? "")) || !this.store.canView(this.userId, ch.id)) continue;
      const last = this.store.messages(ch.id).at(-1);
      if (!last || Date.now() - Date.parse(last.timestamp) > 3600000) continue;
      out.push(/^([a-z]+\d+)-actions$/i.exec(String(ch.name))![1]);
    }
    return out;
  }

  private boards = new Map<string, { at: number; board: Board | null }>();

  private seat(): Seat {
    const self = this;
    const collect = (game: string, withControls: boolean): Prompt[] => {
      const s = self.store.state;
      const out: Prompt[] = [];
      for (const ch of Object.values(s.channels)) {
        if (![0, 11, 12].includes(ch.type) || !self.store.canView(self.userId, ch.id) || gameOf(ch, s.channels) !== game) continue;
        for (const m of self.store.messages(ch.id).slice(-WINDOW)) {
          if (m._ephemeral_for && m._ephemeral_for !== self.userId) continue;
          if (!s.users[m.author?.id]?.bot) continue;
          const controls = controlsOf(m.components);
          if (withControls && !controls.length) continue;
          out.push({ ch, m, controls });
        }
      }
      return out.sort((a, b) => (BigInt(a.m.id) < BigInt(b.m.id) ? -1 : 1));
    };
    return {
      userId: this.userId,
      get name() {
        return self.name;
      },
      faction: (game) => self.faction(game),
      prompts: (game) => collect(game, true),
      messages: (game) => collect(game, false),
      press: (p, c, why) => self.mgr.serial(() => self.press({ msg: p.m, control: c, score: 100, why })),
      board: async (game, fresh) => {
        const hit = self.boards.get(game);
        if (hit && !fresh && Date.now() - hit.at < 1500) return hit.board;
        let board: Board | null = null;
        try {
          const res = await fetch(`${self.mgr.botApi}/api/public/game/${encodeURIComponent(game)}/web-data`, { signal: AbortSignal.timeout(8000) });
          if (res.ok) board = parseBoard(game, (await res.json()) as Json, self.store.state.users);
        } catch {
          board = null;
        }
        self.boards.set(game, { at: Date.now(), board });
        return board;
      },
      movement: async (game, target, displacement) => {
        const token = Object.entries(self.store.state.seats).find(([, seat]) => seat.user_id === self.userId)?.[0];
        try {
          const res = await fetch(`${self.mgr.botApi}/api/game/${encodeURIComponent(game)}/movement`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ targetPosition: target, displacement }),
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
          return undefined;
        } catch (e) {
          return (e as Error).message;
        }
      },
      log: (text) => log.info(`autopilot ${self.name}: ${text}`),
      engine: this.mgr.engine ? this.seatEngine(this.mgr.engine) : undefined,
      engineOwns: (game, messageId) => self.mgr.engineOwns(game, messageId, self.userId),
      engineProduce: async (game, messageId, build) => {
        const engine = self.mgr.engine;
        if (!engine) return null;
        const d = (await engine.decisionsFor(game, self.userId))?.find((x) => x.kind === "production.produce" && x.source.messageId === messageId);
        if (!d || d.kind !== "production.produce") return null;
        const payload = productionPayload(d, build);
        const r = await self.mgr.serial(() => engine.answer(game, d.id, { payload: payload as unknown as Record<string, unknown>, expectedSeq: d.seq, requestId: `${d.id}@${d.revision}|produce`, userId: self.userId }));
        log.info(`autopilot ${self.name}: engine production.produce ${JSON.stringify(payload.units)} in ${game} -> ${r?.status ?? "no answer"}${r?.error ? `: ${r.error}` : ""}`);
        if (!r) return null;
        return r.ok ? undefined : (r.error ?? r.status);
      },
    };
  }

  /** The planner's typed engine access as this seat (answers go through the same serial queue as presses). */
  private seatEngine(engine: EngineClient): SeatEngine {
    const me = this.userId;
    const report = (what: string, game: string, r: AnswerResult | null) => {
      log.info(`autopilot ${this.name}: engine ${what} in ${game} -> ${r ? r.status : "unavailable"}${r?.error ? `: ${r.error}` : ""}`);
      return r;
    };
    return {
      decisions: async (game) => (await engine.openDecisions(game))?.filter((d) => awaits(d, me)) ?? null,
      answer: (game, d, optionId, why) =>
        this.mgr.serial(async () => report(`${d.kind} (${why})`, game, await engine.answer(game, d.id, { optionId, expectedSeq: d.seq, userId: me }))),
      move: (game, d, req, why) =>
        this.mgr.serial(async () => report(`tactical move (${why})`, game, await engine.act(game, d.id, "move", { ...req, expectedSeq: d.seq, userId: me }))),
      land: (game, d, req, why) =>
        this.mgr.serial(async () => report(`tactical land (${why})`, game, await engine.act(game, d.id, "land", { ...req, expectedSeq: d.seq, userId: me }))),
    };
  }
}

/** Keleres is drafted as one faction and played as one of three (keleresm / keleresx / keleresa). */
function family(faction: string | undefined) {
  return faction?.startsWith("keleres") ? "keleres" : faction;
}

/** The game a channel belongs to: `pbd7` for `pbd7-actions`, its table talk, and their threads. */
function gameOf(ch: Json, channels: Record<string, Json>): string | null {
  let c: Json | undefined = ch;
  if ([10, 11, 12].includes(c.type)) {
    const parent: Json | undefined = c.parent_id ? channels[c.parent_id] : undefined;
    if (!parent) return null;
    c = parent;
  }
  if (!c.parent_id) return null; // game channels live in a category
  const m = /^([a-z]+\d+)-/i.exec(String(c.name ?? ""));
  return m ? m[1] : null;
}

/** A private thread that belongs to this seat ("Cards Info-pbd7-<name>"): only it and the bot are members. */
function myThreadOwner(ch: Json, s: Json, me: string): boolean {
  const members: string[] = s.thread_members[ch.id] ?? [];
  if (!members.includes(me)) return false;
  const name = String(s.users[me]?.global_name ?? "");
  return !!name && String(ch.name ?? "").endsWith(`-${name}`);
}

/** The custom ids of a message's enabled controls, as Clients records them in `_presses`. */
function signature(controls: Control[]) {
  return controls
    .map((c) => c.custom_id)
    .sort()
    .join("|");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normId(customId: string) {
  return customId.replace(/^FFCC_[^_]+_/, "").toLowerCase();
}

function normLabel(label: string | undefined) {
  return String(label ?? "").trim().toLowerCase();
}

/** One control undoes the other: they differ only by an inverse prefix pair ("Galvanize 1 carrier" / "Ungalvanize 1 carrier"). */
export function areInverse(a: string, b: string) {
  if (!a || !b || a === b) return false;
  for (const [x, y] of INVERSE_PREFIXES) {
    for (const [p, q] of [[a, b], [b, a]]) {
      if (p.startsWith(x) && q.startsWith(y)) {
        const rest = p.slice(x.length);
        if (rest.length >= 4 && rest === q.slice(y.length)) return true;
      }
    }
  }
  return false;
}
