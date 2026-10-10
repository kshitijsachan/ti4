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
  start(userId: string, botCount: number, expansion: Expansion, factions: string[] = []): Promise<SoloJob> {
    return this.queue(() => this.create(userId, { botCount, others: [] }, expansion, factions));
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

  private async create(userId: string, seats: { botCount: number; others: string[] }, expansion: Expansion, factions: string[] = []): Promise<SoloJob> {
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
      const setup = this.setup(job, p, actions.id, expansion, factions).finally(() => p.close());
      void setup
        .then(() => (job.state === "drafting" ? this.steward(job, actions.id) : undefined))
        .catch((e) => log.warn(`solo ${job.game}: steward stopped: ${(e as Error).message}`));
      // Answer the caller once the draft runs (usually seconds), so a broken setup is an error, not a game that
      // looks fine; a slow bot still gets an answer after 45s and the rest is reported by the status endpoint.
      await Promise.race([setup, sleep(45 * SECOND)]);
      if (job.state === "error") throw new Error(`Game ${job.game} could not be set up: ${job.error}`);
      return job;
    } catch (e) {
      p.close();
      this.fail(job, e);
      throw e;
    }
  }

  private async setup(job: SoloJob, p: Player, actionsId: string, expansion: Expansion, factions: string[] = []) {
    const userId = job.user_id;
    const find = (id: RegExp) => this.store.messages(actionsId).filter((m) => visible(m, userId) && hasControl(m, id)).pop();
    try {
      await this.liveOptions(job, p, actionsId);
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
      if (factions.length) await this.prioritise(job, p, actionsId, settings, factions);
      await this.ensureSeated(job, p, actionsId, settings);
      this.note(job, "Starting the draft with default settings");
      await this.retry(job, "Start Draft", () => p.click(settings, "jmfA_main_startMilty"));

      await this.waitFor(job, "the draft to start", 360 * SECOND, async () => {
        const draft = await this.draft(job.game!);
        return draft?.status === "drafting" || draft?.status === "finished" ? draft : undefined;
      });
      const drafted = await this.draft(job.game!);
      const inDraft = new Set<string>((drafted?.players ?? []).map((x: Json) => String(x.userId)));
      const missing = [job.user_id, ...job.others].filter((id) => !inDraft.has(id));
      if (missing.length) throw new Error(`the draft started without ${this.names(missing)}`);
      this.note(job, "Drafting", "drafting");
    } catch (e) {
      this.fail(job, e);
    }
  }

  private names(ids: string[]) {
    return ids.map((id) => String(this.store.state.users[id]?.global_name ?? id)).join(", ");
  }

  /**
   * Every invited seat must be in the game and on the draft settings' player list before the draft starts: the bot
   * drafts only the listed players and drops the rest from the game (pbd61 started with only its human). Missing
   * seats are added through the settings' own "Add player" selection; if that does not work, setup fails loudly.
   */
  private async ensureSeated(job: SoloJob, p: Player, actionsId: string, settings: StoredMessage) {
    const want = [job.user_id, ...job.others];
    const web = await this.webData(job.game!);
    const seated = new Set<string>((web?.playerData ?? []).map((x: Json) => String(x.discordId)));
    const notInGame = want.filter((id) => !seated.has(id));
    if (web && notInGame.length) throw new Error(`the bot did not seat ${this.names(notInGame)} in the game`);
    const current = () => this.store.findMessage(actionsId, settings.id) ?? settings;
    const listed = () => {
      const line = /`\s*Players`:\s*\[([^\]]*)\]/.exec(String(current().content ?? ""))?.[1] ?? "";
      const names = line.split(",").map((x) => x.trim());
      return want.filter((id) => !names.includes(String(this.store.state.users[id]?.global_name ?? "")));
    };
    let missing = listed();
    if (!missing.length) return;
    this.note(job, `The draft settings left out ${this.names(missing)}; adding them`);
    for (let attempt = 1; attempt <= 3 && missing.length; attempt++) {
      if (hasControl(current(), "jmfN_main.players_0")) await p.click(current(), "jmfN_main.players_0");
      await this.waitFor(job, "the Players and Factions page", 10 * SECOND, () => hasControl(current(), "jmfA_main.players_includePlayers") || undefined).catch(() => undefined);
      if (hasControl(current(), "jmfA_main.players_includePlayers")) {
        const since = this.lastId(actionsId);
        await p.click(current(), "jmfA_main.players_includePlayers");
        const boxes = await this.waitFor(job, "the player selection box", 10 * SECOND, () =>
          this.newer(actionsId, since, job.user_id).find((m) => m._ephemeral_for === job.user_id && selects(m).length),
        ).catch(() => undefined);
        const box = boxes && selects(boxes).find((x) => x.values.some((v) => missing.includes(v)));
        if (boxes && box) {
          await p.op({ op: "select", channel_id: actionsId, message_id: boxes.id, custom_id: box.custom_id, values: box.values.filter((v) => missing.includes(v)), component_type: 3 });
          await sleep(1500);
        }
      }
      for (let i = 1; i <= 3 && !hasControl(current(), "jmfA_main_startMilty"); i++) {
        if (hasControl(current(), "jmfN_main_0")) await p.click(current(), "jmfN_main_0");
        await this.waitFor(job, "the main settings page", 8 * SECOND, () => hasControl(current(), "jmfA_main_startMilty") || undefined).catch(() => undefined);
      }
      missing = listed();
    }
    if (missing.length) throw new Error(`the draft settings would leave out ${this.names(missing)}; not starting a draft without them`);
  }

  /**
   * Live play, not async: right after the game exists, the creator turns off the bot's async-only machinery with its own
   * command (`/game setup auto_ping:0 whispers_enabled:false`): no auto-pings / "waiting on you" reminders, no whispers.
   */
  private async liveOptions(job: SoloJob, p: Player, actionsId: string) {
    const err = await p.op({
      op: "command",
      channel_id: actionsId,
      name: "game",
      options: [{ type: 1, name: "setup", options: [{ type: 4, name: "auto_ping", value: 0 }, { type: 5, name: "whispers_enabled", value: false }] }],
    });
    this.note(job, err ? `Live-play options: ${err}` : "Live play: auto-pings and whispers off");
  }

  /** Message id → when the janitor answered it. */
  private janitored = new Map<string, number>();

  /**
   * Async-only questions the bot puts to each person at the table, answered for them the live-play way: the welcome
   * survey ("No"), the timer for auto-passing on Sabotage ("Decline"), and whether the bot may auto-pass their secret
   * scoring ("Always manual"; the autopilot seats allow it). Each is a one-off per person or per game.
   */
  private async janitor(job: SoloJob, game: string) {
    const s = this.store.state;
    const autopilot = new Set(Object.values(s.seats).filter((x) => x.autopilot).map((x) => x.user_id));
    const people = [job.user_id, ...job.others].filter((id) => !autopilot.has(id));
    for (const userId of people) {
      for (const m of this.gameMessages(game, userId)) {
        if (this.janitored.has(m.id)) continue;
        const ids = controlIds(m.components);
        const content = String(m.content ?? "");
        if (!content.includes(`<@${userId}>`) && m._ephemeral_for !== userId) continue;
        let press: string | undefined;
        if (ids.some((id) => id.startsWith("answerSurvey_")) && ids.includes("deleteButtons")) press = "deleteButtons";
        else if (ids.some((id) => id.startsWith("setAutoPassMedian_")) && ids.includes("deleteButtons")) press = "deleteButtons";
        else if (ids.includes("sandbagPref_manual")) press = "sandbagPref_manual";
        if (!press) continue;
        this.janitored.set(m.id, Date.now());
        const p = new Player(this.clients, userId);
        try {
          const err = await p.click(m, press);
          log.info(`solo ${game}: answered "${content.replace(/<[^>]+>/g, "").trim().slice(0, 60)}" for ${s.users[userId]?.global_name ?? userId} with ${press}${err ? ` -> ${err}` : ""}`);
        } finally {
          p.close();
        }
      }
    }
  }

  /**
   * Test games for particular factions: puts them on the Milty settings' "Prioritized factions" list the way a person
   * would (Players and Factions page → "Prioritize faction" → the selection boxes it offers), then returns to the main
   * page. The bot only accepts selections from selection boxes it posted, hence the round trip.
   */
  private async prioritise(job: SoloJob, p: Player, actionsId: string, settings: StoredMessage, factions: string[]) {
    this.note(job, `Prioritising ${factions.join(", ")}`);
    const left = new Set(factions);
    try {
      await this.retry(job, "the Players and Factions settings", () => p.click(settings, "jmfN_main.players_0"));
      await this.waitFor(job, "the Players and Factions page", 15 * SECOND, () => hasControl(this.store.findMessage(actionsId, settings.id) ?? settings, "jmfA_main.players_includePriFactions") || undefined);
      for (let round = 0; left.size && round < 4; round++) {
        const since = this.lastId(actionsId);
        const page = this.store.findMessage(actionsId, settings.id) ?? settings;
        const err = await p.click(page, "jmfA_main.players_includePriFactions");
        if (err) throw new Error(err);
        const boxes = await this.waitFor(job, "the faction selection boxes", 15 * SECOND, () =>
          this.newer(actionsId, since, job.user_id).find((m) => m._ephemeral_for === job.user_id && selects(m).length),
        );
        const box = selects(boxes).find((x) => x.values.some((v) => left.has(v)));
        if (!box) break;
        const values = box.values.filter((v) => left.has(v));
        const e2 = await p.op({ op: "select", channel_id: actionsId, message_id: boxes.id, custom_id: box.custom_id, values, component_type: 3 });
        if (e2) throw new Error(e2);
        values.forEach((v) => left.delete(v));
        await sleep(800);
      }
      if (left.size) this.note(job, `Not offered by the settings: ${[...left].join(", ")}`);
    } catch (e) {
      this.note(job, `Prioritising factions failed: ${(e as Error).message}`);
    }
    // Back to the main page, whose Start Draft button the bot only accepts while it is shown.
    const current = () => this.store.findMessage(actionsId, settings.id) ?? settings;
    for (let attempt = 1; attempt <= 4 && !hasControl(current(), "jmfA_main_startMilty"); attempt++) {
      if (hasControl(current(), "jmfN_main_0")) await p.click(current(), "jmfN_main_0");
      await this.waitFor(job, "the main settings page", 8 * SECOND, () => hasControl(current(), "jmfA_main_startMilty") || undefined).catch(() => undefined);
    }
    if (!hasControl(current(), "jmfA_main_startMilty")) throw new Error("the draft settings did not return to their main page");
  }

  /**
   * Every game: once the draft is over, take the table-wide setup steps nobody is addressed by, as a seated person,
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
    let setupDone = false;
    /** Setup states (each seat's faction and technology count) in which the bot refused to deal. */
    const refusedAt = new Set<string>();
    let doneAt = 0;
    const setupDoneAt = () => (doneAt ||= Date.now());
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
      if (setupDone || (phase && !phase.startsWith("setup"))) {
        if (!setupDone) say("Setup done: strategy phase", "playing");
        setupDone = true;
        // Live play: keep answering the async-only questions the bot asks the people at the table in round 1
        // (welcome survey, auto-pass timers, ...), then retire.
        if (Number(web.gameRound ?? 1) >= 2 || Date.now() - setupDoneAt() > 45 * 60 * SECOND) return;
        await this.janitor(job, game);
        continue;
      }
      await this.janitor(job, game);
      // Every seat's setup prompts, in their private threads too (the steward is the shim, not a player).
      const setupMessages = this.gameMessages(game, null);
      const latest = (id: string) => this.store.messages(actionsId).filter((m) => visible(m, userId) && hasControl(m, id)).pop();
      const quietFor = Date.now() - this.lastActivity(game);
      const again = (m: StoredMessage) => {
        const at = pressed.get(m.id);
        return at === undefined || Date.now() - at > 45 * SECOND;
      };

      // The bot posts "Deal 2 Secret Objectives To All" more than once (again after Keleres sets up) and deletes only
      // the copy that was pressed: once anyone holds a secret objective, the deal is done.
      const dealt = this.realPlayers(web).some((p: Json) => Number(p.soCount ?? 0) > 0 || Object.keys(p.secretsScored ?? {}).length > 0);
      const deal = dealt ? undefined : latest("deal2SOToAll");
      if (deal) {
        // Starting-technology prompts nobody has answered yet: "<faction> use the buttons to choose your starting
        // technology" (tech buttons, or "Get a Technology" when the options are open), and the tech lists they lead to.
        const choosing = setupMessages.filter(
          (m) =>
            BigInt(m.id) > BigInt(deal.id) - (60n * 1000n << 22n) &&
            !Object.keys(m._presses ?? {}).length &&
            controlIds(m.components).some((id) => !/^(deleteButtons|ultimateUndo|undo)/i.test(id)) &&
            (/starting tech/i.test(String(m.content ?? "")) || hasControl(m, /(^|_)getTech_.*noPay|^setupStep5_\d+_keleres|(^|_)getKeleresTechOptions$/)),
        );
        if (choosing.length) {
          const who = [...new Set(choosing.map((m) => this.whoIsAsked(web, m)))];
          say(`Waiting for ${who.join(", ")} to choose a starting technology`);
          continue;
        }
        // Never force it: the bot refuses an early press ("Cannot deal secret objectives yet ... press the button
        // again" / Keleres not set up) and a second press would push it through. After a refusal, press again only
        // once the table's setup has visibly moved on (someone gained a technology or a faction).
        const setupState = JSON.stringify(this.realPlayers(web).map((p: Json) => [p.discordId, p.faction, (p.techs ?? []).length]));
        if (refusedAt.has(setupState)) continue;
        if (quietFor < 6 * SECOND || pressed.has(deal.id) && refusedAt.size === 0) continue;
        pressed.set(deal.id, Date.now());
        say("Everyone is set up: dealing secret objectives");
        await this.pressAs(job, deal, "deal2SOToAll");
        await sleep(4 * SECOND);
        const after = await this.webData(game);
        const dealtNow = after && this.realPlayers(after).some((p: Json) => Number(p.soCount ?? 0) > 0);
        if (!dealtNow) {
          refusedAt.add(setupState);
          say("The bot did not deal yet (a seat is not set up); waiting for setup to move on");
        }
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
   * After a restart: games still being set up get their steward back.
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
      // Games still drafting too: a restart mid-draft must not leave the game without its steward.
      const draft = await this.draft(game);
      if (!draft || (draft.status !== "finished" && draft.status !== "drafting")) continue;
      let ids: string[] = this.realPlayers(web).map((p: Json) => String(p.discordId));
      if (!ids.length) ids = (draft.players ?? []).map((p: Json) => String(p.userId)).filter((id: string) => id && id !== "null");
      const humans = ids.filter((id: string) => !autopilot.has(id));
      // Every game in setup gets a steward (solo or with friends): it presses the table-wide steps as a person seated
      // at the table once everyone is ready, so nobody has to.
      if (!humans.length || ids.length < 2) continue;
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
  private gameMessages(game: string, userId: string | null): StoredMessage[] {
    const s = this.store.state;
    const out: StoredMessage[] = [];
    for (const ch of Object.values(s.channels)) {
      const name = String(ch.name ?? "");
      if (!name.startsWith(`${game}-`) && !name.includes(`-${game}-`)) continue;
      if (userId && !this.store.canView(userId, ch.id)) continue;
      for (const m of this.store.messages(ch.id)) if ((!userId || visible(m, userId)) && s.users[m.author?.id]?.bot) out.push(m);
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

/** A message's string selection boxes and their option values. */
function selects(m: StoredMessage): { custom_id: string; values: string[] }[] {
  const out: { custom_id: string; values: string[] }[] = [];
  const walk = (list: Json[] | undefined) => {
    for (const c of list ?? []) {
      if (!c || typeof c !== "object") continue;
      if (c.type === 3 && c.custom_id && !c.disabled) out.push({ custom_id: String(c.custom_id), values: (c.options ?? []).map((o: Json) => String(o.value)) });
      walk(c.components);
    }
  };
  walk(m.components);
  return out;
}

function hasControl(m: StoredMessage, id: string | RegExp) {
  return controlIds(m.components).some((c) => (typeof id === "string" ? c === id : id.test(c)));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
