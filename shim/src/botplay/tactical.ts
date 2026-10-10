import { countUnit, playerOf, type Board, type PlayerView } from "./board.js";
import { baseId, lockOf, snowflakeAfter, type Control, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";
import { BuildJob } from "./production.js";
import { promptForMe } from "./steps.js";
import { spendable, type ExpandGoal, type Goal, type ProduceGoal } from "./strategy.js";

/*
 * Executing a tactical action through the bot's own buttons, one step per tick:
 * Tactical Action → ring menu → system → (movement API) → Done moving → land → explore (rule table) →
 * produce + pay → Conclude Tactical Action. The rule table ends the turn afterwards.
 * Every stage has a deadline; past it the plan presses the furthest "move on" button it can see (Done moving,
 * Done Landing, Done Producing, Done Exhausting, Conclude) and after a few of those gives the prompts back to the
 * rule table, so a turn is never left hanging.
 */

/** Bot controls that belong to a tactical action (the rule table leaves them to the plan). */
export const TACTICAL_ID =
  /^(ring_|ringTile_|getTilesThisFarAway_|tacticalMoveFrom_|concludeMove_|unitTacticalMove_|doneWithOneSystem_|landUnits_|spaceUnits_|doneLanding|tacticalActionBuild_|place_|deleteButtons_tacticalAction|doneWithTacticalAction|ChooseDifferentDestination|resetTacticalMovement|moveFromTilePage_)/;

type Stage = "activate" | "move" | "land" | "post" | "build" | "conclude" | "done";

/** Deadline per stage before the plan pushes on by itself. */
const STAGE_MS = 45000;
/** Explores and other follow-ups get this much quiet before the action is concluded. */
const SETTLE_MS = 5000;
const SETTLE_MAX_MS = 40000;

export type PlanState = {
  game: string;
  goal: ExpandGoal | ProduceGoal | { kind: "recover"; why: string };
  stage: Stage;
  target: string | null;
  /** Prompts newer than this message belong to this action. */
  since: string | undefined;
  stageAt: number;
  progressAt: number;
  escalations: number;
  posted?: { at: number; baseline: string | undefined; error?: string };
  /** planet → infantry still to land. */
  toLand: Record<string, number>;
  build?: string[];
  postAt?: number;
  /** Controls pressed: `${message id}:${custom id}` → the message's control signature then. */
  pressed: Map<string, string>;
  ringsTried: Set<string>;
  job?: BuildJob;
};

const sig = (p: Prompt) =>
  p.controls
    .map((c) => c.custom_id)
    .sort()
    .join("|");

export class TacticalExecutor {
  plan: PlanState | null = null;

  constructor(private seat: Seat) {}

  start(game: string, goal: Goal & { kind: "expand" | "produce" }, since: string | undefined) {
    this.plan = {
      game,
      goal,
      stage: "activate",
      target: goal.target,
      since,
      stageAt: Date.now(),
      progressAt: Date.now(),
      escalations: 0,
      toLand: goal.kind === "expand" ? { ...goal.land } : {},
      pressed: new Map(),
      ringsTried: new Set(),
    };
  }

  /** Takes over a tactical action already in progress (e.g. after a restart): pushes it to its end. */
  recover(game: string, since: string | undefined) {
    this.plan = {
      game,
      goal: { kind: "recover", why: "finish a tactical action already under way" },
      stage: "move",
      target: null,
      since,
      stageAt: Date.now(),
      progressAt: Date.now(),
      escalations: 0,
      toLand: {},
      pressed: new Map(),
      ringsTried: new Set(),
    };
  }

  owns(game: string) {
    return !!this.plan && this.plan.game === game;
  }

  private setStage(stage: Stage) {
    if (!this.plan) return;
    this.plan.stage = stage;
    this.plan.stageAt = Date.now();
    this.plan.progressAt = Date.now();
  }

  /** The newest prompt for me (after the plan started) with a control whose base id matches. */
  private find(faction: string, match: (base: string, c: Control) => boolean, after?: string): { p: Prompt; c: Control } | null {
    const plan = this.plan!;
    const prompts = this.seat.prompts(plan.game);
    for (let i = prompts.length - 1; i >= 0; i--) {
      const p = prompts[i];
      if (!snowflakeAfter(p.m.id, after ?? plan.since)) break;
      if (!this.forMe(p, faction)) continue;
      const c = p.controls.find((x) => (!lockOf(x.custom_id) || lockOf(x.custom_id) === faction) && match(baseId(x.custom_id), x));
      if (c) return { p, c };
    }
    return null;
  }

  forMe(p: Prompt, faction: string) {
    return promptForMe(this.seat, p, faction);
  }

  private async press(p: Prompt, c: Control, why: string, repeatable = false) {
    const plan = this.plan!;
    const key = `${p.m.id}:${c.custom_id}`;
    // The same control on an unchanged message: the bot has not answered our last press yet.
    if (plan.pressed.get(key) === sig(p) && Date.now() - plan.progressAt < (repeatable ? 1500 : 8000)) return false;
    plan.pressed.set(key, sig(p));
    plan.progressAt = Date.now();
    const err = await this.seat.press(p, c, `plan: ${why}`);
    if (err) {
      this.seat.log(`plan step "${c.label}" failed: ${err}`);
      return true;
    }
    return true;
  }

  /** One step of the plan. Returns true when it pressed something (or called the bot's API). */
  async tick(board: Board | null): Promise<boolean> {
    const plan = this.plan;
    if (!plan) return false;
    const faction = await this.seat.faction(plan.game);
    if (!faction) return false;
    const me = board ? playerOf(board, this.seat.userId) : undefined;

    // The turn moved on (our turn prompt with End Turn is up, or it is not our turn any more): the plan is over.
    if (board && me && (board.activePlayer !== me.color || board.phase !== "action") && Date.now() - plan.stageAt > 5000) {
      this.seat.log(`plan over (${board.phase}, active ${board.activePlayer})`);
      this.plan = null;
      return false;
    }
    // The bot offers End Turn once the action is concluded.
    if ((plan.stage === "done" || plan.stage === "conclude") && this.find(faction, (b) => /^turnEnd$|^endOfTurnAbilities$/.test(b))) {
      this.plan = null;
      return false;
    }

    if (Date.now() - plan.progressAt > STAGE_MS) return this.escalate(faction, board, me);

    switch (plan.stage) {
      case "activate":
        return this.activate(faction, board);
      case "move":
        return this.move(faction, me);
      case "land":
        return this.land(faction);
      case "post":
        return this.post(faction, board, me);
      case "build":
        return this.produce(faction, board, me);
      case "conclude":
      case "done": {
        const hit = this.find(faction, (b) => b === "doneWithTacticalAction");
        if (hit) {
          this.setStage("done");
          return this.press(hit.p, hit.c, "conclude the tactical action");
        }
        return false;
      }
    }
  }

  private async activate(faction: string, board: Board | null): Promise<boolean> {
    const plan = this.plan!;
    const moving = this.find(faction, (b) => /^concludeMove_/.test(b));
    if (moving) {
      const pos = baseId(moving.c.custom_id).replace("concludeMove_", "");
      if (pos !== plan.target) {
        this.seat.log(`activated ${pos} instead of ${plan.target}; moving nothing`);
        plan.target = pos;
        if (plan.goal.kind === "expand") plan.goal = { kind: "produce", target: pos, why: "fallback activation" };
      }
      this.setStage("move");
      return this.move(faction, board ? playerOf(board, this.seat.userId) : undefined);
    }
    const menu = this.find(faction, (b) => /^(ringTile_|ring_|getTilesThisFarAway_)/.test(b));
    if (!menu) return false;
    const target = plan.target!;
    const ids = menu.p.controls.filter((c) => !lockOf(c.custom_id) || lockOf(c.custom_id) === faction);
    const direct = ids.find((c) => baseId(c.custom_id) === `ringTile_${target}`);
    if (direct) return this.press(menu.p, direct, `activate ${target}`);
    const ring = ringButton(ids, target, plan.ringsTried);
    if (ring) {
      plan.ringsTried.add(ring.custom_id);
      return this.press(menu.p, ring, `open "${ring.label}" to find ${target}`);
    }
    // Lost in the menus: activate a system with our dock if offered (production), else give up on moving.
    const dock = ids.find((c) => /^ringTile_/.test(baseId(c.custom_id)) && c.label && board && dockOf(board, faction, baseId(c.custom_id).slice(9)));
    if (dock) {
      plan.target = baseId(dock.custom_id).slice(9);
      plan.goal = { kind: "produce", target: plan.target, why: "fallback activation" };
      return this.press(menu.p, dock, `cannot find ${target}; activate ${plan.target} to produce instead`);
    }
    return false;
  }

  private async move(faction: string, me: PlayerView | undefined): Promise<boolean> {
    const plan = this.plan!;
    const target = plan.target;
    const conclude = this.find(faction, (b) => /^concludeMove_/.test(b) && (!target || b === `concludeMove_${target}`));
    if (!conclude) {
      // Already past movement (e.g. recovering)?
      if (this.find(faction, (b) => /^(landUnits_|doneLanding|doneWithTacticalAction|tacticalActionBuild_)/.test(b))) {
        this.setStage("land");
        return this.land(faction);
      }
      return false;
    }
    if (!target) plan.target = baseId(conclude.c.custom_id).replace("concludeMove_", "");
    const goal = plan.goal;
    if (goal.kind === "expand" && me && !plan.posted) {
      const displacement: Record<string, { unitType: string; colorID: string; counts: number[] }[]> = {};
      for (const m of goal.moves) {
        (displacement[`${m.origin}-${m.holder}`] ??= []).push({ unitType: m.unit, colorID: me.color, counts: [m.count, 0, 0, 0] });
      }
      const newest = this.seat.prompts(plan.game).at(-1)?.m.id;
      plan.posted = { at: Date.now(), baseline: newest };
      plan.progressAt = Date.now();
      const err = await this.seat.movement(plan.game, plan.target!, displacement);
      if (err) {
        plan.posted.error = err;
        this.seat.log(`movement API refused (${err.slice(0, 160)}); concluding without moving`);
        plan.toLand = {};
      } else this.seat.log(goal.why);
      return true;
    }
    if (plan.posted && !plan.posted.error && Date.now() - plan.posted.at < 12000) {
      // The API answers with a fresh movement prompt; press its Done moving, not the old one's.
      const fresh = this.find(faction, (b) => b === `concludeMove_${plan.target}`, plan.posted.baseline);
      if (!fresh) return false;
      this.setStage("land");
      return this.press(fresh.p, fresh.c, `done moving into ${plan.target}`);
    }
    this.setStage("land");
    return this.press(conclude.p, conclude.c, `done moving into ${plan.target}`);
  }

  private async land(faction: string): Promise<boolean> {
    const plan = this.plan!;
    const landing = this.find(faction, (b) => /^(landUnits_|doneLanding)/.test(b));
    if (landing) {
      const p = landing.p;
      for (const [planet, n] of Object.entries(plan.toLand)) {
        if (n < 1) continue;
        const options = p.controls
          .map((c) => ({ c, m: /^landUnits_[^_]+_(\d)(gf|mf)_(.+)_[a-z]+$/.exec(baseId(c.custom_id)) }))
          .filter((x) => x.m && x.m[2] === "gf" && x.m[3] === planet && Number(x.m[1]) <= n)
          .sort((a, b) => Number(b.m![1]) - Number(a.m![1]));
        const pick = options[0];
        if (!pick) {
          plan.toLand[planet] = 0;
          continue;
        }
        const k = Number(pick.m![1]);
        if (await this.press(p, pick.c, `land ${k} infantry on ${planet}`)) {
          plan.toLand[planet] = n - k;
          return true;
        }
        return false;
      }
      // Nothing (more) planned: land any leftover infantry on free planets? Keep them aboard; done landing.
      const done = p.controls.find((c) => /^doneLanding/.test(baseId(c.custom_id)));
      if (done) {
        this.setStage("post");
        plan.postAt = Date.now();
        return this.press(p, done, "done landing");
      }
    }
    if (this.find(faction, (b) => /^(doneWithTacticalAction|tacticalActionBuild_)$|^tacticalActionBuild_/.test(b))) {
      this.setStage("post");
      plan.postAt = Date.now();
      return this.post(faction, null, undefined);
    }
    return false;
  }

  private async post(faction: string, board: Board | null, me: PlayerView | undefined): Promise<boolean> {
    const plan = this.plan!;
    // Let explores and their follow-ups resolve (the rule table answers them) until the game has been quiet a moment.
    const last = this.seat.messages(plan.game).at(-1);
    const lastAt = last ? Date.parse(last.m.edited_timestamp ?? last.m.timestamp) : 0;
    const waited = Date.now() - (plan.postAt ?? plan.stageAt);
    if (Date.now() - lastAt < SETTLE_MS && waited < SETTLE_MAX_MS) return false;
    const build = this.find(faction, (b) => b === `tacticalActionBuild_${plan.target}`);
    if (build && board && me && this.wantsToProduce(board, me)) {
      this.setStage("build");
      return this.press(build.p, build.c, `produce in ${plan.target}`);
    }
    const conclude = this.find(faction, (b) => b === "doneWithTacticalAction");
    if (conclude) {
      this.setStage("done");
      return this.press(conclude.p, conclude.c, "conclude the tactical action");
    }
    return false;
  }

  private wantsToProduce(board: Board, me: PlayerView) {
    const plan = this.plan!;
    if (!plan.target || !dockOf(board, me.faction, plan.target)) return false;
    return spendable(board, me) >= 2;
  }

  private async produce(faction: string, board: Board | null, me: PlayerView | undefined): Promise<boolean> {
    const plan = this.plan!;
    plan.job ??= new BuildJob(this.seat, plan.game, plan.target!, plan.since);
    const r = await plan.job.tick(board, me, faction);
    if (r === "acted") plan.progressAt = Date.now();
    if (r !== "done") return r === "acted";
    this.setStage("conclude");
    const hit = this.find(faction, (b) => b === "doneWithTacticalAction");
    if (hit) {
      this.setStage("done");
      return this.press(hit.p, hit.c, "conclude the tactical action");
    }
    return false;
  }

  /** Past a stage's deadline: press the furthest "move on" control in sight, and give up after a few. */
  private async escalate(faction: string, board: Board | null, me: PlayerView | undefined): Promise<boolean> {
    const plan = this.plan!;
    plan.escalations++;
    plan.progressAt = Date.now();
    if (plan.escalations > 4) {
      this.seat.log(`plan stuck in ${plan.stage}; leaving the prompts to the rule table`);
      this.plan = null;
      return false;
    }
    const order = [/^doneWithTacticalAction$/, /^deleteButtons_tacticalAction/, /^doneLanding/, /^concludeMove_/];
    for (const re of order) {
      const hit = this.find(faction, (b) => re.test(b), "0");
      if (hit) {
        this.seat.log(`plan stuck in ${plan.stage} for ${Math.round(STAGE_MS / 1000)}s; pressing "${hit.c.label}"`);
        plan.pressed.clear();
        if (/doneWithTacticalAction/.test(hit.c.custom_id)) this.setStage("done");
        else if (/deleteButtons_tacticalAction/.test(hit.c.custom_id)) this.setStage("build");
        else if (/doneLanding/.test(hit.c.custom_id)) this.setStage("post");
        else this.setStage("land");
        plan.toLand = {};
        return this.press(hit.p, hit.c, "move on (stuck)");
      }
    }
    void board;
    void me;
    return false;
  }
}

function dockOf(board: Board, faction: string, pos: string) {
  const sys = board.systems.get(pos);
  return !!sys && sys.planets.some((p) => countUnit(p.units.get(faction), "sd") > 0);
}

/** The ring menu button that leads to `position` (ported from web/src/mapactions/activate.ts). */
function ringButton(buttons: Control[], position: string, tried: Set<string>): Control | undefined {
  const ids = buttons.filter((c) => !tried.has(c.custom_id)).map((c) => ({ c, id: baseId(c.custom_id) }));
  if (!/^\d{3,}$/.test(position)) return ids.find(({ id }) => id === "ring_corners")?.c;
  const ring = Number(position.slice(0, -2));
  const slot = Number(position.slice(-2));
  const total = ring * 6;
  const side = slot >= total / 2 || slot === 1 ? "left" : "right";
  const halves = ids.filter(({ id }) => id === `ring_${ring}_left` || id === `ring_${ring}_right`);
  if (halves.length) return (halves.find(({ id }) => id.endsWith(side)) ?? halves[0]).c;
  const whole = ids.find(({ id }) => id === `ring_${ring}`);
  if (whole) return whole.c;
  const far = ids
    .map(({ c, id }) => ({ c, d: Number(/^getTilesThisFarAway_(\d+)/.exec(id)?.[1] ?? NaN) }))
    .filter(({ d }) => !Number.isNaN(d))
    .sort((a, b) => a.d - b.d);
  return far[0]?.c;
}
