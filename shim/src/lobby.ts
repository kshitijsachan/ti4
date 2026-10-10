import type { IncomingMessage, ServerResponse } from "node:http";
import { token } from "./ids.js";
import { readBody, sendJson, discordError } from "./http.js";
import type { Hub } from "./hub.js";
import type { Clients } from "./clients.js";
import type { Autopilot } from "./autopilot.js";
import type { Expansion, SoloGames } from "./solo.js";
import type { Json } from "./store.js";

/** Site-level endpoints that have no Discord equivalent: player links and table setup. */
export class Lobby {
  autopilot?: Autopilot;
  solo?: SoloGames;

  constructor(private hub: Hub, private clients: Clients) {
    this.ensureLobbyChannel();
    this.ensureBotLogChannel();
  }

  /**
   * The bot reports errors (with stack traces in a thread) to a `bot-log` channel in its primary guild. Players
   * cannot see it; the shim mirrors its contents into the shim log.
   */
  ensureBotLogChannel(): Json {
    for (const [name, topic] of [
      ["slash-command-log", "Slash commands players ran"],
      ["button-log", "Buttons players pressed"],
    ]) {
      this.ensureHiddenChannel(name, topic);
    }
    return this.ensureHiddenChannel("bot-log", "Bot errors and logs");
  }

  /** A channel only the bot sees (the bot logs to `bot-log`, `slash-command-log` and `button-log`). */
  private ensureHiddenChannel(name: string, topic: string): Json {
    const s = this.store.state;
    let ch = Object.values(s.channels).find((c) => c.name === name && c.type === 0);
    if (!ch) {
      ch = this.store.createChannel({
        type: 0,
        name,
        topic,
        permission_overwrites: [{ id: s.guild_id, type: 0, allow: "0", deny: "1024" }],
      });
      this.hub.channelCreate(ch);
    }
    return ch;
  }

  private get store() {
    return this.hub.store;
  }

  ensureLobbyChannel(): Json {
    const s = this.store.state;
    let ch = Object.values(s.channels).find((c) => c.name === "lobby" && c.type === 0);
    if (!ch) {
      ch = this.store.createChannel({ type: 0, name: "lobby", topic: "Create and join games here" });
      this.hub.channelCreate(ch);
    }
    return ch;
  }

  private isAdmin(query: URLSearchParams, body?: Json) {
    const key = query.get("key") ?? body?.key;
    return key && key === this.store.state.admin_token;
  }

  /** Creates a player (Discord user) and returns their private link token. */
  createSeat(name: string, autopilot = false): Json {
    const user = this.store.addUser(name);
    const tok = token(18);
    this.store.state.seats[tok] = { token: tok, user_id: user.id, ...(autopilot ? { autopilot: true } : {}) };
    this.store.scheduleSave();
    this.hub.memberAdd(user.id);
    if (autopilot) this.autopilot?.sync();
    return { name, user_id: user.id, token: tok, autopilot };
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams) {
    const method = req.method ?? "GET";
    const body = method === "POST" ? (await readBody(req)).json : {};

    if (method === "GET" && path === "/me") {
      const userId = this.clients.userForToken(query.get("token"));
      if (!userId) return discordError(res, 401, 0, "unknown link");
      return sendJson(res, 200, { user: this.store.userJson(userId), lobby_channel_id: this.ensureLobbyChannel().id });
    }

    if (method === "GET" && path === "/admin/players") {
      if (!this.isAdmin(query)) return discordError(res, 403, 0, "bad key");
      const s = this.store.state;
      return sendJson(
        res,
        200,
        Object.values(s.seats).map((seat) => ({ ...seat, name: s.users[seat.user_id]?.global_name })),
      );
    }

    if (method === "POST" && path === "/admin/players") {
      if (!this.isAdmin(query, body)) return discordError(res, 403, 0, "bad key");
      const names: string[] = (body.names ?? []).map((n: string) => String(n).trim()).filter(Boolean);
      if (!names.length) return discordError(res, 400, 0, "no names");
      return sendJson(res, 200, names.map((n) => this.createSeat(n.slice(0, 32), body.autopilot === true)));
    }

    /** Hands a seat to the shim's autopilot (or back): {user_id, enabled}. */
    if (method === "POST" && path === "/admin/autopilot") {
      if (!this.isAdmin(query, body)) return discordError(res, 403, 0, "bad key");
      if (!this.autopilot?.setEnabled(String(body.user_id ?? ""), body.enabled === true)) return discordError(res, 404, 0, "no such player");
      return sendJson(res, 200, { user_id: body.user_id, autopilot: body.enabled === true });
    }

    /** One-click solo test game: {token (the human's seat), bots: 2..7, expansion?: te | newPoK | oldPoK}. */
    if (method === "POST" && path === "/solo-game") {
      const userId = this.clients.userForToken(String(body.token ?? query.get("token") ?? ""));
      if (!userId || !this.solo) return discordError(res, 401, 0, "unknown link");
      const seat = Object.values(this.store.state.seats).find((x) => x.user_id === userId);
      if (seat?.autopilot) return discordError(res, 400, 0, "that seat is played by the autopilot");
      const bots = Math.min(7, Math.max(2, Math.round(Number(body.bots ?? 3)) || 3));
      const expansion: Expansion = ["te", "newPoK", "oldPoK"].includes(body.expansion) ? body.expansion : "te";
      try {
        const job = await this.solo.start(userId, bots, expansion);
        return sendJson(res, 200, { game: job.game, url: `/game/${job.game}`, status: job });
      } catch (e) {
        return discordError(res, 502, 0, (e as Error).message);
      }
    }

    /**
     * A game for picked players without the lobby: {token (the creator's seat), players: [user ids], expansion?}. The
     * shim runs the slash command, presses Launch Game, picks the expansion and starts the Milty draft as the creator;
     * progress is at GET /app/solo-game/status?game= (or /app/new-game/status).
     */
    if (method === "POST" && path === "/new-game") {
      const userId = this.clients.userForToken(String(body.token ?? query.get("token") ?? ""));
      if (!userId || !this.solo) return discordError(res, 401, 0, "unknown link");
      const s = this.store.state;
      const players: string[] = (Array.isArray(body.players) ? body.players : []).map((id: unknown) => String(id));
      const unknown = players.filter((id) => !s.users[id] || s.users[id].bot);
      if (unknown.length) return discordError(res, 400, 0, `unknown players: ${unknown.join(", ")}`);
      const others = [...new Set(players.filter((id) => id !== userId))];
      if (others.length < 1) return discordError(res, 400, 0, "pick at least one other player");
      if (others.length > 7) return discordError(res, 400, 0, "at most 8 players");
      const expansion: Expansion = ["te", "newPoK", "oldPoK"].includes(body.expansion) ? body.expansion : "te";
      try {
        const job = await this.solo.startTable(userId, others, expansion);
        return sendJson(res, 200, { game: job.game, url: `/game/${job.game}`, status: job });
      } catch (e) {
        return discordError(res, 502, 0, (e as Error).message);
      }
    }

    if (method === "GET" && (path === "/solo-game/status" || path === "/new-game/status")) {
      const job = this.solo?.status(String(query.get("game") ?? ""));
      if (!job) return discordError(res, 404, 0, "no solo game setup known for that game");
      return sendJson(res, 200, job);
    }

    return discordError(res, 404, 0, "not found");
  }
}
