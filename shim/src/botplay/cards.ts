import { playerOf, type Board, type PlayerView } from "./board.js";
import { BuildJob, payStep, type JobResult } from "./production.js";
import { baseId, lockOf, snowflakeAfter, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";
import { promptForMe, Steps } from "./steps.js";
import { dockSystems, hasMyCC, spendable } from "./strategy.js";
import { nextTech, researchable, TECH_PREFERENCE, typeLabelOf } from "./techs.js";

/*
 * Strategy card primaries (and the one secondary worth following: Technology), status-phase scoring.
 * Each multi-step answer is a small job over the bot's prompts with its own deadline; anything a job does not finish
 * is left to the rule table.
 */

const JOB_MS = 90000;

interface Job {
  name: string;
  started: number;
  /** Prompts the job answers (the rule table must leave them alone while it runs). */
  owns(p: Prompt): boolean;
  tick(board: Board | null, me: PlayerView | undefined, faction: string): Promise<JobResult>;
}

/** Leadership: optionally spend 3 influence for a 4th token, then put the tokens in tactics (and one in fleet). */
class LeadershipJob implements Job {
  name = "Leadership";
  started = Date.now();
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
  private steps: Steps;
  private chosen: string | undefined;
  private picked = false;

  constructor(seat: Seat, game: string, since: string | undefined, owned: string[]) {
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
    const bill = s.find(faction, (b) => /^spend_/.test(b) || /^reduceTG_/.test(b));
    if (bill) {
      const r = await payStep(s.seat, bill.p, board, me, "res", s.pressed);
      return r === "done" ? "done" : r === "wait" ? "wait" : "acted";
    }
    return Date.now() - s.lastPress > 10000 ? "done" : "wait";
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
function scorablePublics(board: Board, me: PlayerView): { key: string; name: string }[] {
  return board.objectives
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
      const job = jobs[0];
      if (Date.now() - job.started > JOB_MS) {
        this.seat.log(`${job.name}: giving up after ${JOB_MS / 1000}s`);
        jobs.shift();
        return false;
      }
      const r = await job.tick(board, me, faction);
      if (r === "done") {
        jobs.shift();
        this.seat.log(`${job.name}: done`);
      }
      if (r !== "wait") return true;
    }
    const prompts = this.seat.prompts(game);
    for (let i = prompts.length - 1; i >= 0 && i >= prompts.length - 40; i--) {
      const p = prompts[i];
      if (await this.primary(game, faction, p)) return true;
      if (await this.follow(game, faction, p)) return true;
      if (await this.scoring(game, faction, p)) return true;
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
      this.add(game, new TechJob(this.seat, game, p.m.id, me.techs));
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
    this.add(game, new TechJob(this.seat, game, p.m.id, me.techs));
    this.seat.log(`following Technology: research ${tech} for 4 resources and a strategy token`);
    await this.seat.press(p, get, "follow Technology");
    void faction;
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
      if (!content.includes(`<@${this.seat.userId}>`) || !/capable of scoring/i.test(content)) continue;
      const name = /\n[^\n]*?_([^_\n]{4,60})_/.exec(content)?.[1];
      if (name) return name.trim();
    }
    return undefined;
  }
}

export { promptForMe, lockOf };
