import { countUnit, isShip, myUnits, playerOf, type Board, type PlayerView } from "./board.js";
import { baseId, lockIs, lockOf, snowflakeAfter, type Control, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";
import { forgetGameKeys, type GameScope } from "../engine/rewind.js";
import { promptForMe } from "./steps.js";
import { statsOf } from "./units.js";

/*
 * The bot's "you are violating fleet pool limits / carrying capacity in <system>" reminder ("Remove Units in X" /
 * "Dismiss These Buttons") for an autopilot seat. It is only a reminder: the bot leaves fixing it to the player.
 *
 * - Settled first (the reminder can come mid-action, e.g. before landing): nothing for a few seconds.
 * - No longer over the limit by our own count (we moved away, gained a fleet token): dismiss it.
 * - Over the limit: "Remove Units in X", then on the bot's unit list remove the cheapest units in space: fighters,
 *   then infantry, then mechs while over capacity; destroyers, cruisers, carriers, dreadnoughts while over the fleet
 *   pool (never a flagship or war sun). Then "Done Removing" and dismiss the reminder.
 * - Anything we cannot count or fix (floating structures, too many docks / PDS): left to a person, logged once.
 */

const WARN_ID = /^getDamageButtons_([^_]+)_remove$/;
/** The reminder has been on the table at least this long before we act on it. */
const SETTLE_MS = 5000;
/** Time for the bot's web data to show a removal before we count again. */
const REMOVE_GAP_MS = 4000;
const MAX_REMOVALS = 12;
const CARGO_ORDER = ["ff", "gf", "mf"];
const SHIP_ORDER = ["dd", "ca", "cv", "dn"];

type Job = { warning: string; pos: string; faction: string; openedAt: number; removals: number; lastAt: number };

export class ViolationDesk {
  /** Reminders (message id) finished: dismissed, or left to a person. */
  private done = new Set<string>();
  /** Per game: the reminder we are fixing. */
  private jobs = new Map<string, Job>();
  /** `${message id}:${custom id}` pressed. */
  private pressed = new Set<string>();

  constructor(private seat: Seat) {}

  /** The game was rolled back: reminders and lists are judged afresh. */
  rewound(scope: GameScope) {
    this.jobs.delete(scope.game);
    forgetGameKeys([this.done, this.pressed], scope);
  }

  /** The reminders addressed to us and the unit lists they open: the rule table leaves them alone. */
  owns(game: string, p: Prompt): boolean {
    // The reminder pings its player and carries no faction-locked buttons.
    if (p.controls.some((c) => WARN_ID.test(baseId(c.custom_id))) && promptForMe(this.seat, p, "")) return true;
    const job = this.jobs.get(game);
    return !!job && this.isRemovalList(p, job, job.faction);
  }

  /** One step. Returns true when it pressed something. */
  async tick(game: string, faction: string): Promise<boolean> {
    const prompts = this.seat.prompts(game);
    let job = this.jobs.get(game);
    const warning = job ? prompts.find((p) => p.m.id === job!.warning) : undefined;
    if (job && !warning) {
      // The reminder is gone (dismissed by someone): close the unit list if we opened one.
      const list = this.removalList(prompts, job, faction);
      this.jobs.delete(game);
      if (list) return this.finishList(list);
      job = undefined;
    }
    const w =
      warning ??
      prompts.find((p) => !this.done.has(p.m.id) && p.controls.some((c) => WARN_ID.test(baseId(c.custom_id))) && promptForMe(this.seat, p, faction));
    if (!w) return false;
    const control = w.controls.find((c) => WARN_ID.test(baseId(c.custom_id)))!;
    const pos = WARN_ID.exec(baseId(control.custom_id))![1];
    if (Date.now() - Date.parse(w.m.edited_timestamp ?? w.m.timestamp) < SETTLE_MS) return false;
    const board = await this.seat.board(game, true);
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    if (!board || !me) return false;
    // Only between our own steps: never in the middle of our turn's action.
    if (board.phase === "action" && board.activePlayer === me.color && board.activeSystem === pos) return false;
    const over = excess(board, me, pos);
    const text = String(w.m.content ?? "");
    const fixable = /violating (fleet pool limits|carrying capacity)/i.test(text) && !/floating structure|too many (space docks|pds)/i.test(text);
    if (!over) {
      this.leave(game, w, `cannot see system ${pos}`);
      return false;
    }
    if (over.ships === 0 && over.cargo === 0) {
      // Resolved (or nothing we count is over): close the list and dismiss the reminder.
      if (job) {
        const list = this.removalList(prompts, job, faction);
        if (list && (await this.finishList(list))) return true;
      }
      if (!fixable) {
        this.leave(game, w, `cannot fix "${text.slice(0, 80)}" in ${pos}`);
        return false;
      }
      return this.dismiss(game, w, `no longer over the limit in ${pos}`);
    }
    if (!fixable) {
      this.leave(game, w, `cannot fix "${text.slice(0, 80)}" in ${pos}`);
      return false;
    }
    if (!job) {
      job = { warning: w.m.id, pos, faction, openedAt: 0, removals: 0, lastAt: 0 };
      this.jobs.set(game, job);
    }
    if (job.removals >= MAX_REMOVALS) {
      this.leave(game, w, `still over the limit in ${pos} after ${job.removals} removals`);
      return false;
    }
    const list = this.removalList(prompts, job, faction);
    if (!list) {
      if (job.openedAt && Date.now() - job.openedAt < 15000) return false;
      job.openedAt = Date.now();
      const err = await this.seat.press(w, control, `over the ${over.ships ? "fleet pool" : "carrying capacity"} in ${pos}: remove units`);
      if (err) this.leave(game, w, `"Remove Units" failed: ${err}`);
      return true;
    }
    if (Date.now() - job.lastAt < REMOVE_GAP_MS) return false;
    const order = over.cargo > 0 ? CARGO_ORDER : SHIP_ORDER;
    const pick = order.map((u) => spaceRemoval(list, pos, u, faction)).find((c): c is Control => !!c);
    if (!pick) {
      this.leave(game, w, `no unit we would remove in ${pos} (over by ${over.ships} ships, ${over.cargo} cargo)`);
      if (list) await this.finishList(list);
      return true;
    }
    job.removals++;
    job.lastAt = Date.now();
    await this.seat.press(list, pick, `over the ${over.cargo > 0 ? "carrying capacity" : "fleet pool"} in ${pos} by ${over.cargo > 0 ? over.cargo : over.ships}: ${pick.label}`);
    return true;
  }

  private isRemovalList(p: Prompt, job: Job, faction: string) {
    return (
      !!job.openedAt &&
      snowflakeAfter(p.m.id, job.warning) &&
      p.controls.some((c) => lockIs(c.custom_id, faction) && baseId(c.custom_id).startsWith(`assignHits_${job.pos}_`))
    );
  }

  /** The bot's unit list for the system ("… Use buttons to resolve"), newest first. */
  private removalList(prompts: Prompt[], job: Job, faction: string): Prompt | undefined {
    return [...prompts].reverse().find((p) => this.isRemovalList(p, job, faction));
  }

  private async finishList(list: Prompt): Promise<boolean> {
    const done = list.controls.find((c) => baseId(c.custom_id) === "deleteButtons" && /^done/i.test(c.label.trim()));
    if (!done || this.pressed.has(`${list.m.id}:${done.custom_id}`)) return false;
    this.pressed.add(`${list.m.id}:${done.custom_id}`);
    await this.seat.press(list, done, "done removing units");
    return true;
  }

  private async dismiss(game: string, w: Prompt, why: string): Promise<boolean> {
    this.done.add(w.m.id);
    this.jobs.delete(game);
    const c = w.controls.find((x) => baseId(x.custom_id) === "deleteButtons");
    if (!c) return false;
    await this.seat.press(w, c, `${why}: dismiss the reminder`);
    return true;
  }

  private leave(game: string, w: Prompt, why: string) {
    if (!this.done.has(w.m.id)) this.seat.log(`unit limits: ${why}; leaving the reminder to a person`);
    this.done.add(w.m.id);
    this.jobs.delete(game);
  }
}

/**
 * How far over its limits our fleet in `pos` is: ships over the fleet pool (non-fighter ships in space vs fleet
 * tokens) and fighters / infantry / mechs in space over capacity (each space dock of ours in the system carries 3
 * fighters). Null when the system or our fleet pool is unknown. A rough count of the bot's (no faction or technology specials).
 */
export function excess(board: Board, me: PlayerView, pos: string): { ships: number; cargo: number } | null {
  const sys = board.systems.get(pos);
  if (!sys || me.raw?.fleetCC == null) return null;
  const space = myUnits(sys, me.faction);
  let ships = 0;
  let capacity = 0;
  for (const u of space) {
    if (!isShip(u.unit) || u.unit === "ff") continue;
    ships += u.count;
    capacity += statsOf(u.unit, me).capacity * u.count;
  }
  const docks = sys.planets.reduce((n, p) => n + countUnit(p.units.get(me.faction), "sd"), 0);
  const fighters = Math.max(0, countUnit(space, "ff") - 3 * docks);
  const cargo = fighters + countUnit(space, "gf") + countUnit(space, "mf");
  return { ships: Math.max(0, ships - me.fleetCC), cargo: Math.max(0, cargo - capacity) };
}

/** A "Remove 1 <unit>" button for one of our units in the system's space (not on a planet). */
function spaceRemoval(list: Prompt, pos: string, unit: string, faction: string): Control | undefined {
  const re = new RegExp(`^assignHits_${pos}_1_${unit}_`);
  return list.controls.find((c) => lockIs(c.custom_id, faction) && re.test(baseId(c.custom_id)) && /^remove 1 /i.test(c.label.trim()) && !/ from /i.test(c.label));
}
