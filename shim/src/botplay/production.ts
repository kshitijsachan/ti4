import type { Board, PlayerView } from "./board.js";
import { baseId, lockOf, type Control, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";
import { Steps } from "./steps.js";
import { buildList, spendable } from "./strategy.js";
import { statsOf } from "./units.js";

/*
 * Producing units on the bot's "Produce Units" prompt (place_<unit>_<where> buttons, then "Done Producing Units")
 * and paying the bill it posts afterwards. Used by tactical actions and by Construction / Warfare's build.
 */

export type JobResult = "acted" | "wait" | "done";

export class BuildJob {
  readonly steps: Steps;
  private build: string[] | null = null;
  private stage: "place" | "pay" = "place";
  private doneAt = 0;

  constructor(
    seat: Seat,
    game: string,
    readonly target: string,
    since: string | undefined,
  ) {
    this.steps = new Steps(seat, game, since);
  }

  async tick(board: Board | null, me: PlayerView | undefined, faction: string): Promise<JobResult> {
    if (!board || !me) return "wait";
    const s = this.steps;
    if (this.stage === "place") {
      const place = s.find(faction, (b) => /^place_/.test(b) || /^deleteButtons_(tacticalAction|construction|warfare)/.test(b));
      if (!place) return "wait";
      const p = place.p;
      if (!this.build) {
        const capacity = board.systems.get(this.target)?.production.get(me.color) ?? 2;
        const budget = spendable(board, me);
        this.build = buildList(board, me, budget, capacity);
        s.seat.log(`produce in ${this.target}: ${this.build.map((u) => statsOf(u).name).join(", ") || "nothing"} (budget ${budget}, production ${capacity})`);
      }
      const ours = p.controls.filter((c) => !lockOf(c.custom_id) || lockOf(c.custom_id) === faction);
      while (this.build.length) {
        const unit = this.build[0];
        let c: Control | undefined;
        let n = 1;
        if (unit === "gf" || unit === "ff") {
          const pair = this.build[1] === unit;
          const two = unit === "gf" ? /^place_2gf_(?!space)/ : /^place_2ff_/;
          const one = unit === "gf" ? /^place_infantry_(?!space)/ : /^place_fighter_/;
          c = pair ? ours.find((x) => two.test(baseId(x.custom_id))) : undefined;
          if (c) n = 2;
          else c = ours.find((x) => one.test(baseId(x.custom_id)));
        } else c = ours.find((x) => baseId(x.custom_id).startsWith(`place_${statsOf(unit).name}_`));
        if (!c) {
          this.build.splice(0, 1);
          continue;
        }
        if (await s.press(p, c, `produce ${c.label.replace(/^Produce /, "")}`, true)) {
          this.build.splice(0, n);
          return "acted";
        }
        return "wait";
      }
      const done = ours.find((c) => /^deleteButtons_/.test(baseId(c.custom_id)) || /^done producing/i.test(c.label));
      if (!done) return "wait";
      this.stage = "pay";
      this.doneAt = Date.now();
      await s.press(p, done, "done producing");
      return "acted";
    }
    const bill = s.find(faction, (b, c) => /^spend_/.test(b) || /^reduceTG_/.test(b) || (/^deleteButtons/.test(b) && /^done exhausting/i.test(c.label)));
    if (bill) {
      const r = await payStep(s.seat, bill.p, board, me, "res", s.pressed);
      return r === "wait" ? "wait" : r === "done" ? "done" : "acted";
    }
    // Nothing to pay (nothing built, or the bot takes no bill): finished after a moment.
    return Date.now() - this.doneAt > 8000 ? "done" : "wait";
  }
}

/**
 * One step of paying a bill ("please choose the planets you wish to exhaust to pay a cost of N"): exhaust the planets
 * that cover it with the least waste, then trade goods, then "Done Exhausting Planets". `cost` overrides the text.
 * Returns "pressed" after a press, "done" after pressing Done, "wait" when nothing to do yet.
 */
export async function payStep(
  seat: Seat,
  bill: Prompt,
  board: Board,
  me: PlayerView,
  kind: "res" | "inf",
  pressed: Map<string, string>,
  costOverride?: number,
): Promise<"pressed" | "done" | "wait"> {
  const content = String(bill.m.content ?? "");
  // The bot edits the bill as planets are spent ("… preceding build cost 4 resources"): remember the first reading.
  const costKey = `cost:${bill.m.id}`;
  const read = costOverride !== undefined ? String(costOverride) : /(?:cost of|total cost(?: of)?|preceding build cost|pay) (\d+)/i.exec(content)?.[1];
  if (read !== undefined && !pressed.has(costKey)) pressed.set(costKey, read);
  const cost = Number(pressed.get(costKey) ?? NaN);
  const spentKey = `bill:${bill.m.id}`;
  const spent = Number(pressed.get(spentKey) ?? 0);
  const done = bill.controls.find((c) => /^done exhausting|^done paying|^done$/i.test(c.label.trim()) || /^deleteButtons/.test(baseId(c.custom_id)));
  const finish = async () => {
    if (!done) return "wait" as const;
    if (pressed.has(`${bill.m.id}:${done.custom_id}`)) return "wait" as const;
    pressed.set(`${bill.m.id}:${done.custom_id}`, "1");
    const err = await seat.press(bill, done, `paid ${spent} of ${Number.isNaN(cost) ? "?" : cost}`);
    return err ? ("pressed" as const) : ("done" as const);
  };
  const due = Number.isNaN(cost) ? 0 : cost - spent;
  if (due <= 0) return finish();
  const value = (planet: string) => {
    const pos = board.planetSystem.get(planet);
    const p = pos ? board.systems.get(pos)?.planets.find((x) => x.id === planet) : undefined;
    return p ? (kind === "res" ? p.resources : p.influence) : 0;
  };
  const offered = bill.controls
    .map((c) => ({ c, m: /^spend_([^_]+)/.exec(baseId(c.custom_id)) }))
    .filter((x) => x.m && !pressed.has(`${bill.m.id}:${x.c.custom_id}`) && !me.exhaustedPlanets.has(x.m[1]))
    .map((x) => ({ c: x.c, planet: x.m![1], v: value(x.m![1]) }))
    .filter((x) => x.v > 0);
  // Least waste: the smallest total ≥ due over subsets of up to 12 planets; else the biggest first.
  let bestSet: typeof offered = [];
  let bestTotal = Infinity;
  const list = offered.slice(0, 12);
  for (let mask = 1; mask < 1 << list.length; mask++) {
    let t = 0;
    const set: typeof offered = [];
    for (let i = 0; i < list.length; i++)
      if (mask & (1 << i)) {
        t += list[i].v;
        set.push(list[i]);
      }
    if (t >= due && (t < bestTotal || (t === bestTotal && set.length < bestSet.length))) {
      bestTotal = t;
      bestSet = set;
    }
  }
  const tgLeft = me.tg - Number(pressed.get(`tg:${bill.m.id}`) ?? 0);
  // Trade goods cover a small remainder better than an extra planet would.
  const pick = bestSet.sort((a, b) => b.v - a.v)[0] ?? (tgLeft >= due ? undefined : offered.sort((a, b) => b.v - a.v)[0]);
  if (pick) {
    pressed.set(`${bill.m.id}:${pick.c.custom_id}`, "1");
    pressed.set(spentKey, String(spent + pick.v));
    await seat.press(bill, pick.c, `pay with ${pick.planet} (${pick.v})`);
    return "pressed";
  }
  const tg = bill.controls
    .map((c) => ({ c, n: Number(/^reduceTG_(\d+)/.exec(baseId(c.custom_id))?.[1] ?? NaN) }))
    .filter((x) => !Number.isNaN(x.n) && x.n <= due && x.n <= tgLeft)
    .sort((a, b) => b.n - a.n)[0];
  if (tg) {
    pressed.set(spentKey, String(spent + tg.n));
    pressed.set(`tg:${bill.m.id}`, String(Number(pressed.get(`tg:${bill.m.id}`) ?? 0) + tg.n));
    await seat.press(bill, tg.c, `pay ${tg.n} trade goods`);
    return "pressed";
  }
  if (due > 0) seat.log(`cannot cover ${due} more of the bill; finishing it`);
  return finish();
}
