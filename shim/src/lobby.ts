import type { IncomingMessage, ServerResponse } from "node:http";
import { token } from "./ids.js";
import { readBody, sendJson, discordError } from "./http.js";
import type { Hub } from "./hub.js";
import type { Clients } from "./clients.js";
import type { Json } from "./store.js";

/** Site-level endpoints that have no Discord equivalent: player links and table setup. */
export class Lobby {
  constructor(private hub: Hub, private clients: Clients) {
    this.ensureLobbyChannel();
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
  createSeat(name: string): Json {
    const user = this.store.addUser(name);
    const tok = token(18);
    this.store.state.seats[tok] = { token: tok, user_id: user.id };
    this.store.scheduleSave();
    this.hub.memberAdd(user.id);
    return { name, user_id: user.id, token: tok };
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
      return sendJson(res, 200, names.map((n) => this.createSeat(n.slice(0, 32))));
    }

    return discordError(res, 404, 0, "not found");
  }
}
