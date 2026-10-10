import { playerOf, type Board, type PlayerView } from "./board.js";
import { BuildJob, payStep, type JobResult } from "./production.js";
import { baseId, lockOf, snowflakeAfter, type Control, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";
import { promptForMe, Steps } from "./steps.js";
import { dockSystems, hasMyCC, spendable } from "./strategy.js";
import { nextTech, researchable, TECH_PREFERENCE, typeLabelOf } from "./techs.js";

/*
 * Strategy card primaries (and the one secondary worth following: Technology), status-phase scoring.
 * Each multi-step answer is a small job over the bot's prompts with its own deadline; anything a job does not finish
 * is left to the rule table.
 */

/** A job that has not moved for this long is dropped (its prompts go back to the rule table). */
const JOB_MS = 75000;

interface Job {
  name: string;
  started: number;
  progressAt: number;
  /** Prompts the job answers (the rule table must leave them alone while it runs). */
  owns(p: Prompt): boolean;
  tick(board: Board | null, me: PlayerView | undefined, faction: string): Promise<JobResult>;
}

/** Leadership: optionally spend 3 influence for a 4th token, then put the tokens in tactics (and one in fleet). */
class LeadershipJob implements Job {
  name = "Leadership";
  started = Date.now();
  progressAt = Date.now();
  private steps: Steps;
  private spent = 0;
  private billDone = false;
  private gained = 0;

  constructor(
    seat: Seat,
    game: string,
    since: string | undefined,
    private primary: boolean,
  ) {
    this.steps = new Steps(seat, game, since);
  }

  owns(p: Prompt) {
    return p.controls.some((c) => /^(increase_(tactic|fleet|strategy)_cc|deleteButtons_leadership|resetCCs)$/.test(baseId(c.custom_id)) || /^spend_.+_inf$/.test(baseId(c.custom_id)));
  }

  async tick(board: Board | null, me: PlayerView | undefined, faction: string): Promise<JobResult> {
    if (!board || !me) return "wait";
    const s = this.steps;
    if (!this.billDone) {
      const bill = s.find(faction, (b, c) => b === "deleteButtons_leadership" && /exhausting/i.test(c.label));
      if (!bill) return "wait";
      const influence = spendable(board, me, "inf") - me.tg;
      const target = influence >= 3 ? 3 : 0;
      const r = await payStep(s.seat, bill.p, board, me, "inf", s.pressed, target);
      if (r === "done") {
        this.billDone = true;
        this.spent = target;
      }
      return r === "wait" ? "wait" : "acted";
    }
    const gain = s.find(faction, (b) => /^increase_(tactic|fleet|strategy)_cc$/.test(b));
    if (!gain) return Date.now() - this.started > 30000 ? "done" : "wait";
    const total = (this.primary ? 3 : 0) + Math.floor(this.spent / 3);
    const p = gain.p;
    if (this.gained < total) {
      // Tactics first; one fleet token when the fleet pool is small.
      const kind = this.gained === 2 && me.fleetCC < 4 ? "fleet" : "tactic";
      const c = p.controls.find((x) => baseId(x.custom_id) === `increase_${kind}_cc`) ?? p.controls.find((x) => baseId(x.custom_id) === "increase_tactic_cc");
      if (c && (await s.press(p, c, `gain a ${kind} token (${this.gained + 1}/${total})`, true))) {
        this.gained++;
        return "acted";
      }
      return "wait";
    }
    const done = p.controls.find((c) => baseId(c.custom_id) === "deleteButtons_leadership");
    if (done) {
      await s.press(p, done, `done gaining ${total} command tokens`);
      return "done";
    }
    return "wait";
  }
}

/** Technology: research the next technology of TECH_PREFERENCE whose prerequisites are met (paying when asked). */
class TechJob implements Job {
  name = "Technology";
  started = Date.now();
  progressAt = Date.now();
  private steps: Steps;
  private chosen: string | undefined;
  private picked = false;

  constructor(
    seat: Seat,
    game: string,
    since: string | undefined,
    owned: string[],
    /** What the research costs: 0 for Technology's first (primary), 4 resources when following. */
    private cost: number,
  ) {
    this.steps = new Steps(seat, game, since);
    this.chosen = nextTech(owned);
  }

  owns(p: Prompt) {
    return p.controls.some((c) => /^(getAllTechOfType_|getTech_|acquireATech)/.test(baseId(c.custom_id)));
  }

  async tick(board: Board | null, me: PlayerView | undefined, faction: string): Promise<JobResult> {
    if (!board || !me || !this.chosen) return this.chosen ? "wait" : "done";
    const s = this.steps;
    if (!this.picked) {
      const list = s.find(faction, (b) => /^getTech_/.test(b));
      if (list) {
        const offered = list.p.controls
          .map((c) => ({ c, alias: /^getTech_([^_]+(?:_base)?)/.exec(baseId(c.custom_id))?.[1] }))
          .filter((x) => x.alias && researchable(x.alias, me.techs));
        const pick = offered.sort((a, b) => rank(a.alias!) - rank(b.alias!))[0];
        if (!pick) {
          s.seat.log(`no researchable technology on offer (wanted ${this.chosen})`);
          return "done";
        }
        this.picked = true;
        s.seat.log(`research ${pick.c.label} (${pick.alias})`);
        await s.press(list.p, pick.c, `research ${pick.c.label}`);
        return "acted";
      }
      const types = s.find(faction, (b) => /^getAllTechOfType_/.test(b));
      if (types) {
        const want = typeLabelOf(this.chosen);
        const c = types.p.controls.find((x) => /^getAllTechOfType_/.test(baseId(x.custom_id)) && want?.test(x.label)) ?? types.p.controls.find((x) => /^getAllTechOfType_/.test(baseId(x.custom_id)));
        if (c && !s.wasPressed(types.p, c)) {
          await s.press(types.p, c, `look at ${c.label} technologies for ${this.chosen}`);
          return "acted";
        }
      }
      return "wait";
    }
    const bill = s.find(faction, (b, c) => /^spend_/.test(b) || /^reduceTG_/.test(b) || (/^deleteButtons/.test(b) && /^done exhausting/i.test(c.label)));
    if (bill) {
      const r = await payStep(s.seat, bill.p, board, me, "res", s.pressed, this.cost);
      return r === "done" ? "done" : r === "wait" ? "wait" : "acted";
    }
    return Date.now() - s.lastPress > 10000 ? "done" : "wait";
  }
}

/** Status phase: gain the round's command tokens (2, +1 Versatile, +1 Hyper Metabolism) through the bot's buttons. */
class StatusTokensJob implements Job {
  name = "Status command tokens";
  started = Date.now();
  progressAt = Date.now();
  private steps: Steps;
  private gained = 0;

  constructor(seat: Seat, game: string, since: string | undefined) {
    this.steps = new Steps(seat, game, since);
  }

  owns(p: Prompt) {
    return p.controls.some((c) => /^(redistributeCCButtons|increase_(tactic|fleet|strategy)_cc|decrease_(tactic|fleet|strategy)_cc|resetCCs)$/.test(baseId(c.custom_id)));
  }

  async tick(board: Board | null, me: PlayerView | undefined, faction: string): Promise<JobResult> {
    if (!board || !me) return "wait";
    const s = this.steps;
    const gain = s.find(faction, (b) => /^increase_(tactic|fleet|strategy)_cc$/.test(b));
    if (!gain) return Date.now() - this.started > 30000 ? "done" : "wait";
    const abilities: string[] = me.raw.abilities ?? [];
    const total = 2 + (abilities.includes("versatile") ? 1 : 0) + (me.techs.includes("hm") ? 1 : 0);
    const p = gain.p;
    if (this.gained < total) {
      const kind = this.gained === 1 && me.fleetCC < 3 ? "fleet" : this.gained === 2 && me.strategicCC < 2 ? "strategy" : "tactic";
      const c = p.controls.find((x) => baseId(x.custom_id) === `increase_${kind}_cc`);
      if (c && (await s.press(p, c, `status: gain a ${kind} token (${this.gained + 1}/${total})`, true))) {
        this.gained++;
        return "acted";
      }
      return "wait";
    }
    const done = p.controls.find((c) => baseId(c.custom_id) === "deleteButtons" && /^done/i.test(c.label));
    if (done) {
      await s.press(p, done, `done gaining ${total} command tokens`);
      return "done";
    }
    return "wait";
  }
}

/** Paying for a "spend" objective just scored: the trade goods (the bot exhausts planets itself), then Done. */
class ScoreBillJob implements Job {
  name = "Objective payment";
  started = Date.now();
  progressAt = Date.now();
  private steps: Steps;
  private tgPaid = 0;

  constructor(
    seat: Seat,
    game: string,
    since: string | undefined,
    private need: { res: number; inf: number; tg: number },
  ) {
    this.steps = new Steps(seat, game, since);
  }

  owns(p: Prompt) {
    return /to score the objective/i.test(String(p.m.content ?? ""));
  }

  async tick(board: Board | null, me: PlayerView | undefined, faction: string): Promise<JobResult> {
    const s = this.steps;
    const bill = s.find(faction, (b) => /^reduceTG_|^spend_|^deleteButtons$/.test(b));
    if (!bill || !/to score the objective/i.test(String(bill.p.m.content ?? ""))) return Date.now() - this.started > 20000 ? "done" : "wait";
    const p = bill.p;
    const left = this.need.tg - this.tgPaid;
    if (left > 0) {
      const tg = p.controls
        .map((c) => ({ c, n: Number(/^reduceTG_(\d+)/.exec(baseId(c.custom_id))?.[1] ?? NaN) }))
        .filter((x) => !Number.isNaN(x.n) && x.n <= left)
        .sort((a, b) => b.n - a.n)[0];
      if (tg && (await s.press(p, tg.c, `pay ${tg.n} trade goods for the objective`, true))) {
        this.tgPaid += tg.n;
        return "acted";
      }
    }
    const done = p.controls.find((c) => baseId(c.custom_id) === "deleteButtons" && /done/i.test(c.label));
    if (done) {
      await s.press(p, done, "done paying for the objective");
      return "done";
    }
    void board;
    void me;
    return "wait";
  }
}

/**
 * Agenda vote: "Choose To Vote" → an outcome (For; ourselves when electing a player; our best planet when electing a
 * planet; else the first offered) → exhaust our least influential planet → "Done exhausting planets" → "Confirm N
 * votes". A few votes are enough: with everyone else abstaining it decides the agenda without a speaker tie.
 */
class VoteJob implements Job {
  name = "Agenda vote";
  started = Date.now();
  progressAt = Date.now();
  private steps: Steps;
  private exhausted = false;

  constructor(seat: Seat, game: string, since: string | undefined) {
    this.steps = new Steps(seat, game, since);
  }

  owns(p: Prompt) {
    return p.controls.some((c) => /^(vote|outcome_|planetOutcomes_|exhaustForVotes_|proceedToFinalizingVote|resetMyVote|resolveAgendaVote_\d+|distinguished_)/.test(baseId(c.custom_id)));
  }

  async tick(board: Board | null, me: PlayerView | undefined, faction: string): Promise<JobResult> {
    if (!board || !me) return "wait";
    const s = this.steps;
    const confirm = s.find(faction, (b) => /^resolveAgendaVote_\d+$/.test(b) && b !== "resolveAgendaVote_0");
    if (confirm && !s.wasPressed(confirm.p, confirm.c)) {
      await s.press(confirm.p, confirm.c, `agenda: ${confirm.c.label}`);
      return "done";
    }
    const planets = s.find(faction, (b) => /^exhaustForVotes_planet_/.test(b) || b === "proceedToFinalizingVote");
    if (planets) {
      if (!this.exhausted) {
        const value = (c: Control) => Number(/\((\d+)\)\s*$/.exec(c.label)?.[1] ?? 99);
        const pick = planets.p.controls.filter((c) => /^exhaustForVotes_planet_/.test(baseId(c.custom_id)) && value(c) > 0).sort((a, b) => value(a) - value(b))[0];
        this.exhausted = true;
        if (pick) {
          await s.press(planets.p, pick, `agenda: vote with ${pick.label}`);
          return "acted";
        }
      }
      const done = planets.p.controls.find((c) => baseId(c.custom_id) === "proceedToFinalizingVote");
      if (done && (await s.press(planets.p, done, "agenda: done exhausting planets"))) return "acted";
      return "wait";
    }
    const planetOwner = s.find(faction, (b) => /^planetOutcomes_/.test(b));
    if (planetOwner) {
      const c = planetOwner.p.controls.find((x) => baseId(x.custom_id) === `planetOutcomes_${me.faction}` || baseId(x.custom_id) === `planetOutcomes_${me.color}`) ?? planetOwner.c;
      if (await s.press(planetOwner.p, c, `agenda: a planet of ${c.label}`)) return "acted";
      return "wait";
    }
    const outcome = s.find(faction, (b) => /^outcome_/.test(b));
    if (outcome) {
      const ids = outcome.p.controls.filter((c) => /^outcome_/.test(baseId(c.custom_id)));
      const byId = (id: string) => ids.find((c) => baseId(c.custom_id).toLowerCase() === `outcome_${id}`.toLowerCase());
      const best = me.planets
        .map((id) => board.systems.get(board.planetSystem.get(id) ?? "")?.planets.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .sort((a, b) => b.resources + b.influence - (a.resources + a.influence))
        .map((p) => byId(p.id))
        .find(Boolean);
      const c = byId("for") ?? byId(me.faction) ?? byId(me.color) ?? best ?? ids[0];
      if (c && (await s.press(outcome.p, c, `agenda: vote for ${c.label}`))) return "acted";
      return "wait";
    }
    const start = s.find(faction, (b) => b === "vote");
    if (start && !s.wasPressed(start.p, start.c)) {
      await s.press(start.p, start.c, "agenda: vote");
      return "acted";
    }
    return Date.now() - this.started > 60000 ? "done" : "wait";
  }
}

const rank = (alias: string) => {
  const i = TECH_PREFERENCE.indexOf(alias);
  return i < 0 ? 99 : i;
};

/** Construction (Thunder's Edge): use one space dock's production. */
class ConstructionJob implements Job {
  name = "Construction";
  started = Date.now();
  progressAt = Date.now();
  private steps: Steps;
  private build: BuildJob | null = null;

  constructor(
    private seat: Seat,
    private game: string,
    since: string | undefined,
  ) {
    this.steps = new Steps(seat, game, since);
  }

  owns(p: Prompt) {
    return p.controls.some((c) => /^(constructionBuild_|place_|deleteButtons_construction|spend_|reduceTG_)/.test(baseId(c.custom_id)));
  }

  async tick(board: Board | null, me: PlayerView | undefined, faction: string): Promise<JobResult> {
    if (!board || !me) return "wait";
    if (this.build) return this.build.tick(board, me, faction);
    const s = this.steps;
    const pick = s.find(faction, (b) => /^constructionBuild_/.test(b));
    if (!pick) return "wait";
    const docks = dockSystems(board, me);
    const best = pick.p.controls
      .map((c) => ({ c, pos: baseId(c.custom_id).replace("constructionBuild_", "") }))
      .filter((x) => x.pos && /^constructionBuild_/.test(baseId(x.c.custom_id)))
      .sort((a, b) => (board.systems.get(b.pos)?.production.get(me.color) ?? 0) - (board.systems.get(a.pos)?.production.get(me.color) ?? 0))[0];
    if (!best) return "done";
    void docks;
    this.build = new BuildJob(this.seat, this.game, best.pos, pick.p.m.id);
    await s.press(pick.p, best.c, `build in ${best.pos}`);
    return "acted";
  }
}

/** Score one public objective from a prompt of po_scoring_ buttons (Imperial, status phase). */
/** Objectives scored by spending: what they cost (resources, influence, trade goods). Others that spend tokens are skipped. */
const SPEND: Record<string, { res: number; inf: number; tg: number } | null> = {
  "amass wealth": { res: 3, inf: 3, tg: 3 },
  "negotiate trade routes": { res: 0, inf: 0, tg: 5 },
  "erect a monument": { res: 8, inf: 0, tg: 0 },
  "sway the council": { res: 0, inf: 8, tg: 0 },
  "found a golden age": { res: 16, inf: 0, tg: 0 },
  "manipulate galactic law": { res: 0, inf: 16, tg: 0 },
  "centralize galactic trade": { res: 0, inf: 0, tg: 10 },
  "hold vast reserves": { res: 6, inf: 6, tg: 6 },
  "lead from the front": null,
  "galvanize the people": null,
};

function canPay(board: Board, me: PlayerView, need: { res: number; inf: number; tg: number }) {
  if (me.tg < need.tg) return false;
  // Planets go to one side each: greedy by what each side lacks.
  let res = 0;
  let inf = 0;
  const planets = me.planets
    .filter((id) => !me.exhaustedPlanets.has(id))
    .map((id) => board.systems.get(board.planetSystem.get(id) ?? "")?.planets.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => b.resources + b.influence - (a.resources + a.influence));
  for (const p of planets) {
    if (res < need.res && (inf >= need.inf || p.resources >= p.influence)) res += p.resources;
    else if (inf < need.inf) inf += p.influence;
  }
  return res >= need.res && inf >= need.inf;
}

function scorablePublics(board: Board, me: PlayerView): { key: string; name: string }[] {
  return board.objectives
    .filter((o) => {
      const spend = SPEND[String(o.name).toLowerCase()];
      return spend === undefined || (spend !== null && canPay(board, me, spend));
    })
    .filter((o) => o.revealed && !(o.scoredFactions ?? []).includes(me.faction) && Number(o.progressThreshold) > 0 && Number(o.factionProgress?.[me.faction] ?? 0) >= Number(o.progressThreshold))
    .sort((a, b) => Number(b.pointValue) - Number(a.pointValue))
    .map((o) => ({ key: String(o.key), name: String(o.name) }));
}

export class CardPlanner {
  private jobs = new Map<string, Job[]>();
  private handled = new Set<string>();

  constructor(private seat: Seat) {}

  owns(game: string, p: Prompt): boolean {
    if ((this.jobs.get(game) ?? []).some((j) => j.owns(p))) return true;
    // Agenda: we vote when asked instead of presetting an abstention.
    if (p.controls.some((c) => /^resolvePreassignment_Abstain On Agenda$/.test(c.custom_id))) return true;
    // Status scoring: the planner answers the public / secret scoring windows itself.
    if (p.controls.some((c) => /^(po_scoring_|po_no_scoring$|so_no_scoring$|get_so_score_buttons$|so_score_hand_)/.test(baseId(c.custom_id)))) return true;
    return false;
  }

  busy(game: string) {
    return (this.jobs.get(game) ?? []).length > 0;
  }

  async tick(game: string, faction: string): Promise<boolean> {
    const jobs = this.jobs.get(game) ?? [];
    if (jobs.length) {
      const board = await this.seat.board(game, true);
      const me = board ? playerOf(board, this.seat.userId) : undefined;
      // Every job gets a look (one may wait on a prompt while another's is up); each expires after a quiet spell.
      for (const job of [...jobs]) {
        if (Date.now() - job.progressAt > JOB_MS) {
          this.seat.log(`${job.name}: giving up after ${JOB_MS / 1000}s without progress`);
          jobs.splice(jobs.indexOf(job), 1);
          continue;
        }
        const r = await job.tick(board, me, faction);
        if (r === "done") {
          jobs.splice(jobs.indexOf(job), 1);
          this.seat.log(`${job.name}: done`);
        }
        if (r !== "wait") {
          job.progressAt = Date.now();
          return true;
        }
      }
    }
    const prompts = this.seat.prompts(game);
    for (let i = prompts.length - 1; i >= 0 && i >= prompts.length - 40; i--) {
      const p = prompts[i];
      if (await this.primary(game, faction, p)) return true;
      if (await this.follow(game, faction, p)) return true;
      if (await this.scoring(game, faction, p)) return true;
      if (await this.statusTokens(game, p)) return true;
      if (await this.vote(game, faction, p)) return true;
    }
    return false;
  }

  private add(game: string, job: Job) {
    const list = this.jobs.get(game) ?? [];
    list.push(job);
    this.jobs.set(game, list);
  }

  private once(key: string) {
    if (this.handled.has(key)) return false;
    this.handled.add(key);
    return true;
  }

  /** Our own strategy card, just played: resolve its primary. */
  private async primary(game: string, faction: string, p: Prompt): Promise<boolean> {
    const content = String(p.m.content ?? "");
    if (!/played by/.test(content) || !content.includes(`<@${this.seat.userId}>`)) return false;
    // Only a card just played, whose primary we have not touched (a press survives restarts in `_presses`).
    if (Date.now() - Date.parse(p.m.timestamp) > 5 * 60000 || p.m._presses?.[this.seat.userId]) return false;
    const ids = p.controls.map((c) => baseId(c.custom_id));
    const has = (id: string) => p.controls.find((c) => baseId(c.custom_id) === id);
    if (!this.once(`primary:${p.m.id}`)) return false;
    const board = await this.seat.board(game, true);
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    if (!board || !me) return false;
    const press = async (id: string, why: string) => {
      const c = has(id);
      if (!c) return false;
      this.seat.log(`strategy card primary: ${why}`);
      const err = await this.seat.press(p, c, `primary: ${why}`);
      return !err;
    };
    if (ids.includes("leadershipGenerateCCButtons")) {
      this.add(game, new LeadershipJob(this.seat, game, p.m.id, true));
      return press("leadershipGenerateCCButtons", "Leadership — gain command tokens");
    }
    if (ids.includes("acquireATechWithSC_first")) {
      this.add(game, new TechJob(this.seat, game, p.m.id, me.techs, 0));
      return press("acquireATechWithSC_first", `Technology — research ${nextTech(me.techs) ?? "?"}`);
    }
    if (ids.includes("constructionPrimary_produce")) {
      const dock = dockSystems(board, me).find((s) => !hasMyCC(s, me));
      if (dock && spendable(board, me) >= 3) {
        this.add(game, new ConstructionJob(this.seat, game, p.m.id));
        return press("constructionPrimary_produce", "Construction — produce at a space dock");
      }
      return false;
    }
    if (ids.includes("scoreAnObjective") || ids.includes("sc_draw_so") || ids.includes("score_imperial")) {
      let acted = false;
      if (me.planets.includes("mrte") && has("score_imperial")) acted = (await press("score_imperial", "Imperial — score Mecatol Rex")) || acted;
      const pub = scorablePublics(board, me)[0];
      if (pub && has("scoreAnObjective")) acted = (await press("scoreAnObjective", `Imperial — score ${pub.name}`)) || acted;
      else if (!me.planets.includes("mrte") && has("sc_draw_so")) acted = (await press("sc_draw_so", "Imperial — draw a secret objective")) || acted;
      return acted;
    }
    if (ids.includes("sc_ac_draw")) return press("sc_ac_draw", "Politics — draw 2 action cards");
    if (ids.includes("sc_refresh")) return press("sc_refresh", "Trade — replenish commodities");
    return false;
  }

  /** Someone else's Technology: follow when we can easily afford it. */
  private async follow(game: string, faction: string, p: Prompt): Promise<boolean> {
    const content = String(p.m.content ?? "");
    if (!/played by/.test(content) || content.includes(`<@${this.seat.userId}>`)) return false;
    const get = p.controls.find((c) => baseId(c.custom_id) === "acquireATechWithSC_first");
    if (!get || p.m._presses?.[this.seat.userId]) return false;
    if (Date.now() - Date.parse(p.m.timestamp) > 15 * 60000) return false;
    if (!this.once(`follow:${p.m.id}`)) return false;
    const board = await this.seat.board(game, true);
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    if (!board || !me) return false;
    const tech = nextTech(me.techs);
    if (!tech || me.strategicCC < 1 || spendable(board, me) < 6) return false;
    this.add(game, new TechJob(this.seat, game, p.m.id, me.techs, 4));
    this.seat.log(`following Technology: research ${tech} for 4 resources and a strategy token`);
    await this.seat.press(p, get, "follow Technology");
    void faction;
    return true;
  }

  /** Our turn to vote on an agenda: vote (cheaply) rather than abstain, so agendas do not end in a speaker tie. */
  private async vote(game: string, faction: string, p: Prompt): Promise<boolean> {
    const c = p.controls.find((x) => x.custom_id === `FFCC_${faction}_vote`);
    if (!c) return this.resumeVote(game, faction, p);
    if (p.m._presses?.[this.seat.userId] || Date.now() - Date.parse(p.m.timestamp) > 10 * 60000) return false;
    if (!this.once(`vote:${p.m.id}`)) return false;
    this.add(game, new VoteJob(this.seat, game, String(BigInt(p.m.id) - 1n)));
    this.seat.log("agenda: voting");
    return true;
  }

  /** A vote of ours half done (e.g. the shim restarted mid-vote): pick it up where it stands. */
  private async resumeVote(game: string, faction: string, p: Prompt): Promise<boolean> {
    if ((this.jobs.get(game) ?? []).some((j) => j instanceof VoteJob)) return false;
    if (!p.controls.some((c) => /^(outcome_|planetOutcomes_|exhaustForVotes_|proceedToFinalizingVote$|resolveAgendaVote_[1-9])/.test(baseId(c.custom_id)))) return false;
    if (!promptForMe(this.seat, p, faction) || Date.now() - Date.parse(p.m.edited_timestamp ?? p.m.timestamp) < 20000) return false;
    const board = await this.seat.board(game);
    const me = board ? playerOf(board, this.seat.userId) : undefined;
    if (!board || !me || board.phase !== "agenda.voting" || board.activePlayer !== me.color) return false;
    if (!this.once(`vote-resume:${p.m.id}`)) return false;
    this.add(game, new VoteJob(this.seat, game, String(BigInt(p.m.id) - 1n)));
    this.seat.log("agenda: resuming a vote left half done");
    return true;
  }

  /** Status homework: press "Redistribute, Gain, & Confirm Command Tokens" once, then gain the tokens. */
  private async statusTokens(game: string, p: Prompt): Promise<boolean> {
    const c = p.controls.find((x) => baseId(x.custom_id) === "redistributeCCButtons");
    if (!c || p.m._presses?.[this.seat.userId] || Date.now() - Date.parse(p.m.timestamp) > 15 * 60000) return false;
    if (!this.once(`cc:${p.m.id}`)) return false;
    const board = await this.seat.board(game, true);
    if (!board || !/^status/.test(board.phase)) {
      this.handled.delete(`cc:${p.m.id}`);
      return false;
    }
    this.add(game, new StatusTokensJob(this.seat, game, p.m.id));
    await this.seat.press(p, c, "status: gain this round's command tokens");
    return true;
  }

  /** Status phase: score a public objective we meet, and a secret the bot says we can score; else say no. */
  private async scoring(game: string, faction: string, p: Prompt): Promise<boolean> {
    const ids = p.controls.map((c) => baseId(c.custom_id));
    const me0 = this.seat.userId;
    // The secret objective list we asked for (only we see it).
    if (ids.some((b) => /^so_score_hand_/.test(b)) && p.m._ephemeral_for === me0) {
      if (!this.once(`so-pick:${p.m.id}`)) return false;
      const name = this.capableSecret(game, p.m.id);
      const c = p.controls.find((x) => /^so_score_hand_/.test(baseId(x.custom_id)) && !!name && x.label.toLowerCase().includes(name.toLowerCase()));
      if (c) {
        this.seat.log(`status: score secret objective ${c.label}`);
        await this.seat.press(p, c, "score a secret objective");
        return true;
      }
      return false;
    }
    // Imperial's "Score A Public": a list of public objectives for us alone.
    if (ids.some((b) => /^po_scoring_/.test(b)) && !ids.includes("po_no_scoring") && (p.m._ephemeral_for === me0 || p.m._prompted_for === me0)) {
      if (!this.once(`po-pick:${p.m.id}`)) return false;
      const board = await this.seat.board(game, true);
      const me = board ? playerOf(board, me0) : undefined;
      const pub = board && me ? scorablePublics(board, me)[0] : undefined;
      const c = pub ? p.controls.find((x) => /^po_scoring_/.test(baseId(x.custom_id)) && x.label.toLowerCase().includes(pub.name.toLowerCase())) : undefined;
      if (c) {
        this.seat.log(`Imperial: score public objective ${pub!.name}`);
        const spend = SPEND[pub!.name.toLowerCase()];
        if (spend) this.add(game, new ScoreBillJob(this.seat, game, p.m.id, spend));
        await this.seat.press(p, c, "score a public objective");
        return true;
      }
      return false;
    }
    if (!ids.includes("po_no_scoring") && !ids.includes("so_no_scoring")) return false;
    if (p.m._presses?.[me0] && !this.handled.has(`po:${p.m.id}`) && !this.handled.has(`so:${p.m.id}`)) {
      // Answered before a restart: leave it.
      return false;
    }
    const board = await this.seat.board(game);
    const me = board ? playerOf(board, me0) : undefined;
    if (!board || !me || !/^status/.test(board.phase)) return false;
    if (this.once(`po:${p.m.id}`)) {
      const pub = scorablePublics(board, me)[0];
      const c = pub ? p.controls.find((x) => /^po_scoring_/.test(baseId(x.custom_id)) && x.label.toLowerCase().includes(pub.name.toLowerCase())) : undefined;
      if (c) {
        this.seat.log(`status: score public objective ${pub!.name}`);
        const spend = SPEND[pub!.name.toLowerCase()];
        if (spend) this.add(game, new ScoreBillJob(this.seat, game, p.m.id, spend));
        await this.seat.press(p, c, "score a public objective");
      } else {
        const no = p.controls.find((x) => baseId(x.custom_id) === "po_no_scoring");
        if (no) await this.seat.press(p, no, "status: no public objective to score");
      }
      return true;
    }
    if (this.once(`so:${p.m.id}`)) {
      const name = this.capableSecret(game, undefined);
      const ask = p.controls.find((x) => baseId(x.custom_id) === "get_so_score_buttons");
      if (name && ask) {
        this.seat.log(`status: the bot says we can score ${name}`);
        await this.seat.press(p, ask, "list secret objectives to score");
      } else {
        const no = p.controls.find((x) => baseId(x.custom_id) === "so_no_scoring");
        if (no) await this.seat.press(p, no, "status: no secret objective to score");
      }
      return true;
    }
    void faction;
    return false;
  }

  /** The secret objective the bot said (this status phase) we are capable of scoring, if any. */
  private capableSecret(game: string, before: string | undefined): string | undefined {
    const all = this.seat.messages(game);
    for (let i = all.length - 1; i >= 0 && i >= all.length - 120; i--) {
      const m = all[i].m;
      if (before && !snowflakeAfter(before, m.id)) continue;
      if (Date.now() - Date.parse(m.timestamp) > 20 * 60000) break;
      const content = String(m.content ?? "");
      if (!content.includes(`<@${this.seat.userId}>`) || !/capable of scoring the following secret/i.test(content)) continue;
      const name = /\n[^\n]*?_([^_\n]{4,60})_/.exec(content)?.[1];
      if (name) return name.trim();
    }
    return undefined;
  }
}

export { promptForMe, lockOf };
