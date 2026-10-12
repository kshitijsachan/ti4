import type { Board, PlayerView } from "./board.js";
import { countUnit, playerOf } from "./board.js";
import { BuildJob } from "./production.js";
import type { Seat, SeatEngine } from "./seat.js";
import { spendable, type ExpandGoal, type ProduceGoal } from "./strategy.js";
// The planner (botplay/board.ts) reads the legacy web state, whose unit / holder / planet strings are the same async
// ids the engine uses: they are cast to the engine unions where they cross into an engine request.
import type { AnswerResult, Decision, HolderName, Option, PlanetId, UnitId } from "../engine/types.js";
import type {
  TacticalActivate,
  TacticalConclude,
  TacticalLand,
  TacticalMove,
  TacticalRift,
  TurnAction,
} from "../engine/kinds/tactical.js";

/*
 * A tactical action driven by the engine's typed decisions (docs/ENGINE.md; kinds in engine/kinds/tactical.ts):
 * turn.action "tactical" → tactical.activate (menu step whose `positions` hold the target, then the system) →
 * tactical.move answered in one call with the planned units (direct `move` action) → tactical.land in one call
 * (direct `land` action) → tactical.rift (we never path through rifts: done) → tactical.conclude (produce via the
 * production job, then conclude). Nothing here reads a button id or a label. Follow-ups that are not tactical
 * (explores, combat) are left to the other policies; we only conclude once none of them waits on us.
 */

const STALL_MS = 45000;
/** Quiet time after landing before concluding, so explores and other follow-ups are answered first. */
const SETTLE_MS = 4000;
const SETTLE_MAX_MS = 40000;

export const TACTICAL_KINDS = new Set(["tactical.activate", "tactical.move", "tactical.land", "tactical.conclude", "tactical.rift"]);

type Goal = ExpandGoal | ProduceGoal | { kind: "recover"; why: string };

export type EnginePlan = {
  game: string;
  goal: Goal;
  target: string | null;
  moved: boolean;
  landed: boolean;
  concluded: boolean;
  tried: Set<string>;
  progressAt: number;
  landedAt: number;
  /** Server-side createdAt bound: follow-up decisions opened after this belong to this action. */
  startedAt: number;
  job?: BuildJob;
  building: boolean;
};

const live = <V>(d: { options: Option<V>[] }) => d.options.filter((o) => !o.disabled && !o.needsInput && o.value);

/** A plan interrupted by a roll-back is resumed (its goal, steps afresh) for this long. */
const RESUME_MS = 120_000;

export class EngineTactical {
  plan: EnginePlan | null = null;
  /** Per game: the goal of a plan a roll-back interrupted (see rewound / resume). */
  private interrupted = new Map<string, { goal: Goal; target: string | null; at: number }>();

  constructor(
    private seat: Seat,
    private engine: SeatEngine,
  ) {}

  owns(game: string) {
    return !!this.plan && this.plan.game === game;
  }

  /** Our open start-of-turn menu (Tactical Action offered, no End Turn yet), if any. */
  static turnMenu(decisions: Decision[]): TurnAction | null {
    for (const d of decisions) {
      if (d.kind !== "turn.action") continue;
      const opts = live(d);
      if (opts.some((o) => o.value!.action === "tactical") && !opts.some((o) => o.value!.action === "end_turn")) return d;
    }
    return null;
  }

  /** Starts a tactical action from the turn menu. Returns false when the engine refused. */
  async start(game: string, menu: TurnAction, goal: ExpandGoal | ProduceGoal): Promise<boolean> {
    const opt = live(menu).find((o) => o.value!.action === "tactical");
    if (!opt) return false;
    this.interrupted.delete(game);
    this.plan = this.fresh(game, goal, goal.target);
    const r = await this.engine.answer(game, menu, opt.id, `tactical action: ${goal.why}`);
    if (!r?.ok) {
      this.seat.log(`Tactical Action refused (${r?.error ?? "engine unavailable"}); dropping the plan`);
      this.plan = null;
      return false;
    }
    return true;
  }

  /**
   * Plans a tactical action whose activation is already asked for (started outside the turn menu: Thunder's Edge
   * Warfare). No goal: activate a system with our space dock and produce (activate()'s fallback).
   */
  adopt(game: string, goal: ExpandGoal | ProduceGoal | null) {
    this.plan = goal ? this.fresh(game, goal, goal.target) : this.fresh(game, { kind: "recover", why: "Warfare tactical action with no job" }, null);
  }

  /**
   * The game was rolled back: the plan's steps (moved, landed, concluded, tried menus, the build job) describe undone
   * answers, so it stops; its goal is kept for resume() — the restored state may be anywhere from before the
   * activation to after the landing, and the brain picks the action up from whatever step is open again.
   */
  rewound(game: string) {
    const plan = this.plan;
    if (plan?.game !== game) return;
    if (plan.goal.kind !== "recover") this.interrupted.set(game, { goal: plan.goal, target: plan.target, at: Date.now() });
    this.plan = null;
  }

  /** Resumes the action a roll-back interrupted in this game (fresh steps, same goal). False when there was none. */
  resume(game: string): boolean {
    const r = this.interrupted.get(game);
    this.interrupted.delete(game);
    if (!r || Date.now() - r.at > RESUME_MS || r.goal.kind === "recover") return false;
    this.plan = this.fresh(game, r.goal, r.target);
    return true;
  }

  /** A roll-back interrupted our action in this game lately (resume() would take it up). */
  interruptedIn(game: string): boolean {
    const r = this.interrupted.get(game);
    return !!r && Date.now() - r.at <= RESUME_MS;
  }

  /** Takes over a tactical action already under way (e.g. after a restart): pushes it to its end, moving nothing. */
  recover(game: string) {
    this.plan = this.fresh(game, { kind: "recover", why: "finish a tactical action already under way" }, null);
  }

  private fresh(game: string, goal: Goal, target: string | null): EnginePlan {
    return { game, goal, target, moved: false, landed: false, concluded: false, tried: new Set(), progressAt: Date.now(), landedAt: 0, startedAt: Date.now(), building: false };
  }

  /** One step. Returns true when it acted. */
  async tick(board: Board | null, decisions: Decision[]): Promise<boolean> {
    const plan = this.plan;
    if (!plan) return false;
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    const mine = decisions.filter((d) => d.target?.userId === this.seat.userId);
    const tactical = mine.filter((d) => TACTICAL_KINDS.has(d.kind));
    // Concluded and the "end turn or do another action" menu is up: the action is over (end turn is policy's).
    const after = mine.some((d) => d.kind === "turn.action" && live(d).some((o) => o.value!.action === "end_turn"));
    if ((plan.concluded || after) && !tactical.length) {
      this.plan = null;
      return false;
    }
    if (Date.now() - plan.progressAt > STALL_MS) {
      this.seat.log(`engine plan stalled (no tactical step for ${STALL_MS / 1000}s); leaving it to the other policies`);
      this.plan = null;
      return false;
    }
    if (plan.building && plan.job) return this.produce(board, me);
    const pick = <K extends Decision["kind"]>(kind: K) => tactical.filter((d): d is Extract<Decision, { kind: K }> => d.kind === kind).at(-1);

    const rift = pick("tactical.rift");
    if (rift) return this.rift(rift);
    const land = pick("tactical.land");
    if (land) return this.land(land);
    const move = pick("tactical.move");
    if (move) return this.move(move);
    const activate = pick("tactical.activate");
    if (activate) return this.activate(activate, board);
    const conclude = pick("tactical.conclude");
    if (conclude) return this.conclude(conclude, board, me, mine);
    return false;
  }

  private touched() {
    if (this.plan) this.plan.progressAt = Date.now();
  }

  private result(r: AnswerResult | null, what: string): boolean {
    if (!r) {
      this.seat.log(`${what}: engine unavailable`);
      return false;
    }
    this.seat.log(`${what} -> ${r.status}${r.error ? `: ${r.error}` : ""}`);
    if (r.ok) this.touched();
    return r.ok;
  }

  private async activate(d: TacticalActivate, board: Board | null): Promise<boolean> {
    const plan = this.plan!;
    const opts = live(d);
    const target = plan.target;
    if (target) {
      const system = opts.find((o) => o.value!.step === "system" && o.value!.position === target);
      if (system) return this.result(await this.engine.answer(plan.game, d, system.id, `activate ${target}`), `activate ${target}`);
      const menu = opts.find((o) => o.value!.step !== "system" && "positions" in o.value! && o.value!.positions.includes(target) && !plan.tried.has(o.id));
      if (menu) {
        plan.tried.add(menu.id);
        return this.result(await this.engine.answer(plan.game, d, menu.id, `open the menu holding ${target}`), `menu for ${target}`);
      }
    }
    // The target is not offered (or recovering): activate a system with our space dock to produce, else give up.
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    const dock = opts.find((o) => o.value!.step === "system" && board && me && hasDock(board, me, o.value!.position));
    if (dock && dock.value!.step === "system") {
      plan.target = dock.value!.position;
      plan.goal = { kind: "produce", target: plan.target, why: "fallback activation" };
      return this.result(await this.engine.answer(plan.game, d, dock.id, `cannot reach ${target}; activate ${plan.target}`), `activate ${plan.target}`);
    }
    const nav = opts.find((o) => o.value!.step !== "system" && !plan.tried.has(o.id));
    if (nav) {
      plan.tried.add(nav.id);
      return this.result(await this.engine.answer(plan.game, d, nav.id, "look further in the system menu"), "system menu");
    }
    return false;
  }

  private async move(d: TacticalMove): Promise<boolean> {
    const plan = this.plan!;
    if (plan.moved) return false;
    const done = live(d).find((o) => o.value!.action === "done");
    const position = done && done.value!.action === "done" ? done.value!.position : null;
    if (plan.target && position && position !== plan.target) {
      this.seat.log(`activated ${position} instead of ${plan.target}; moving nothing`);
      plan.goal = { kind: "produce", target: position, why: "fallback activation" };
    }
    plan.target ??= position;
    const goal = plan.goal;
    const units = goal.kind === "expand" && (!position || position === goal.target) ? goal.moves.map((m) => ({ from: m.origin, holder: m.holder as HolderName, unit: m.unit as UnitId, count: m.count })) : [];
    plan.moved = true;
    let r = await this.engine.move(plan.game, d, { units, conclude: true }, goal.kind === "expand" ? goal.why : "move nothing");
    if (r && !r.ok && units.length && r.status === "refused") {
      this.seat.log(`movement refused (${r.error}); concluding movement without moving`);
      if (goal.kind === "expand") goal.land = {};
      r = await this.engine.move(plan.game, d, { units: [], conclude: true }, "move nothing");
    }
    if (!r?.ok) plan.moved = false;
    return this.result(r, `move into ${plan.target}`);
  }

  private async land(d: TacticalLand): Promise<boolean> {
    const plan = this.plan!;
    if (plan.landed) return false;
    const inSpace = d.progress?.accumulated.inSpace ?? [];
    let gf = inSpace.filter((u) => u.unit === "gf").reduce((n, u) => n + u.count, 0);
    const offered = new Set<string>(live(d).flatMap((o) => (o.value!.op === "land" && o.value!.unit === "gf" ? [o.value!.planet] : [])));
    const landings: { planet: PlanetId; unit: UnitId; count: number }[] = [];
    if (plan.goal.kind === "expand") {
      for (const [planet, n] of Object.entries(plan.goal.land)) {
        const count = Math.min(n, gf);
        if (count < 1 || !offered.has(planet)) continue;
        landings.push({ planet: planet as PlanetId, unit: "gf", count });
        gf -= count;
      }
    }
    plan.landed = true;
    plan.landedAt = Date.now();
    const r = await this.engine.land(plan.game, d, { landings, done: true }, landings.length ? `land ${landings.map((l) => `${l.count} on ${l.planet}`).join(", ")}` : "land nothing");
    if (!r?.ok) {
      // Partial landing or a changed prompt: finish with Done Landing as it stands.
      const done = live(d).find((o) => o.value!.op === "done");
      if (done) return this.result(await this.engine.answer(plan.game, d, done.id, "done landing"), "done landing");
    }
    return this.result(r, "landing");
  }

  private async rift(d: TacticalRift): Promise<boolean> {
    // Our plans never path through a gravity rift (board.ts treats anomalies as walls): nothing to roll.
    const done = live(d).find((o) => o.value!.op === "done");
    if (!done) return false;
    return this.result(await this.engine.answer(this.plan!.game, d, done.id, "no units moved through a rift"), "rift: done");
  }

  private async conclude(d: TacticalConclude, board: Board | null, me: PlayerView | undefined, mine: Decision[]): Promise<boolean> {
    const plan = this.plan!;
    // Let explores, combat and other follow-ups (other policies answer them) settle first.
    const others = mine.filter((x) => !TACTICAL_KINDS.has(x.kind) && x.kind !== "turn.action" && x.createdAt >= plan.startedAt);
    const waited = Date.now() - (plan.landedAt || plan.progressAt);
    if ((others.length || waited < SETTLE_MS) && waited < SETTLE_MAX_MS) return false;
    const opts = live(d);
    const produce = opts.find((o) => o.value!.action === "produce");
    if (produce && produce.value!.action === "produce" && !plan.job && board && me && this.wantsToProduce(board, me, produce.value!.position, produce.value!.production)) {
      plan.job = new BuildJob(this.seat, plan.game, produce.value!.position, d.source.messageId);
      plan.building = true;
      return this.result(await this.engine.answer(plan.game, d, produce.id, `produce in ${produce.value!.position}`), "produce");
    }
    const conclude = opts.find((o) => o.value!.action === "conclude");
    if (!conclude) return false;
    plan.concluded = true;
    const explore = conclude.value!.action === "conclude" && conclude.value!.frontierExplore ? " (explores the frontier)" : "";
    return this.result(await this.engine.answer(plan.game, d, conclude.id, `conclude the tactical action${explore}`), "conclude");
  }

  private wantsToProduce(board: Board, me: PlayerView, position: string, production: number) {
    return production > 0 && hasDock(board, me, position) && spendable(board, me) >= 2;
  }

  private async produce(board: Board | null, me: PlayerView | undefined): Promise<boolean> {
    const plan = this.plan!;
    const faction = await this.seat.faction(plan.game);
    if (!faction || !plan.job) return false;
    const r = await plan.job.tick(board, me, faction);
    if (r === "acted") this.touched();
    if (r === "done") {
      plan.building = false;
      this.touched();
    }
    return r === "acted";
  }
}

function hasDock(board: Board, me: PlayerView, pos: string) {
  const sys = board.systems.get(pos);
  return !!sys && sys.planets.some((p) => countUnit(p.units.get(me.faction), "sd") > 0);
}
