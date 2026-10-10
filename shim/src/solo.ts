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

export type SoloState = "creating" | "setting_up" | "drafting" | "playing" | "error";

export type SoloJob = {
  game?: string;
  /** "solo": the human against fresh autopilot seats; "table": a game for the players the creator picked. */
  kind: "solo" | "table";
  user_id: string;
  bots: { name: string; user_id: string }[];
  /** Everyone else seated (the bots of a solo game, the picked players of a table game). */
  others: string[];
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
    return this.queue(() => this.create(userId, { botCount, others: [] }, expansion));
  }

  /**
   * A game for players the creator picked (people and/or autopilot seats): same orchestration as a solo game minus
   * making bots, so the creator never sees the lobby: create, launch, expansion, Milty settings, start the draft.
   */
  startTable(userId: string, others: string[], expansion: Expansion): Promise<SoloJob> {
    return this.queue(() => this.create(userId, { botCount: 0, others }, expansion));
  }

  private queue(fn: () => Promise<SoloJob>): Promise<SoloJob> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async create(userId: string, seats: { botCount: number; others: string[] }, expansion: Expansion): Promise<SoloJob> {
    const now = new Date().toISOString();
    const kind = seats.botCount > 0 ? "solo" : "table";
    const job: SoloJob = { kind, user_id: userId, bots: [], others: [], state: "creating", step: "Starting", started_at: now, updated_at: now, log: [] };
    const p = new Player(this.clients, userId);
    try {
      await this.waitForBot(job);
      if (kind === "solo") {
        // Reuse existing autopilot seats (the bot's per-player limits are patched off when self-hosted), so test
        // games don't pile up new bot players; create only the shortfall.
        const reused = this.existingBots().slice(0, seats.botCount);
        const names = this.botNames(seats.botCount - reused.length);
        if (names.length) this.note(job, `Adding ${names.join(", ")}`);
        job.bots = [
          ...reused,
          ...names.map((n) => {
            const seat = this.lobby.createSeat(n, true);
            return { name: n, user_id: seat.user_id };
          }),
        ];
        job.others = job.bots.map((b) => b.user_id);
        // Let the bot learn about the new members before they are named in a command.
        await sleep(1500);
      } else {
        job.others = [...new Set(seats.others.filter((id) => id !== userId && this.store.state.users[id] && !this.store.state.users[id].bot))];
      }

      const lobbyId = this.lobby.ensureLobbyChannel().id;
      const since = this.lastId(lobbyId);
      this.note(job, "Asking the bot for a new game");
      const options: Json[] = [
        { type: 3, name: "game_fun_name", value: "_" },
        { type: 6, name: "player1", value: userId },
        ...job.others.map((id, i) => ({ type: 6, name: `player${i + 2}`, value: id })),
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
            (m) => hasControl(m, "launchGame") && job.others.every((id) => String(m.content ?? "").includes(id)),
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
      void this.setup(job, p, actions.id, expansion)
        .finally(() => p.close())
        .then(() => (job.kind === "solo" && job.state === "drafting" ? this.steward(job, actions.id) : undefined))
        .catch((e) => log.warn(`solo ${job.game}: steward stopped: ${(e as Error).message}`));
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
      const sinceExp = this.lastId(actionsId);
      await this.retry(job, "the expansion button", () => p.click(exp, `chooseExp_${expansion}`));
      // The Milty settings read the expansion when they open: let the choice land first.
      await this.waitFor(job, "the expansion to be set", 20 * SECOND, () =>
        this.newer(actionsId, sinceExp, userId).find((m) => /^Set game to use/.test(String(m.content ?? ""))),
      ).catch((e) => log.warn(`solo ${job.game}: ${(e as Error).message}`));

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

  /**
   * Solo games: once the draft is over, take the table-wide setup steps nobody is addressed by, as the human,
   * as soon as the table is ready for them, so the game flows from the draft into the strategy phase with the human
   * only making their own choices (starting technology, which secret objective to keep, a strategy card):
   *   1. "Deal 2 Secret Objectives To All" once no starting-technology prompt is left and the table has settled;
   *   2. "Reveal Objectives and Start Strategy Phase" once every player kept one secret objective.
   * The bot checks both itself (and refuses with a message), so a press that comes early does no harm.
   */
  private async steward(job: SoloJob, actionsId: string) {
    const game = job.game!;
    const userId = job.user_id;
    const end = Date.now() + 12 * 3600 * SECOND;
    /** Message id → when we pressed it. */
    const pressed = new Map<string, number>();
    let lastNote = "";
    const say = (text: string, state?: SoloState) => {
      if (text !== lastNote || state) this.note(job, text, state);
      lastNote = text;
    };
    while (Date.now() < end) {
      await sleep(3 * SECOND);
      if (!this.hub.gateway.botReady) continue;
      const draft = await this.draft(game);
      if (draft && draft.status === "drafting") continue;
      const web = await this.webData(game);
      const phase = String(web?.gameState?.phase ?? "");
      if (!web) continue;
      if (phase && !phase.startsWith("setup")) {
        say("Setup done: strategy phase", "playing");
        return;
      }
      const setupMessages = this.gameMessages(game, userId);
      const latest = (id: string) => this.store.messages(actionsId).filter((m) => visible(m, userId) && hasControl(m, id)).pop();
      const quietFor = Date.now() - this.lastActivity(game);
      const again = (m: StoredMessage) => {
        const at = pressed.get(m.id);
        return at === undefined || Date.now() - at > 45 * SECOND;
      };

      const deal = latest("deal2SOToAll");
      if (deal) {
        // Starting-technology prompts nobody has answered yet: "<faction> use the buttons to choose your starting
        // technology" (tech buttons, or "Get a Technology" when the options are open), and the tech lists they lead to.
        const choosing = setupMessages.filter(
          (m) =>
            BigInt(m.id) > BigInt(deal.id) - (60n * 1000n << 22n) &&
            !Object.keys(m._presses ?? {}).length &&
            controlIds(m.components).some((id) => !/^(deleteButtons|ultimateUndo|undo)/i.test(id)) &&
            (/starting tech/i.test(String(m.content ?? "")) || hasControl(m, /(^|_)getTech_.*noPay/)),
        );
        if (choosing.length) {
          const who = [...new Set(choosing.map((m) => this.whoIsAsked(web, m)))];
          say(`Waiting for ${who.join(", ")} to choose a starting technology`);
          continue;
        }
        if (quietFor < 6 * SECOND || !again(deal)) continue;
        pressed.set(deal.id, Date.now());
        say("Everyone is set up: dealing secret objectives");
        await this.pressAs(job, deal, "deal2SOToAll");
        continue;
      }

      const reveal = latest("startOfGameObjReveal");
      if (reveal) {
        const players = this.realPlayers(web);
        const keeping = players.filter((p: Json) => Number(p.soCount ?? 0) > 1);
        if (keeping.length) {
          say(`Waiting for ${keeping.map((p: Json) => p.userName).join(", ")} to keep a secret objective`);
          continue;
        }
        if (quietFor < 4 * SECOND || !again(reveal)) continue;
        pressed.set(reveal.id, Date.now());
        say("Everyone kept a secret objective: revealing objectives and starting the strategy phase");
        await this.pressAs(job, reveal, "startOfGameObjReveal");
      }
    }
  }

  /**
   * After a restart: solo games (one person, the other seats autopilot) still being set up get their steward back.
   */
  async resumeStewards() {
    await this.waitFor({ kind: "solo", user_id: "", bots: [], others: [], state: "setting_up", step: "", started_at: "", updated_at: "", log: [] }, "the game server", 30 * 60 * SECOND, () => this.hub.gateway.botReady || undefined).catch(() => undefined);
    const seats = Object.values(this.store.state.seats);
    const autopilot = new Set(seats.filter((x) => x.autopilot).map((x) => x.user_id));
    for (const ch of this.actionsChannels()) {
      const game = /^([a-z]+\d+)-actions$/i.exec(String(ch.name))![1];
      if (this.jobs.has(game)) continue;
      const web = await this.webData(game);
      if (!web || !String(web.gameState?.phase ?? "").startsWith("setup")) continue;
      const draft = await this.draft(game);
      if (!draft || draft.status !== "finished") continue;
      const ids = this.realPlayers(web).map((p: Json) => String(p.discordId));
      const humans = ids.filter((id: string) => !autopilot.has(id));
      if (humans.length !== 1 || ids.length < 2) continue;
      const now = new Date().toISOString();
      const job: SoloJob = { game, kind: "solo", user_id: humans[0], bots: [], others: ids.filter((id: string) => id !== humans[0]), state: "drafting", step: "Resuming setup", started_at: now, updated_at: now, log: [] };
      this.jobs.set(game, job);
      this.note(job, "Resuming setup after a restart");
      void this.steward(job, ch.id).catch((e) => log.warn(`solo ${game}: steward stopped: ${(e as Error).message}`));
    }
  }

  /** Presses a button as the job's human through a short-lived virtual client of their seat. */
  private async pressAs(job: SoloJob, msg: StoredMessage, customId: string) {
    const p = new Player(this.clients, job.user_id);
    try {
      const err = await p.click(msg, customId);
      if (err) this.note(job, `${customId}: ${err}`);
    } finally {
      p.close();
    }
  }

  /** Every bot message of a game the user can see: its actions channel, table talk and threads. */
  private gameMessages(game: string, userId: string): StoredMessage[] {
    const s = this.store.state;
    const out: StoredMessage[] = [];
    for (const ch of Object.values(s.channels)) {
      const name = String(ch.name ?? "");
      if (!name.startsWith(`${game}-`) && !name.includes(`-${game}-`)) continue;
      if (!this.store.canView(userId, ch.id)) continue;
      for (const m of this.store.messages(ch.id)) if (visible(m, userId) && s.users[m.author?.id]?.bot) out.push(m);
    }
    return out;
  }

  /** When the newest message in any of the game's channels was posted (or edited). */
  private lastActivity(game: string): number {
    let last = 0;
    for (const ch of Object.values(this.store.state.channels)) {
      const name = String(ch.name ?? "");
      if (!name.startsWith(`${game}-`) && !name.includes(`-${game}-`)) continue;
      const list = this.store.messages(ch.id);
      const m = list[list.length - 1];
      if (!m) continue;
      last = Math.max(last, Date.parse(m.edited_timestamp ?? m.timestamp) || 0, Date.parse(m.timestamp) || 0);
    }
    return last;
  }

  private realPlayers(web: Json): Json[] {
    return (web.playerData ?? []).filter((p: Json) => p.discordId && p.faction && p.faction !== "null" && p.faction !== "neutral");
  }

  /** The player a setup prompt is for: by its faction-locked buttons, else by its mention. */
  private whoIsAsked(web: Json, m: StoredMessage) {
    const faction = controlIds(m.components).map((id) => /^FFCC_([^_]+)_/.exec(id)?.[1]).find(Boolean);
    if (faction) return this.factionName(web, faction);
    const id = /<@!?(\d+)>/.exec(String(m.content ?? ""))?.[1] ?? m._ephemeral_for;
    const p = this.realPlayers(web).find((x: Json) => String(x.discordId) === id);
    return String(p?.userName ?? "a player");
  }

  private factionName(web: Json, faction: string | undefined) {
    const p = this.realPlayers(web).find((x: Json) => x.faction === faction || (faction === "keleres" && String(x.faction).startsWith("keleres")));
    return String(p?.userName ?? faction ?? "a player");
  }

  private async webData(game: string): Promise<Json | null> {
    try {
      const res = await fetch(`${this.botApi}/api/public/game/${encodeURIComponent(game)}/web-data`);
      return res.ok ? ((await res.json()) as Json) : null;
    } catch {
      return null;
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

  /** Autopilot seats named `Bot …`, oldest first. */
  private existingBots(): { name: string; user_id: string }[] {
    const s = this.store.state;
    return Object.values(s.seats)
      .filter((seat) => seat.autopilot && String(s.users[seat.user_id]?.global_name ?? "").startsWith("Bot "))
      .map((seat) => ({ name: String(s.users[seat.user_id].global_name), user_id: seat.user_id }))
      .sort((a, b) => (BigInt(a.user_id) < BigInt(b.user_id) ? -1 : 1));
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
