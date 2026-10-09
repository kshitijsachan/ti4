import type { Hub } from "./hub.js";
import type { Clients } from "./clients.js";
import type { Lobby } from "./lobby.js";
import type { Json, StoredMessage } from "./store.js";
import { log } from "./log.js";

/*
 * One-click solo test game: makes fresh autopilot opponents and then sets the game up AS THE HUMAN, through a
 * virtual client of the human's seat (Clients.attachVirtual), exactly as if they clicked through it in the browser:
 *   /game create_game_button in #lobby → "Launch Game" → expansion button → "Start Milty Setup" → "Start Draft"
 * (the Milty settings menu with its defaults). The HTTP call answers once the game exists; the rest runs in the
 * background and is reported by GET /app/solo-game/status?game=.
 */

export type Expansion = "te" | "newPoK" | "oldPoK";

export type SoloState = "creating" | "setting_up" | "drafting" | "error";

export type SoloJob = {
  game?: string;
  user_id: string;
  bots: { name: string; user_id: string }[];
  state: SoloState;
  step: string;
  error?: string;
  started_at: string;
  updated_at: string;
  log: { at: string; text: string }[];
};

const GREEK = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu"];

/** Lobby answers the bot gives instead of making the game. */
const REFUSAL =
  /within the last 10 minutes|identical to the members|at their game limit|game limit and cannot|turned off game creation|No valid members|Something went wrong|must be a staff member|can't launch because|need to have completed at least one game/i;

const SECOND = 1000;

export class SoloGames {
  private jobs = new Map<string, SoloJob>();
  /** One setup reaches "game exists" at a time: the new game is recognised as the newest actions channel. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private hub: Hub,
    private clients: Clients,
    private lobby: Lobby,
    private botApi: string,
  ) {}

  private get store() {
    return this.hub.store;
  }

  status(game: string): SoloJob | undefined {
    return this.jobs.get(game);
  }

  /** Creates the game and returns once it exists; setup continues in the background. */
  start(userId: string, botCount: number, expansion: Expansion): Promise<SoloJob> {
    const run = this.chain.then(() => this.create(userId, botCount, expansion));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async create(userId: string, botCount: number, expansion: Expansion): Promise<SoloJob> {
    const now = new Date().toISOString();
    const job: SoloJob = { user_id: userId, bots: [], state: "creating", step: "Starting", started_at: now, updated_at: now, log: [] };
    const p = new Player(this.clients, userId);
    try {
      await this.waitForBot(job);
      const names = this.botNames(botCount);
      this.note(job, `Adding ${names.join(", ")}`);
      job.bots = names.map((n) => {
        const seat = this.lobby.createSeat(n, true);
        return { name: n, user_id: seat.user_id };
      });
      // Let the bot learn about the new members before they are named in a command.
      await sleep(1500);

      const lobbyId = this.lobby.ensureLobbyChannel().id;
      const since = this.lastId(lobbyId);
      this.note(job, "Asking the bot for a new game");
      const options: Json[] = [
        { type: 3, name: "game_fun_name", value: "_" },
        { type: 6, name: "player1", value: userId },
        ...job.bots.map((b, i) => ({ type: 6, name: `player${i + 2}`, value: b.user_id })),
      ];
      await this.retry(job, "/game create_game_button", () =>
        p.op({ op: "command", channel_id: lobbyId, name: "game", options: [{ type: 1, name: "create_game_button", options }] }),
      );
      const launch = await this.waitFor(
        job,
        "the bot's Launch Game post",
        30 * SECOND,
        () =>
          this.newer(lobbyId, since, userId).find(
            (m) => hasControl(m, "launchGame") && job.bots.every((b) => String(m.content ?? "").includes(b.user_id)),
          ),
      );

      const before = new Set(this.actionsChannels().map((c) => c.id));
      const sinceLaunch = this.lastId(lobbyId);
      this.note(job, "Launching the game");
      await this.retry(job, "Launch Game", () => p.click(launch, "launchGame"));
      const actions = await this.waitFor(job, "the new game's channels", 120 * SECOND, () => {
        const refusal = this.newer(lobbyId, sinceLaunch, userId).find((m) => REFUSAL.test(String(m.content ?? "")));
        if (refusal) throw new Error(`The bot refused: ${String(refusal.content).replace(/<@\d+>/g, "").trim().slice(0, 300)}`);
        return this.actionsChannels().find((c) => !before.has(c.id) && this.store.canView(userId, c.id));
      });
      job.game = /^([a-z]+\d+)-actions$/i.exec(actions.name)![1];
      this.jobs.set(job.game, job);
      this.note(job, `Game ${job.game} created`, "setting_up");
      void this.setup(job, p, actions.id, expansion).finally(() => p.close());
      return job;
    } catch (e) {
      p.close();
      this.fail(job, e);
      throw e;
    }
  }

  private async setup(job: SoloJob, p: Player, actionsId: string, expansion: Expansion) {
    const userId = job.user_id;
    const find = (id: RegExp) => this.store.messages(actionsId).filter((m) => visible(m, userId) && hasControl(m, id)).pop();
    try {
      const exp = await this.waitFor(job, "the expansion choice", 90 * SECOND, () => find(new RegExp(`^chooseExp_${expansion}$`)));
      this.note(job, `Choosing ${expansion === "te" ? "Thunder's Edge + PoK" : expansion}`);
      await this.retry(job, "the expansion button", () => p.click(exp, `chooseExp_${expansion}`));

      const milty = await this.waitFor(job, "Start Milty Setup", 30 * SECOND, () => find(/^miltySetup$/));
      const sinceMilty = this.lastId(actionsId);
      this.note(job, "Starting Milty setup");
      await this.retry(job, "Start Milty Setup", () => p.click(milty, "miltySetup"));

      const settings = await this.waitFor(job, "the draft settings", 60 * SECOND, () =>
        this.newer(actionsId, sinceMilty, userId).find((m) => hasControl(m, /^jmfA_main_startMilty$/)),
      );
      this.note(job, "Starting the draft with default settings");
      await this.retry(job, "Start Draft", () => p.click(settings, "jmfA_main_startMilty"));

      await this.waitFor(job, "the draft to start", 180 * SECOND, async () => {
        const draft = await this.draft(job.game!);
        return draft?.status === "drafting" || draft?.status === "finished" ? draft : undefined;
      });
      this.note(job, "Drafting", "drafting");
    } catch (e) {
      this.fail(job, e);
    }
  }

  // ---- helpers ----

  private note(job: SoloJob, text: string, state?: SoloState) {
    job.step = text;
    if (state) job.state = state;
    job.updated_at = new Date().toISOString();
    job.log.push({ at: job.updated_at, text });
    log.info(`solo${job.game ? ` ${job.game}` : ""}: ${text}`);
  }

  private fail(job: SoloJob, e: unknown) {
    job.state = "error";
    job.error = (e as Error).message ?? String(e);
    job.updated_at = new Date().toISOString();
    job.log.push({ at: job.updated_at, text: `Failed: ${job.error}` });
    log.warn(`solo${job.game ? ` ${job.game}` : ""}: failed: ${job.error}`);
  }

  private async waitForBot(job: SoloJob) {
    if (this.hub.gateway.botReady) return;
    this.note(job, "Waiting for the game server");
    await this.waitFor(job, "the game server to come online", 120 * SECOND, () => this.hub.gateway.botReady || undefined);
  }

  /** `Bot Alpha`, …, then `Bot Alpha 2`, …: the first unused names. */
  private botNames(n: number): string[] {
    const taken = new Set(Object.values(this.store.state.users).map((u) => String(u.global_name ?? u.username ?? "")));
    const out: string[] = [];
    for (let round = 1; out.length < n; round++) {
      for (const g of GREEK) {
        const name = round === 1 ? `Bot ${g}` : `Bot ${g} ${round}`;
        if (taken.has(name)) continue;
        out.push(name);
        taken.add(name);
        if (out.length === n) break;
      }
    }
    return out;
  }

  private actionsChannels(): Json[] {
    return Object.values(this.store.state.channels).filter((c) => c.type === 0 && /^[a-z]+\d+-actions$/i.test(String(c.name ?? "")));
  }

  private lastId(channelId: string): bigint {
    const list = this.store.messages(channelId);
    return list.length ? BigInt(list[list.length - 1].id) : 0n;
  }

  /** Bot messages the user can see in a channel, posted after `since`. */
  private newer(channelId: string, since: bigint, userId: string): StoredMessage[] {
    return this.store.messages(channelId).filter((m) => BigInt(m.id) > since && visible(m, userId) && this.store.state.users[m.author?.id]?.bot);
  }

  private async draft(game: string): Promise<Json | null> {
    try {
      const res = await fetch(`${this.botApi}/api/public/game/${encodeURIComponent(game)}/draft`);
      return res.ok ? ((await res.json()) as Json) : null;
    } catch {
      return null;
    }
  }

  private async waitFor<T>(job: SoloJob, what: string, ms: number, check: () => T | undefined | Promise<T | undefined>): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const hit = await check();
      if (hit !== undefined && hit !== null && (hit as unknown) !== false) return hit;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}${job.game ? ` in ${job.game}` : ""}.`);
      await sleep(400);
    }
  }

  /** Runs an interaction, trying again while the bot is busy or restarting. */
  private async retry(job: SoloJob, what: string, act: () => Promise<string | undefined>) {
    for (let attempt = 1; ; attempt++) {
      const err = await act();
      if (!err) return;
      const transient = /did not respond|starting up|no answer|try again/i.test(err);
      if (!transient || attempt >= 4) throw new Error(`${what}: ${err}`);
      this.note(job, `${what}: ${err} (retrying)`);
      await sleep(3000 * attempt);
      if (!this.hub.gateway.botReady) await this.waitForBot(job);
    }
  }
}

/** The human's seat, driven through the same browser protocol as their tab. */
class Player {
  private conn: { send(op: Json): void; close(): void };
  private waiting = new Map<string, (err?: string) => void>();
  private n = 0;
  private closed = false;

  constructor(clients: Clients, readonly userId: string) {
    this.conn = clients.attachVirtual(userId, (f) => {
      if (f.t === "interaction_done") this.waiting.get(f.nonce)?.(f.error);
      else if (f.t === "modal" && f.nonce) this.waiting.get(f.nonce)?.(`the bot opened a form (${f.modal?.title ?? "modal"})`);
    });
  }

  /** Sends an op and resolves with the bot's error, if any, once it acknowledged it. */
  op(op: Json): Promise<string | undefined> {
    const nonce = `solo-${++this.n}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => done("no answer from the bot"), 30 * SECOND);
      const done = (err?: string) => {
        clearTimeout(timer);
        this.waiting.delete(nonce);
        resolve(err);
      };
      this.waiting.set(nonce, done);
      this.conn.send({ ...op, nonce });
    });
  }

  click(msg: StoredMessage, customId: string) {
    return this.op({ op: "click", channel_id: msg.channel_id, message_id: msg.id, custom_id: customId });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.conn.close();
  }
}

function visible(m: StoredMessage, userId: string) {
  return !m._ephemeral_for || m._ephemeral_for === userId;
}

function controlIds(components: Json[] | undefined): string[] {
  const ids: string[] = [];
  const walk = (list: Json[] | undefined) => {
    for (const c of list ?? []) {
      if (!c || typeof c !== "object") continue;
      if (c.custom_id && !c.disabled) ids.push(String(c.custom_id));
      walk(c.components);
      if (c.accessory) walk([c.accessory]);
    }
  };
  walk(components);
  return ids;
}

function hasControl(m: StoredMessage, id: string | RegExp) {
  return controlIds(m.components).some((c) => (typeof id === "string" ? c === id : id.test(c)));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
