import { playerOf, type Board } from "./board.js";
import { baseId, lockOf, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";
import { chooseGoal } from "./strategy.js";
import { TACTICAL_ID, TacticalExecutor } from "./tactical.js";
import { CardPlanner } from "./cards.js";

/*
 * The planner of one autopilot seat: takes the decisions the rule table cannot (tactical actions, strategy card
 * primaries, scoring) and runs them through the bot's buttons. It gets the first look at every tick; whatever it
 * does not own is left to the rule table in autopilot.ts.
 */
export class Brain {
  private tactical: TacticalExecutor;
  private cards: CardPlanner;
  /** Turn prompts already answered (message id). */
  private handled = new Set<string>();

  constructor(private seat: Seat) {
    this.tactical = new TacticalExecutor(seat);
    this.cards = new CardPlanner(seat);
  }

  /** Prompts the rule table must leave alone in this game (the planner presses them). */
  owns(game: string, p: Prompt): boolean {
    const planning = this.tactical.owns(game);
    if (p.controls.some((c) => TACTICAL_ID.test(baseId(c.custom_id)) && (planning || !/^(place_|deleteButtons_)/.test(baseId(c.custom_id))))) return true;
    if (this.cards.owns(game, p)) return true;
    if (this.tactical.owns(game) && p.controls.some((c) => /^(spend_|reduceTG_)/.test(baseId(c.custom_id)))) return true;
    return false;
  }

  /** One planning step for a game. Returns true when it acted. */
  async tick(game: string): Promise<boolean> {
    const faction = await this.seat.faction(game);
    if (!faction) return false;
    if (this.tactical.owns(game)) {
      const board = await this.seat.board(game, true);
      return this.tactical.tick(board);
    }
    if (await this.cards.tick(game, faction)) return true;
    const prompts = this.seat.prompts(game);
    // A tactical action under way that we do not have a plan for (e.g. after a restart): finish it.
    const stray = [...prompts].reverse().find((p) => this.tactical.forMe(p, faction) && p.controls.some((c) => lockOf(c.custom_id) === faction && /^(concludeMove_|landUnits_|doneLanding|doneWithTacticalAction|tacticalActionBuild_)/.test(baseId(c.custom_id))));
    const turnOver = prompts.some((p) => p.controls.some((c) => c.custom_id === `FFCC_${faction}_turnEnd`));
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
    const turn = [...prompts].reverse().find((p) => p.controls.some((c) => c.custom_id === `FFCC_${faction}_tacticalAction`));
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
    const control = turn.controls.find((c) => c.custom_id === `FFCC_${faction}_tacticalAction`)!;
    this.tactical.start(game, goal, String(BigInt(turn.m.id)));
    const err = await this.seat.press(turn, control, `plan: ${goal.kind} ${goal.target}`);
    if (err) {
      this.seat.log(`Tactical Action press failed (${err}); dropping the plan`);
      this.tactical.plan = null;
      this.handled.delete(turn.m.id);
    }
    return true;
  }

  describe(board: Board) {
    return board.game;
  }
}
