import { playerOf, type Board } from "./board.js";
import { baseId, lockIs, lockOf, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";
import { chooseGoal } from "./strategy.js";
import { TACTICAL_ID, TacticalExecutor } from "./tactical.js";
import { CardPlanner } from "./cards.js";
import { ViolationDesk } from "./violations.js";
import { EngineTactical, TACTICAL_KINDS } from "./tacticalEngine.js";
import type { Decision } from "../engine/types.js";
import { passOption } from "../engine/policy/turn.js";

/*
 * The planner of one autopilot seat: takes the decisions the rule table cannot (tactical actions, strategy card
 * primaries, scoring) and runs them through the bot's buttons. It gets the first look at every tick; whatever it
 * does not own is left to the rule table in autopilot.ts.
 */
export class Brain {
  private tactical: TacticalExecutor;
  /** The same tactical action driven by typed engine decisions (preferred when the engine is up). */
  private engineTactical: EngineTactical | null;
  private cards: CardPlanner;
  private violations: ViolationDesk;
  /** Per game, the newest prompt when our last tactical action ended. */
  private retired = new Map<string, string>();
  /** Turn prompts already answered (message id). */
  private handled = new Set<string>();

  constructor(private seat: Seat) {
    this.tactical = new TacticalExecutor(seat);
    this.engineTactical = seat.engine ? new EngineTactical(seat, seat.engine) : null;
    this.cards = new CardPlanner(seat);
    this.violations = new ViolationDesk(seat);
  }

  /** The planner runs an action in this game (legacy or engine tactical job): the turn is not over. */
  busy(game: string): boolean {
    return this.tactical.owns(game) || !!this.engineTactical?.owns(game);
  }

  /** Prompts the rule table must leave alone in this game (the planner presses them). */
  owns(game: string, p: Prompt): boolean {
    const planning = this.tactical.owns(game) || !!this.engineTactical?.owns(game);
    if (p.controls.some((c) => TACTICAL_ID.test(baseId(c.custom_id)) && (planning || !/^(place_|deleteButtons_)/.test(baseId(c.custom_id))))) return true;
    if (this.cards.owns(game, p)) return true;
    if (this.violations.owns(game, p)) return true;
    if (planning && p.controls.some((c) => /^(spend_|reduceTG_)/.test(baseId(c.custom_id)))) return true;
    return false;
  }

  /** One planning step for a game. Returns true when it acted. */
  async tick(game: string): Promise<boolean> {
    const faction = await this.seat.faction(game);
    if (!faction) return false;
    const decisions = this.seat.engine ? await this.seat.engine.decisions(game) : null;
    if (this.engineTactical?.owns(game)) {
      const board = await this.seat.board(game, true);
      const acted = await this.engineTactical.tick(board, decisions ?? []);
      if (!this.engineTactical.owns(game)) this.retired.set(game, this.seat.prompts(game).at(-1)?.m.id ?? "0");
      return acted;
    }
    if (this.tactical.owns(game)) {
      const board = await this.seat.board(game, true);
      const acted = await this.tactical.tick(board);
      // Prompts of a finished action stay on the table (the bot does not delete them all): never take them up again.
      if (!this.tactical.owns(game)) this.retired.set(game, this.seat.prompts(game).at(-1)?.m.id ?? "0");
      return acted;
    }
    if (await this.cards.tick(game, faction)) return true;
    // Fleet pool / capacity reminders for us: fix or dismiss them (never during our own tactical action, above).
    if (await this.violations.tick(game, faction)) return true;
    if (decisions && this.engineTactical && (await this.engineRecover(game, decisions))) return true;
    if (decisions && this.engineTactical) {
      const menu = EngineTactical.turnMenu(decisions);
      if (menu) return this.engineTurn(game, menu);
    }
    const prompts = this.seat.prompts(game);
    // A tactical action under way that we do not have a plan for (e.g. after a restart): finish it.
    const retired = this.retired.get(game);
    // Our newest prompt, if it belongs to a tactical action (a later turn prompt means that action is over).
    const newest = [...prompts].reverse().find((p) => this.tactical.forMe(p, faction) && p.controls.some((c) => lockIs(c.custom_id, faction)));
    const stray = [newest].filter((p): p is Prompt => !!p && (!retired || BigInt(p.m.id) > BigInt(retired))).find((p) => this.tactical.forMe(p, faction) && p.controls.some((c) => lockIs(c.custom_id, faction) && /^(concludeMove_|landUnits_|doneLanding|doneWithTacticalAction|tacticalActionBuild_)/.test(baseId(c.custom_id))));
    const turnOver = prompts.some((p) => p.controls.some((c) => (lockIs(c.custom_id, faction) && baseId(c.custom_id) === "turnEnd")));
    const age = stray ? Date.now() - Date.parse(stray.m.edited_timestamp ?? stray.m.timestamp) : 0;
    if (stray && !turnOver && age > 20000 && age < 600000) {
      const board = await this.seat.board(game, true);
      const me = board ? playerOf(board, this.seat.userId) : undefined;
      if (board && me && board.activePlayer === me.color && board.phase === "action") {
        this.seat.log(`taking over a tactical action left half done in ${game}`);
        this.tactical.recover(game, String(BigInt(stray.m.id) - 1n));
        return this.tactical.tick(board);
      }
    }
    return this.turn(game, faction, prompts);
  }

  /** Our action-phase turn prompt: start a tactical action when that is the plan (the rule table plays cards / passes). */
  private async turn(game: string, faction: string, prompts: Prompt[]): Promise<boolean> {
    const turn = [...prompts].reverse().find((p) => p.controls.some((c) => (lockIs(c.custom_id, faction) && baseId(c.custom_id) === "tacticalAction")));
    if (!turn || this.handled.has(turn.m.id) || turn.m._presses?.[this.seat.userId]) return false;
    const ids = turn.controls.map((c) => baseId(c.custom_id));
    // After an action the bot offers End Turn on the same kind of prompt; an unplayed card goes first.
    if (ids.some((b) => /^(turnEnd|endOfTurnAbilities|strategicAction_\d+)$/.test(b))) return false;
    const board = await this.seat.board(game, true);
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    if (!board || !me || board.phase !== "action" || board.activePlayer !== me.color || me.passed) return false;
    const goal = chooseGoal(board, me);
    this.handled.add(turn.m.id);
    if (goal.kind === "pass") {
      this.seat.log(`passing: ${goal.why}`);
      return false;
    }
    this.seat.log(goal.kind === "produce" ? goal.why : `planned ${goal.why}`);
    const control = turn.controls.find((c) => (lockIs(c.custom_id, faction) && baseId(c.custom_id) === "tacticalAction"))!;
    this.tactical.start(game, goal, String(BigInt(turn.m.id)));
    const err = await this.seat.press(turn, control, `plan: ${goal.kind} ${goal.target}`);
    if (err) {
      this.seat.log(`Tactical Action press failed (${err}); dropping the plan`);
      this.tactical.plan = null;
      this.handled.delete(turn.m.id);
    }
    return true;
  }

  /** A tactical decision of ours left half done (e.g. after a restart) while it is our turn: finish it. */
  private async engineRecover(game: string, decisions: Decision[]): Promise<boolean> {
    const stray = decisions.filter((d) => d.target?.userId === this.seat.userId && TACTICAL_KINDS.has(d.kind) && d.kind !== "tactical.activate");
    const age = stray.length ? Date.now() - Math.max(...stray.map((d) => d.createdAt)) : 0;
    if (!stray.length || age < 20000 || age > 600000) return false;
    const board = await this.seat.board(game, true);
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    if (!board || !me || board.activePlayer !== me.color || board.phase !== "action") return false;
    this.seat.log(`taking over a tactical action left half done in ${game} (engine)`);
    this.engineTactical!.recover(game);
    return this.engineTactical!.tick(board, decisions);
  }

  /** Our start-of-turn menu as a typed decision: start a tactical action when that is the plan. */
  private async engineTurn(game: string, menu: Extract<Decision, { kind: "turn.action" }>): Promise<boolean> {
    const key = `${menu.id}#${menu.revision}`;
    if (this.handled.has(key)) return false;
    // An unplayed strategy card goes first (the strategy policy plays it).
    if (menu.options.some((o) => !o.disabled && o.value?.action === "strategic")) return false;
    const board = await this.seat.board(game, true);
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    if (!board || !me || board.phase !== "action" || board.activePlayer !== me.color || me.passed) return false;
    const goal = chooseGoal(board, me);
    this.handled.add(key);
    if (goal.kind === "pass") {
      // No tactical job: pass now (policy/turn.ts would after its grace period; never with a strategy card unplayed).
      const pass = passOption(menu.options);
      if (!pass || me.scs.some((n) => !me.exhaustedSCs.includes(n))) return false;
      const r = await this.seat.engine!.answer(game, menu, pass.id, `passing: ${goal.why}`);
      return !!r?.ok;
    }
    this.seat.log(goal.kind === "produce" ? goal.why : `planned ${goal.why}`);
    return this.engineTactical!.start(game, menu, goal);
  }

  describe(board: Board) {
    return board.game;
  }
}
