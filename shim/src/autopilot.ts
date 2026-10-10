import type { Hub } from "./hub.js";
import type { Clients } from "./clients.js";
import type { Json, StoredMessage } from "./store.js";
import { log } from "./log.js";
import { Brain } from "./botplay/brain.js";
import { parseBoard, type Board } from "./botplay/board.js";
import { controlsOf, type Control, type Prompt } from "./botplay/prompts.js";
import type { Seat } from "./botplay/seat.js";
import { TradeDesk } from "./botplay/trade.js";

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
  /**
   * Only while the game is in a matching phase (the bot's web-data phase, e.g. `status.homework`). Table windows stay
   * on the table after their phase ends, and the bot acts on a late press anyway: a "Ready For Strategy Phase" pressed
   * in the next action phase ends that round on the spot.
   */
  phase?: RegExp;
};

/** Strategy cards an autopilot likes, best first (1 Leadership, 7 Technology, 8 Imperial, 6 Warfare, ...). */
const SC_PREFERENCE = [1, 7, 8, 6, 5, 4, 3, 2];

/** Never pressed: take-backs, admin / settings, info, modals, and actions with real consequences we do not plan. */
const BLOCKED_ID =
  /(ultimateUndo|^undo|deleteButtons|requestAllFollow|moveAlongAfterAllHaveReacted|^transaction$|getModifyTiles|showMap|showPlayerAreas|offerPlayerPref|searchMyGames|showObjInfo|chooseMapView|resolvePreassignment_(?!Abstain On Agenda$|Pass On Shenanigans$)|^queueAWhen|^queueAnAfter|^preVote|unlockQueued|distinguished_|eraseMy|proceedToVoting|pingNonresponders|refreshAgenda|refresh|notepad|cardsInfo|showGameAgain|offerDeckButtons|gameInfoButtons|miltyFactionInfo|showMiltyDraft|checkCombatACs|announceARetreat|^retreat_|getRepairButtons|announceReadyForDice|ac_play_from_hand|getDiscardButtonsACs|^sabotage_|forceAbstain|tacticalAction|componentAction|doAnotherAction|endTurnWhenAllReactedTo|^jmf|chooseExp_|setupBaseGameMode|startTFGame|frankenSetup|offerGameOptionButtons|getHomebrewButtons|offerTEOptionButtons|miltySetup|startDraftSystem|addMapString|~MDL|sendTradeHolder|acceptOffer|resetOffer|resetMyVote|wrongButtonEphemeral|leadershipGenerateCCButtons|redistributeCCButtons|^sc_follow|^sc_trade_follow|toggleTfHomebrew|gain_CC|deal2SOToAll|startOfGameObjReveal|run_status_cleanup|^showDeck|^offerInfoButtons|^setPath_|^bindsToGame|^applytoreceive|^getStartingTech|purge|^draftPresets|startPlayerSetup|setupPlayer|^player_setup|purgeOverrule|queueMil|MiltyQueue|drawSpecificSO|get_so_discard_buttons|answerSurvey|noSupportSwaps|offerSurvey|draftPresetKeleres|explain|preScoreObbie|^reduceTG|^reduceComm|resetSpend|^exhaust|^spend|^sc_(?!no_follow|3_assign_speaker_to_)|^score|_score|^po_scoring|^get_so_|endGameMostPoints|^rematch|reveal_stage_none|checkForAllACAssignments|increase_(fleet|strategy|tactic)_cc|blessBoonCC|placeCCBack_|spendAStratCC)/i;
const BLOCKED_LABEL = /^(undo|un-|unqueue|spend|exhaust|retrieve|reassign|reset|remove|erase|be asked again|delete|dismiss|refresh|.*\binfo$|show |request all|pause timer|\(for others\))/i;

const RULES: Rule[] = [
  // Milty draft (only offered when the draft says it is this seat's pick; see milty()).
  { id: /^milty_slice_/, score: 92, why: "draft: first slice" },
  { id: /^milty_faction_/, score: 91, why: "draft: first faction" },
  { id: /^milty_order_/, score: 90, why: "draft: first speaker order" },
  // Setup: keep the first secret objective, discard the other.
  { id: /^discardSecret_/, score: 80, retry: true, addressed: true, last: true, why: "setup: keep the first secret objective" },
  // Setup: Keleres picks its flavor once the draft is over (the player's own setup waits on it).
  { id: /^setupStep5_\d+_keleres[a-z]_/, score: 84, addressed: true, why: "setup: Keleres flavor" },
  // Setup: starting technology. Most factions get a list of their allowed techs (getTech_<alias>__noPay__comp, once
  // or twice); open choices come as "Get a Technology" → a tech type → a tech; Keleres asks once the others are done.
  { id: /(^|_)acquireAFreeTech$/, score: 83, addressed: true, retry: true, why: "setup: get a starting technology" },
  { id: /(^|_)getAllTechOfType_/, score: 82, addressed: true, retry: true, why: "setup: first technology type" },
  { id: /(^|_)getTech_.+__noPay/, score: 81, addressed: true, retry: true, distinct: true, why: "setup: first starting technology" },
  { id: /(^|_)getKeleresTechOptions$/, score: 60, addressed: true, why: "setup: Keleres technology options" },
  // Strategy phase.
  {
    id: /_scPick_\d+$/,
    score: 80,
    retry: true,
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
  { id: /^getDamageButtons_/, score: 50, why: "combat: assign hits" },
  // Async-only preference question (auto-pass on Sabotage after N hours): the shortest timer, once; it stops the
  // question for this seat in later games. The autopilot answers Sabotage windows itself anyway.
  { id: /^setAutoPassMedian_1$/, score: 40, why: "preferences: auto-pass on Sabotage" },
  // Async-only preference questions: let the bot auto-pass our secret-objective scoring.
  { id: /^sandbagPref_bot$/, score: 40, why: "preferences: let the bot auto-pass secret scoring" },
  // Status phase: after everyone scored, someone reveals the next public objective (once per game per round; see
  // revealOnce).
  { id: /(^|_)reveal_stage_(1|2)(position_\d+)?$/, score: 63, table: true, phase: /^status/, why: "status: reveal the next public objective" },
  // Trades offered to us.
  { id: /^rejectOffer_/, score: 74, why: "reject transaction" },
  // Reaction windows everyone answers.
  { id: /^sc_no_follow_\d+$/, score: 70, table: true, why: "strategy card: not following" },
  { id: /^no_sabotage$/, score: 70, table: true, why: "no sabotage" },
  { id: /^no_when(_persistent)?$/, score: 70, table: true, phase: /^agenda/, why: "agenda: no whens" },
  { id: /^no_after(_persistent)?$/, score: 70, table: true, phase: /^agenda/, why: "agenda: no afters" },
  { id: /^po_no_scoring$/, score: 66, table: true, again: true, phase: /^status/, why: "status: no public objective" },
  { id: /^so_no_scoring$/, score: 65, table: true, again: true, phase: /^status/, why: "status: no secret objective" },
  { id: /^pass_on_abilities$/, score: 60, table: true, phase: /^status/, why: "status: ready for strategy phase" },
  // Prompts addressed to us: move on.
  {
    label: /^(done|confirm|ready|no\b|decline|skip|pass\b|not following|end turn|continue|finish|none|no thanks)/i,
    score: 30,
    why: "decline / move on",
  },
];

/** Optional ability offers: never the fallback answer (a rule must score them explicitly). */
const OPTIONAL_LABEL = /\b(use|using|agent|commander|hero|promissory|exhaust|play|purge|spend|pay|ability|on someone else|activate|trigger|steal|swap)\b/i;
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
const WINDOW = 30;
/** A message whose presses failed this often is ignored. */
const MAX_FAILS = 2;
/** After this many failures in a row the seat rests for a minute. */
const MAX_STREAK = 8;
/** A control on a re-posted prompt with the same text is not pressed again within this time. */
const REPOST_MS = 60000;
/** A lost press on a `retry` prompt is tried again after this long (at most MAX_RETRIES times). */
const RETRY_MS = 20000;
const MAX_RETRIES = 3;
const BUSY_TEXT = /hasn't finished processing the last task/i;

export class Autopilot {
  private pilots = new Map<string, SeatPilot>();
  /** One autopilot press at a time across the table: the bot handles each game's presses in order anyway. */
  private chain: Promise<unknown> = Promise.resolve();
  private drafts = new Map<string, { at: number; data: Json | null }>();
  private webFactions = new Map<string, { at: number; map: Map<string, string> }>();

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

  async phaseOf(game: string): Promise<string | null> {
    return (await this.stateOf(game))?.phase ?? null;
  }

  /** Each seat's faction in a game, from the bot's web data (cached; refetched at most every 20s while unknown). */
  async factionOf(game: string, userId: string): Promise<string | undefined> {
    const hit = this.webFactions.get(game);
    if (hit?.map.has(userId)) return hit.map.get(userId);
    if (hit && Date.now() - hit.at < 20000) return undefined;
    const map = new Map<string, string>();
    try {
      const res = await fetch(`${this.botApi}/api/public/game/${encodeURIComponent(game)}/web-data`);
      if (res.ok) {
        const data = (await res.json()) as Json;
        for (const p of data.playerData ?? []) if (p.discordId && p.faction && p.faction !== "null") map.set(String(p.discordId), String(p.faction));
      }
    } catch {
      /* bot API down: fall back to the draft state */
    }
    this.webFactions.set(game, { at: Date.now(), map });
    return map.get(userId);
  }

  /** The bot's draft state for a game (cached briefly): whose pick it is, and each player's faction. */
  async draft(game: string, maxAgeMs = 1500): Promise<Json | null> {
    const hit = this.drafts.get(game);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;
    let data: Json | null = null;
    try {
      const res = await fetch(`${this.botApi}/api/public/game/${encodeURIComponent(game)}/draft`);
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
  private factions = new Map<string, string>();
  /** When we last pressed a control by `${channel}:${custom id}:${content}`: the bot often re-posts a prompt. */
  private recent = new Map<string, number>();
  /** Messages we pressed on, with their controls then: answered until the bot changes them. */
  private answered = new Map<string, { sig: string; at: number }>();
  /** Per channel, when the bot last nudged us there ("the queue is currently waiting on you"). */
  private nudges = new Map<string, number>();
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
  /** Trades: answers offers, proposes N-1 washes, runs the Trade card deal (botplay/trade.ts). */
  private trade: TradeDesk;

  constructor(
    private mgr: Autopilot,
    readonly userId: string,
  ) {
    this.conn = mgr.clients.attachVirtual(userId, (f) => this.onFrame(f));
    this.brain = new Brain(this.seat());
    this.trade = new TradeDesk(this.seat(), mgr.botApi, () => Object.entries(this.store.state.seats).find(([, seat]) => seat.user_id === this.userId)?.[0]);
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
        if (f.message?.ephemeral && BUSY_WRONG.test(f.message.content ?? "") && this.lastPressed) {
          this.fails.set(this.lastPressed, MAX_FAILS);
        }
        // The bot refused our press because it was busy (the shim re-sends a few times first): let `retry`
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

  private async think() {
    if (this.busy || this.stopped || !this.mgr.hub.gateway.botReady) return;
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
        if ((await acted("planner", () => this.brain.tick(game))) || (await acted("trade desk", () => this.trade.tick(game)))) {
          this.busy = false;
          this.schedule();
          return;
        }
      }
      const choice = await this.decide();
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
      const faction = this.factions.get(game) ?? family(await this.mgr.factionOf(game, this.userId));
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
    if (this.brain.owns(game, { ch, m, controls }) || this.trade.owns(game, { ch, m, controls })) return null;
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
    if (answered && press && !mine && Date.parse(press.at) < this.started && !lost && !this.tableStalled(m, game) && !controls.some((c) => /^combatRoll_/.test(c.custom_id))) return null;
    const unpressed = controls;
    // Combat rolls are pressed once per combat round on the same message (mayRoll decides).
    const reusable = (c: Control) => /^combatRoll_/.test(c.custom_id);
    controls = controls.filter((c) => reusable(c) || (!this.pressed.has(`${m.id}:${c.custom_id}`) && (sibling || !this.pressedRecently(m, c))));

    const faction = await this.faction(game, m);
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
    const ffccMine = !!faction && controls.some((c) => ffcc(c) === faction);
    // Only we are named in an actions-channel post ("@Bot Beta, as Speaker, please decide a winner").
    const calledOut = mentionsMe && ch.type === 0 && !(m.mention_roles ?? []).length && !/is up to draft/.test(content);
    // Other factions' buttons, and the controls we never press.
    const ours = controls.filter((c) => !ffcc(c) || ffcc(c) === faction);
    controls = ours.filter((c) => !BLOCKED_ID.test(c.custom_id.replace(/^FFCC_[^_]+_/, "")) && !BLOCKED_LABEL.test(c.label.trim()));
    if (!controls.length) {
      // Say so (once) when a prompt that is certainly ours offers nothing we may press: a likely stall.
      if ((ffccMine || m._ephemeral_for === me || calledOut) && !this.answered.has(m.id) && !this.skipped.has(m.id) && Date.now() - Date.parse(m.timestamp) < 600000) {
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
    const strong = m._ephemeral_for === me || ffccMine || (m._prompted_for === me && !mentionsOther) || (ownThread && mentionsMe && !mentionsOther);
    const ctx: Ctx = {
      addressed: m._ephemeral_for === me || ffccMine || ((mentionsMe || ownThread) && !mentionsOther),
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
      const fighting = !st || st.combat;
      controls = controls.filter((c) => !/^combatRoll_/.test(c.custom_id) || (fighting && this.mayRoll(ch.id, c.custom_id, faction)));
    }

    let phase: string | null | undefined;
    for (const rule of RULES) {
      if (!rule.table && !ctx.direct) continue;
      if (rule.addressed && !ctx.addressed) continue;
      if (rule.retry && lost && (this.tableStalled(m, game) || (await this.myTurn(game)) || String((await this.mgr.phaseOf(game)) ?? "").startsWith("setup"))) {
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
      if (answered && !rule.again) continue;
      // A table window we answered once stays answered, even if the bot edited it since (e.g. after a restart),
      // unless the whole game has been quiet for a while since: then our answer may have been lost (refused while the
      // bot was busy, or the bot restarted), and answering again is harmless.
      if (rule.table && !rule.why.startsWith("status: reveal") && (press || answered) && this.tableStalled(m, game)) {
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
      if (rule.table && !rule.again && press) continue;
      if (rule.again && rule.why !== "combat: roll dice" && press && !mine && Date.parse(press.at) < this.started) continue;
      if (rule.why.startsWith("status: reveal") && !this.mayReveal(m, game)) continue;
      if (rule.why === "setup: Keleres technology options" && !(await this.othersHaveStartingTech(game))) continue;
      // "Ready For Strategy / Agenda Phase": the last press moves the whole table on, so it must never be ours while a
      // person at the table is still doing their status-phase steps. Answer only after every person said ready.
      if (/pass_on_abilities/.test(String(rule.id)) && !(await this.peopleReady(m, game))) continue;
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
    if (!ctx.strong || answered || TAKE_BACK_TEXT.test(content)) return null;
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
    for (const other of this.store.messages(m.channel_id)) {
      if (BigInt(other.id) <= BigInt(m.id)) continue;
      if (/public objective has been revealed|already revealed this round/i.test(String(other.content ?? ""))) return false;
      if (controlsOf(other.components).some((c) => /reveal_stage_/.test(c.custom_id))) return false;
    }
    return true;
  }

  /**
   * Keleres takes its starting technologies from the other players', and the bot offers them only once (pressed too
   * early, Keleres gets prompts with no buttons and the game cannot deal secrets). Wait until every other player but
   * Sardakk (no starting technology) owns one and no starting-technology prompt is left anywhere in the game.
   */
  private async othersHaveStartingTech(game: string) {
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

  /** The same control on a re-posted copy of a prompt we answered within the last minute. */
  private pressedRecently(m: StoredMessage, c: Control) {
    const at = this.recent.get(this.repostKey(m, c));
    return at !== undefined && Date.now() - at < REPOST_MS;
  }

  private mayRoll(channelId: string, customId: string, faction: string | undefined): boolean {
    const kind = /^combatRoll_[^_]+_[^_]+_?(\w+)?/.exec(customId)?.[1];
    if (kind && kind !== "space" && kind !== "ground") {
      const key = `${channelId}:roll:${kind}`;
      return !this.recent.has(key);
    }
    if (!faction) return false;
    // A combat thread ("…-turn-4-letnev-vs-ralnel") is only ours to roll in if our faction fights in it.
    const chName = String(this.store.channel(channelId)?.name ?? "").toLowerCase();
    if (/-vs-/.test(chName) && !chName.includes(faction)) return false;
    // Our roll's result may not have arrived yet.
    if (Date.now() - (this.recent.get(`${channelId}:roll:combat`) ?? 0) < 15000) return false;
    let mine = 0;
    let theirs = 0;
    for (const m of this.store.messages(channelId)) {
      const who = /^<a?:(\w+):\d+>\s*rolls for .*combat/i.exec(String(m.content ?? ""))?.[1]?.toLowerCase();
      if (!who) continue;
      if (faction.startsWith(who) || who.startsWith(faction)) mine++;
      else theirs++;
    }
    return mine <= theirs;
  }

  /** Milty draft: when it is our pick, the first option of a category we have not drafted yet. */
  private async milty(m: StoredMessage, controls: Control[], game: string): Promise<Choice | null> {
    // Always read the draft fresh: a stale copy makes us miss our turn until the next poll.
    const draft = await this.mgr.draft(game, 0);
    if (draft?.status === "drafting") this.draftingSeenAt = Date.now();
    if (!draft || draft.status !== "drafting" || String(draft.currentPlayer) !== this.userId) return null;
    const mine = (draft.players ?? []).find((p: Json) => String(p.userId) === this.userId);
    const have = new Set<string>((mine?.picks ?? []).map((p: Json) => (p.type === "speakerOrder" ? "order" : p.type)));
    const open = controls.filter((c) => {
      const kind = /^milty_(slice|faction|order)_/.exec(c.custom_id)?.[1];
      return kind && !have.has(kind);
    });
    if (!open.length) return null;
    const kind = /^milty_(\w+?)_/.exec(open[0].custom_id)![1];
    const rule = RULES.find((r) => r.id?.test(open[0].custom_id))!;
    return { msg: m, control: open[0], score: rule.score, why: `draft: first ${kind}` };
  }

  /** This seat's faction in a game: from the bot's draft state, else learned from buttons addressed to us. */
  private async faction(game: string, m: StoredMessage): Promise<string | undefined> {
    const known = this.factions.get(game);
    if (known) return known;
    const fromWeb = await this.mgr.factionOf(game, this.userId);
    if (fromWeb) {
      this.factions.set(game, family(fromWeb)!);
      return family(fromWeb);
    }
    const draft = await this.mgr.draft(game, 10000);
    const mine = (draft?.players ?? []).find((p: Json) => String(p.userId) === this.userId);
    if (mine?.faction) {
      this.factions.set(game, family(String(mine.faction))!);
      return family(String(mine.faction));
    }
    const content = String(m.content ?? "");
    if (content.includes(`<@${this.userId}>`) && !(m.mentions ?? []).some((u: Json) => u.id !== this.userId)) {
      const ids = controlsOf(m.components)
        .map((c) => /^FFCC_([^_]+)_/.exec(c.custom_id)?.[1])
        .filter(Boolean);
      if (ids.length && ids.every((f) => f === ids[0])) {
        this.factions.set(game, family(ids[0])!);
        return family(ids[0]);
      }
    }
    return undefined;
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
    await sleep(0);
    const key = `${msg.id}:${control.custom_id}`;
    if (this.siblings.has(msg.id)) {
      // Answering the second copy of a prompt starts its follow-ups afresh: they are not re-posts of the first's.
      for (const k of [...this.recent.keys()]) if (k.startsWith(`${msg.channel_id}:`) && !k.includes(":roll:") && !k.includes(":label:")) this.recent.delete(k);
    }
    this.pressed.add(key);
    this.answered.set(msg.id, { sig: signature(controlsOf(fresh.components)), at: Date.now() });
    this.recent.set(`${msg.channel_id}:label:${control.label}`, Date.now());
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
      faction: async (game) => {
        const known = self.factions.get(game);
        if (known) return known;
        const f = family(await self.mgr.factionOf(game, self.userId));
        if (f) self.factions.set(game, f);
        return f;
      },
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
