import type { IncomingMessage, ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { snowflake, token } from "./ids.js";
import { discordError, noContent, readBody, sendJson, type Body } from "./http.js";
import { normalizeComponents, stripPrivate, type Hub } from "./hub.js";
import { newRole, type Interaction, type Json, type StoredMessage } from "./store.js";
import { log } from "./log.js";

type Ctx = { req: IncomingMessage; res: ServerResponse; params: string[]; query: URLSearchParams; body: Body };
type Handler = (ctx: Ctx) => void | Promise<void>;

/** Discord REST API v10 subset, mounted at /api/v10. */
export class Rest {
  private routes: { method: string; re: RegExp; handler: Handler }[] = [];

  constructor(private hub: Hub, private publicWsUrl: () => string, private publicUrl: () => string) {
    this.register();
  }

  private get store() {
    return this.hub.store;
  }

  private on(method: string, pattern: string, handler: Handler) {
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, "([^/]+)") + "/?$");
    this.routes.push({ method, re, handler });
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams) {
    const method = req.method ?? "GET";
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const body = method === "GET" || method === "DELETE" ? { json: {}, files: [] } : await readBody(req);
      const params = m.slice(1).map(decodeURIComponent);
      try {
        await r.handler({ req, res, params, query, body });
      } catch (e) {
        log.error(`${method} ${path} failed: ${(e as Error).stack}`);
        if (!res.headersSent) discordError(res, 500, 0, "shim error");
      }
      if (!res.headersSent) noContent(res);
      log.debug(`${method} ${path} -> ${res.statusCode}`);
      return;
    }
    if (method !== "GET" && method !== "DELETE") await readBody(req);
    log.warn(`UNHANDLED ${method} ${path}`);
    discordError(res, 404, 0, `404: Not Found (shim has no route for ${method} ${path})`);
  }

  private channelOr404(ctx: Ctx, id: string): Json | null {
    const ch = this.store.channel(id);
    if (!ch) {
      discordError(ctx.res, 404, 10003, "Unknown Channel");
      return null;
    }
    return ch;
  }

  private register() {
    const s = () => this.store.state;

    // ---- meta ----
    this.on("GET", "/gateway/bot", ({ res }) =>
      sendJson(res, 200, {
        url: this.publicWsUrl(),
        shards: 1,
        session_start_limit: { total: 1000, remaining: 999, reset_after: 0, max_concurrency: 1 },
      }),
    );
    this.on("GET", "/gateway", ({ res }) => sendJson(res, 200, { url: this.publicWsUrl() }));
    this.on("GET", "/users/@me", ({ req, res }) => {
      // OAuth2 bearer tokens (used by the bot's web API to identify a site user) are seat tokens here.
      const auth = String(req.headers.authorization ?? "");
      if (auth.startsWith("Bearer ")) {
        const seat = s().seats[auth.slice(7).trim()];
        if (!seat) return discordError(res, 401, 0, "401: Unauthorized");
        return sendJson(res, 200, { ...this.store.userJson(seat.user_id), mfa_enabled: false, locale: "en-US", flags: 0, premium_type: 0 });
      }
      sendJson(res, 200, { ...this.store.userJson(s().bot_id), verified: true, mfa_enabled: false, flags: 0 });
    });
    const app = () => ({
      id: s().bot_id,
      name: "TI4 Bot",
      icon: null,
      description: "",
      bot_public: false,
      bot_require_code_grant: false,
      verify_key: "0".repeat(64),
      flags: 0,
      owner: this.store.userJson(s().bot_id),
      team: null,
      summary: "",
      approximate_guild_count: 1,
      bot: this.store.userJson(s().bot_id),
    });
    this.on("GET", "/applications/@me", ({ res }) => sendJson(res, 200, app()));
    this.on("GET", "/oauth2/applications/@me", ({ res }) => sendJson(res, 200, app()));
    this.on("GET", "/users/:id", ({ res, params }) => {
      if (!s().users[params[0]]) return discordError(res, 404, 10013, "Unknown User");
      sendJson(res, 200, this.store.userJson(params[0]));
    });

    // ---- application commands ----
    const putCommands = (guildId: string | null) => ({ res, body }: Ctx) => {
      for (const [id, c] of Object.entries(s().commands)) if ((c.guild_id ?? null) === guildId) delete s().commands[id];
      const out = (body.json as unknown as Json[]).map((c) => {
        const cmd = {
          ...c,
          id: snowflake(),
          application_id: s().bot_id,
          version: snowflake(),
          type: c.type ?? 1,
          guild_id: guildId ?? undefined,
          default_member_permissions: c.default_member_permissions ?? null,
          nsfw: false,
          integration_types: [0],
          contexts: c.contexts ?? null,
        };
        s().commands[cmd.id] = cmd;
        return cmd;
      });
      this.store.scheduleSave();
      sendJson(res, 200, out);
    };
    const listCommands = (guildId: string | null) => ({ res }: Ctx) =>
      sendJson(res, 200, Object.values(s().commands).filter((c) => (c.guild_id ?? null) === guildId));
    this.on("PUT", "/applications/:app/commands", putCommands(null));
    this.on("GET", "/applications/:app/commands", listCommands(null));
    this.on("PUT", "/applications/:app/guilds/:guild/commands", (ctx) => putCommands(ctx.params[1])(ctx));
    this.on("GET", "/applications/:app/guilds/:guild/commands", (ctx) => listCommands(ctx.params[1])(ctx));
    this.on("POST", "/applications/:app/commands", ({ res, body }) => {
      const cmd = { ...body.json, id: snowflake(), application_id: s().bot_id, version: snowflake(), type: body.json.type ?? 1 };
      s().commands[cmd.id] = cmd;
      sendJson(res, 200, cmd);
    });

    // ---- application emojis ----
    this.on("GET", "/applications/:app/emojis", ({ res }) => sendJson(res, 200, { items: Object.values(s().emojis) }));
    this.on("GET", "/applications/:app/emojis/:id", ({ res, params }) => {
      const e = s().emojis[params[1]];
      if (!e) return discordError(res, 404, 10014, "Unknown Emoji");
      sendJson(res, 200, e);
    });
    this.on("POST", "/applications/:app/emojis", ({ res, body }) => {
      const { name, image } = body.json;
      const m = /^data:image\/(\w+);base64,(.*)$/s.exec(image ?? "");
      if (!m) return discordError(res, 400, 50035, "Invalid Form Body");
      const id = snowflake();
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      writeFileSync(join(this.store.dataDir, "emojis", `${id}.${ext}`), Buffer.from(m[2], "base64"));
      const emoji = {
        id,
        name,
        roles: [],
        user: this.store.userJson(s().bot_id),
        require_colons: true,
        managed: false,
        animated: ext === "gif",
        available: true,
        _ext: ext,
      };
      s().emojis[id] = emoji;
      this.store.scheduleSave();
      sendJson(res, 201, stripPrivate(emoji as unknown as StoredMessage));
    });
    this.on("DELETE", "/applications/:app/emojis/:id", ({ res, params }) => {
      delete s().emojis[params[1]];
      this.store.scheduleSave();
      noContent(res);
    });

    // ---- guild ----
    this.on("GET", "/guilds/:g", ({ res }) => {
      const g = this.hub.gateway.guildCreate();
      for (const k of ["members", "channels", "threads", "presences", "voice_states"]) delete g[k];
      sendJson(res, 200, g);
    });
    this.on("GET", "/guilds/:g/channels", ({ res }) =>
      sendJson(res, 200, Object.values(s().channels).filter((c) => ![1, 10, 11, 12].includes(c.type))),
    );
    this.on("GET", "/guilds/:g/threads/active", ({ res }) => {
      const threads = Object.values(s().channels).filter((c) => [10, 11, 12].includes(c.type) && !c.thread_metadata?.archived);
      const members = threads
        .filter((t) => (s().thread_members[t.id] ?? []).includes(s().bot_id))
        .map((t) => ({ id: t.id, user_id: s().bot_id, join_timestamp: t.thread_metadata?.create_timestamp, flags: 0 }));
      sendJson(res, 200, { threads, members });
    });
    this.on("POST", "/guilds/:g/channels", ({ res, body }) => {
      const ch = this.store.createChannel(body.json);
      this.hub.channelCreate(ch);
      sendJson(res, 201, ch);
    });
    this.on("PATCH", "/guilds/:g/channels", ({ body }) => {
      for (const p of body.json as unknown as Json[]) {
        const ch = this.store.channel(p.id);
        if (!ch) continue;
        if (p.position != null) ch.position = p.position;
        if (p.parent_id !== undefined) ch.parent_id = p.parent_id;
        this.hub.channelUpdate(ch);
      }
    });
    this.on("GET", "/guilds/:g/roles", ({ res }) => sendJson(res, 200, Object.values(s().roles)));
    this.on("POST", "/guilds/:g/roles", ({ res, body }) => {
      const r = newRole(body.json, Object.keys(s().roles).length);
      s().roles[r.id] = r;
      this.store.scheduleSave();
      this.hub.gateway.dispatch("GUILD_ROLE_CREATE", { guild_id: s().guild_id, role: r });
      sendJson(res, 200, r);
    });
    this.on("PATCH", "/guilds/:g/roles/:r", ({ res, params, body }) => {
      const r = s().roles[params[1]];
      if (!r) return discordError(res, 404, 10011, "Unknown Role");
      Object.assign(r, body.json);
      this.store.scheduleSave();
      this.hub.gateway.dispatch("GUILD_ROLE_UPDATE", { guild_id: s().guild_id, role: r });
      sendJson(res, 200, r);
    });
    this.on("DELETE", "/guilds/:g/roles/:r", ({ params }) => {
      delete s().roles[params[1]];
      for (const m of Object.values(s().members)) m.roles = m.roles.filter((x) => x !== params[1]);
      this.store.scheduleSave();
      this.hub.gateway.dispatch("GUILD_ROLE_DELETE", { guild_id: s().guild_id, role_id: params[1] });
    });
    this.on("GET", "/guilds/:g/members", ({ res, query }) => {
      const after = query.get("after") ?? "0";
      const limit = Number(query.get("limit") ?? 1);
      const ids = Object.keys(s().members)
        .filter((id) => BigInt(id) > BigInt(after))
        .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
        .slice(0, limit);
      sendJson(res, 200, ids.map((id) => this.store.memberJson(id)));
    });
    this.on("GET", "/guilds/:g/members/search", ({ res, query }) => {
      const q = (query.get("query") ?? "").toLowerCase();
      const ids = Object.keys(s().members).filter((id) => s().users[id]?.username.startsWith(q));
      sendJson(res, 200, ids.map((id) => this.store.memberJson(id)));
    });
    this.on("GET", "/guilds/:g/members/:u", ({ res, params }) => {
      if (!s().members[params[1]]) return discordError(res, 404, 10007, "Unknown Member");
      sendJson(res, 200, this.store.memberJson(params[1]));
    });
    this.on("PATCH", "/guilds/:g/members/:u", ({ res, params, body }) => {
      const id = params[1] === "@me" ? s().bot_id : params[1];
      const m = s().members[id];
      if (!m) return discordError(res, 404, 10007, "Unknown Member");
      if ("nick" in body.json) m.nick = body.json.nick;
      if (Array.isArray(body.json.roles)) m.roles = body.json.roles;
      this.hub.memberUpdate(id);
      sendJson(res, 200, this.store.memberJson(id));
    });
    this.on("PUT", "/guilds/:g/members/:u/roles/:r", ({ params }) => {
      const m = s().members[params[1]];
      if (m && !m.roles.includes(params[2])) {
        m.roles.push(params[2]);
        this.hub.memberUpdate(params[1]);
      }
    });
    this.on("DELETE", "/guilds/:g/members/:u/roles/:r", ({ params }) => {
      const m = s().members[params[1]];
      if (m) {
        m.roles = m.roles.filter((r) => r !== params[2]);
        this.hub.memberUpdate(params[1]);
      }
    });
    this.on("GET", "/guilds/:g/emojis", ({ res }) => sendJson(res, 200, []));
    this.on("GET", "/guilds/:g/stickers", ({ res }) => sendJson(res, 200, []));
    this.on("GET", "/guilds/:g/invites", ({ res }) => sendJson(res, 200, []));
    this.on("GET", "/guilds/:g/webhooks", ({ res }) => sendJson(res, 200, Object.values(s().webhooks ?? {}).map((w) => this.webhookJson(w))));
    this.on("GET", "/guilds/:g/scheduled-events", ({ res }) => sendJson(res, 200, []));

    // ---- channels ----
    this.on("GET", "/channels/:c", (ctx) => {
      const ch = this.channelOr404(ctx, ctx.params[0]);
      if (ch) sendJson(ctx.res, 200, ch);
    });
    this.on("PATCH", "/channels/:c", (ctx) => {
      const ch = this.channelOr404(ctx, ctx.params[0]);
      if (!ch) return;
      const b = ctx.body.json;
      for (const k of ["name", "topic", "position", "parent_id", "permission_overwrites", "nsfw", "rate_limit_per_user"]) {
        if (k in b) ch[k] = b[k];
      }
      if (ch.thread_metadata) {
        for (const k of ["archived", "locked", "invitable", "auto_archive_duration"]) {
          if (k in b) ch.thread_metadata[k] = b[k];
        }
        if ("archived" in b) ch.thread_metadata.archive_timestamp = new Date().toISOString();
      }
      this.hub.channelUpdate(ch);
      sendJson(ctx.res, 200, ch);
    });
    this.on("DELETE", "/channels/:c", (ctx) => {
      const ch = this.channelOr404(ctx, ctx.params[0]);
      if (!ch) return;
      this.hub.channelDelete(ch);
      sendJson(ctx.res, 200, ch);
    });
    this.on("PUT", "/channels/:c/permissions/:o", (ctx) => {
      const ch = this.channelOr404(ctx, ctx.params[0]);
      if (!ch) return;
      const ows: Json[] = (ch.permission_overwrites ??= []);
      const i = ows.findIndex((o) => o.id === ctx.params[1]);
      const ow = { id: ctx.params[1], type: ctx.body.json.type ?? 0, allow: String(ctx.body.json.allow ?? "0"), deny: String(ctx.body.json.deny ?? "0") };
      if (i >= 0) ows[i] = ow;
      else ows.push(ow);
      this.hub.channelUpdate(ch);
    });
    this.on("DELETE", "/channels/:c/permissions/:o", (ctx) => {
      const ch = this.channelOr404(ctx, ctx.params[0]);
      if (!ch) return;
      ch.permission_overwrites = (ch.permission_overwrites ?? []).filter((o: Json) => o.id !== ctx.params[1]);
      this.hub.channelUpdate(ch);
    });
    this.on("POST", "/channels/:c/typing", () => {});
    this.on("POST", "/channels/:c/invites", ({ res, params }) =>
      sendJson(res, 200, { code: "ti4", channel: { id: params[0] }, guild: { id: s().guild_id } }),
    );
    this.on("GET", "/channels/:c/webhooks", ({ res, params }) =>
      sendJson(res, 200, Object.values(s().webhooks ?? {}).filter((w) => w.channel_id === params[0]).map((w) => this.webhookJson(w))),
    );
    this.on("POST", "/channels/:c/webhooks", (ctx) => {
      const ch = this.channelOr404(ctx, ctx.params[0]);
      if (!ch) return;
      const w = {
        id: snowflake(),
        type: 1,
        guild_id: s().guild_id,
        channel_id: ch.id,
        name: ctx.body.json.name ?? "Webhook",
        avatar: null,
        token: token(51),
        application_id: null,
        user: this.store.userJson(s().bot_id),
      };
      (s().webhooks ??= {})[w.id] = w;
      this.store.scheduleSave();
      this.hub.gateway.dispatch("WEBHOOKS_UPDATE", { guild_id: s().guild_id, channel_id: ch.id });
      sendJson(ctx.res, 200, this.webhookJson(w));
    });

    // ---- messages ----
    this.on("GET", "/channels/:c/messages", (ctx) => {
      if (!this.channelOr404(ctx, ctx.params[0])) return;
      const all = this.store.messages(ctx.params[0]).filter((m) => !m._ephemeral_for);
      const limit = Math.min(100, Number(ctx.query.get("limit") ?? 50));
      const before = ctx.query.get("before");
      const after = ctx.query.get("after");
      const around = ctx.query.get("around");
      let out: StoredMessage[];
      if (after) {
        out = all.filter((m) => BigInt(m.id) > BigInt(after)).slice(0, limit).reverse();
      } else if (around) {
        const i = all.findIndex((m) => m.id === around);
        const half = Math.floor(limit / 2);
        out = (i < 0 ? [] : all.slice(Math.max(0, i - half), i + half + 1)).reverse();
      } else {
        const pool = before ? all.filter((m) => BigInt(m.id) < BigInt(before)) : all;
        out = pool.slice(-limit).reverse();
      }
      sendJson(ctx.res, 200, out.map(stripPrivate));
    });
    this.on("GET", "/channels/:c/messages/pins", (ctx) => {
      const pins = this.store.messages(ctx.params[0]).filter((m) => m.pinned);
      sendJson(ctx.res, 200, {
        items: pins.reverse().map((m) => ({ pinned_at: m.timestamp, message: stripPrivate(m) })),
        has_more: false,
      });
    });
    this.on("GET", "/channels/:c/pins", (ctx) =>
      sendJson(ctx.res, 200, this.store.messages(ctx.params[0]).filter((m) => m.pinned).reverse().map(stripPrivate)),
    );
    const pin = (value: boolean) => (ctx: Ctx) => {
      const msg = this.store.findMessage(ctx.params[0], ctx.params[1]);
      if (!msg) return discordError(ctx.res, 404, 10008, "Unknown Message");
      msg.pinned = value;
      this.hub.touchMessage(msg);
      this.hub.gateway.dispatch("CHANNEL_PINS_UPDATE", { guild_id: s().guild_id, channel_id: ctx.params[0] });
    };
    this.on("PUT", "/channels/:c/pins/:m", pin(true));
    this.on("DELETE", "/channels/:c/pins/:m", pin(false));
    this.on("PUT", "/channels/:c/messages/pins/:m", pin(true));
    this.on("DELETE", "/channels/:c/messages/pins/:m", pin(false));
    this.on("GET", "/channels/:c/messages/:m", (ctx) => {
      const msg = this.store.findMessage(ctx.params[0], ctx.params[1]);
      if (!msg || msg._ephemeral_for) return discordError(ctx.res, 404, 10008, "Unknown Message");
      sendJson(ctx.res, 200, stripPrivate(msg));
    });
    this.on("POST", "/channels/:c/messages", (ctx) => {
      const ch = this.channelOr404(ctx, ctx.params[0]);
      if (!ch) return;
      const atts = this.hub.resolveAttachments(ctx.body.json, ctx.body.files) ?? [];
      const msg = this.hub.buildMessage(ch.id, s().bot_id, ctx.body.json, atts);
      this.hub.postMessage(msg);
      sendJson(ctx.res, 200, stripPrivate(msg));
    });
    this.on("PATCH", "/channels/:c/messages/:m", (ctx) => {
      const msg = this.store.findMessage(ctx.params[0], ctx.params[1]);
      if (!msg) return discordError(ctx.res, 404, 10008, "Unknown Message");
      this.hub.editMessage(msg, ctx.body.json, ctx.body.files);
      sendJson(ctx.res, 200, stripPrivate(msg));
    });
    this.on("DELETE", "/channels/:c/messages/:m", (ctx) => {
      if (!this.hub.removeMessage(ctx.params[0], ctx.params[1])) discordError(ctx.res, 404, 10008, "Unknown Message");
    });
    this.on("POST", "/channels/:c/messages/bulk-delete", (ctx) => {
      for (const id of ctx.body.json.messages ?? []) this.hub.removeMessage(ctx.params[0], id);
    });
    this.on("POST", "/channels/:c/messages/:m/crosspost", (ctx) => {
      const msg = this.store.findMessage(ctx.params[0], ctx.params[1]);
      sendJson(ctx.res, 200, msg ? stripPrivate(msg) : {});
    });

    // ---- reactions ----
    const reactionKey = (raw: string) => decodeURIComponent(raw);
    const emojiObj = (key: string) => {
      const m = /^(\w+):(\d+)$/.exec(key);
      return m ? { id: m[2], name: m[1] } : { id: null, name: key };
    };
    this.on("PUT", "/channels/:c/messages/:m/reactions/:e/@me", (ctx) => {
      const msg = this.store.findMessage(ctx.params[0], ctx.params[1]);
      if (!msg) return discordError(ctx.res, 404, 10008, "Unknown Message");
      const key = reactionKey(ctx.params[2]);
      msg._reactors ??= {};
      const users: string[] = (msg._reactors[key] ??= []);
      if (!users.includes(s().bot_id)) users.push(s().bot_id);
      syncReactions(msg, s().bot_id);
      this.hub.touchMessage(msg);
      this.hub.gateway.dispatch("MESSAGE_REACTION_ADD", {
        user_id: s().bot_id,
        channel_id: msg.channel_id,
        message_id: msg.id,
        guild_id: s().guild_id,
        emoji: emojiObj(key),
        burst: false,
        type: 0,
        member: this.store.memberJson(s().bot_id),
      });
    });
    const removeReaction = (ctx: Ctx, userId: string | null) => {
      const msg = this.store.findMessage(ctx.params[0], ctx.params[1]);
      if (!msg) return;
      const key = ctx.params[2] ? reactionKey(ctx.params[2]) : null;
      for (const k of Object.keys(msg._reactors ?? {})) {
        if (key && k !== key) continue;
        msg._reactors[k] = userId ? msg._reactors[k].filter((u: string) => u !== userId) : [];
      }
      syncReactions(msg, s().bot_id);
      this.hub.touchMessage(msg);
    };
    this.on("DELETE", "/channels/:c/messages/:m/reactions/:e/@me", (ctx) => removeReaction(ctx, s().bot_id));
    this.on("DELETE", "/channels/:c/messages/:m/reactions/:e/:u", (ctx) => removeReaction(ctx, ctx.params[3]));
    this.on("DELETE", "/channels/:c/messages/:m/reactions/:e", (ctx) => removeReaction(ctx, null));
    this.on("DELETE", "/channels/:c/messages/:m/reactions", (ctx) => removeReaction(ctx, null));
    this.on("GET", "/channels/:c/messages/:m/reactions/:e", (ctx) => {
      const msg = this.store.findMessage(ctx.params[0], ctx.params[1]);
      const users: string[] = msg?._reactors?.[reactionKey(ctx.params[2])] ?? [];
      sendJson(ctx.res, 200, users.map((u) => this.store.userJson(u)));
    });

    // ---- threads ----
    const createThread = (ctx: Ctx, fromMessage?: string) => {
      const parent = this.channelOr404(ctx, ctx.params[0]);
      if (!parent) return;
      const b = ctx.body.json;
      const type = fromMessage ? (parent.type === 5 ? 10 : 11) : (b.type ?? 12);
      const ch = this.store.createChannel({
        id: fromMessage,
        type,
        name: b.name,
        parent_id: parent.id,
        auto_archive_duration: b.auto_archive_duration,
        invitable: b.invitable,
        owner_id: s().bot_id,
      });
      this.hub.addThreadMember(ch.id, s().bot_id);
      if (fromMessage) {
        const msg = this.store.findMessage(parent.id, fromMessage);
        if (msg) {
          msg.thread = ch;
          msg.flags = (msg.flags ?? 0) | 32;
          this.hub.touchMessage(msg);
        }
      }
      this.hub.channelCreate(ch);
      sendJson(ctx.res, 201, ch);
    };
    this.on("POST", "/channels/:c/threads", (ctx) => createThread(ctx));
    this.on("POST", "/channels/:c/messages/:m/threads", (ctx) => createThread(ctx, ctx.params[1]));
    this.on("PUT", "/channels/:c/thread-members/:u", (ctx) => {
      const id = ctx.params[1] === "@me" ? s().bot_id : ctx.params[1];
      if (!s().users[id]) return discordError(ctx.res, 404, 10013, "Unknown User");
      this.hub.addThreadMember(ctx.params[0], id);
    });
    this.on("DELETE", "/channels/:c/thread-members/:u", (ctx) => {
      const id = ctx.params[1] === "@me" ? s().bot_id : ctx.params[1];
      this.hub.removeThreadMember(ctx.params[0], id);
    });
    this.on("GET", "/channels/:c/thread-members", (ctx) =>
      sendJson(
        ctx.res,
        200,
        (s().thread_members[ctx.params[0]] ?? []).map((u) => ({
          id: ctx.params[0],
          user_id: u,
          join_timestamp: new Date().toISOString(),
          flags: 0,
          member: this.store.memberJson(u),
        })),
      ),
    );
    this.on("GET", "/channels/:c/thread-members/:u", (ctx) => {
      const id = ctx.params[1] === "@me" ? s().bot_id : ctx.params[1];
      if (!(s().thread_members[ctx.params[0]] ?? []).includes(id)) return discordError(ctx.res, 404, 10007, "Unknown Member");
      sendJson(ctx.res, 200, { id: ctx.params[0], user_id: id, join_timestamp: new Date().toISOString(), flags: 0 });
    });
    // Archived threads, newest archive first, paged with ?before=<ISO timestamp | snowflake>&limit=.
    const archived = (type: number[], joinedOnly = false) => (ctx: Ctx) => {
      if (!this.channelOr404(ctx, ctx.params[0])) return;
      const before = ctx.query.get("before");
      const beforeMs = before ? (/^\d+$/.test(before) ? Number((BigInt(before) >> 22n) + 1420070400000n) : Date.parse(before)) : Infinity;
      const limit = Math.max(1, Math.min(100, Number(ctx.query.get("limit") ?? 50)));
      const all = Object.values(s().channels)
        .filter((c) => c.parent_id === ctx.params[0] && type.includes(c.type) && c.thread_metadata?.archived)
        .filter((c) => !joinedOnly || (s().thread_members[c.id] ?? []).includes(s().bot_id))
        .filter((c) => Date.parse(c.thread_metadata.archive_timestamp) < beforeMs)
        .sort((a, b) => Date.parse(b.thread_metadata.archive_timestamp) - Date.parse(a.thread_metadata.archive_timestamp));
      const threads = all.slice(0, limit);
      const members = threads
        .filter((t) => (s().thread_members[t.id] ?? []).includes(s().bot_id))
        .map((t) => ({ id: t.id, user_id: s().bot_id, join_timestamp: t.thread_metadata.create_timestamp, flags: 0 }));
      sendJson(ctx.res, 200, { threads, members, has_more: all.length > threads.length });
    };
    this.on("GET", "/channels/:c/threads/archived/public", archived([10, 11]));
    this.on("GET", "/channels/:c/threads/archived/private", archived([12]));
    this.on("GET", "/channels/:c/users/@me/threads/archived/private", archived([12], true));

    // ---- DMs ----
    this.on("POST", "/users/@me/channels", ({ res, body }) => {
      const rid = body.json.recipient_id;
      const existing = Object.values(s().channels).find((c) => c.type === 1 && c.recipients?.[0]?.id === rid);
      if (existing) return sendJson(res, 200, existing);
      const ch = this.store.createChannel({ type: 1, name: "dm" });
      delete ch.guild_id;
      delete ch.name;
      delete ch.parent_id;
      delete ch.permission_overwrites;
      delete ch.position;
      ch.recipients = [this.store.userJson(rid)];
      this.store.scheduleSave();
      this.hub.channelCreate(ch);
      sendJson(res, 200, ch);
    });

    // ---- interactions ----
    this.on("POST", "/interactions/:id/:token/callback", (ctx) => this.interactionCallback(ctx));
    // Channel webhooks (by id) and interaction followups (by application id + interaction token) share paths.
    this.on("GET", "/webhooks/:id", (ctx) => {
      const w = s().webhooks?.[ctx.params[0]];
      if (!w) return discordError(ctx.res, 404, 10015, "Unknown Webhook");
      sendJson(ctx.res, 200, this.webhookJson(w));
    });
    this.on("PATCH", "/webhooks/:id", (ctx) => {
      const w = s().webhooks?.[ctx.params[0]];
      if (!w) return discordError(ctx.res, 404, 10015, "Unknown Webhook");
      for (const k of ["name", "channel_id"]) if (k in ctx.body.json) w[k] = ctx.body.json[k];
      this.store.scheduleSave();
      sendJson(ctx.res, 200, this.webhookJson(w));
    });
    this.on("DELETE", "/webhooks/:id", (ctx) => {
      if (!s().webhooks?.[ctx.params[0]]) return discordError(ctx.res, 404, 10015, "Unknown Webhook");
      delete s().webhooks![ctx.params[0]];
      this.store.scheduleSave();
    });
    this.on("GET", "/webhooks/:id/:token", (ctx) => {
      const w = this.channelWebhook(ctx);
      if (!w) return discordError(ctx.res, 404, 10015, "Unknown Webhook");
      sendJson(ctx.res, 200, this.webhookJson(w, false));
    });
    this.on("POST", "/webhooks/:app/:token", (ctx) => {
      const w = this.channelWebhook(ctx);
      if (!w) return this.followup(ctx);
      const channelId = ctx.query.get("thread_id") ?? w.channel_id;
      if (!this.channelOr404(ctx, channelId)) return;
      const json = ctx.body.json;
      if (!json.content && !json.embeds?.length && !ctx.body.files.length && !json.components?.length) {
        return discordError(ctx.res, 400, 50006, "Cannot send an empty message");
      }
      const atts = this.hub.resolveAttachments(json, ctx.body.files) ?? [];
      const msg = this.hub.buildMessage(channelId, s().bot_id, json, atts);
      msg.author = { id: w.id, username: json.username ?? w.name, avatar: null, discriminator: "0000", public_flags: 0, flags: 0, bot: true, global_name: null };
      delete msg.member;
      msg.webhook_id = w.id;
      this.hub.postMessage(msg);
      if (ctx.query.get("wait") === "true") return sendJson(ctx.res, 200, stripPrivate(msg));
      noContent(ctx.res);
    });
    this.on("GET", "/webhooks/:app/:token/messages/:m", (ctx) => {
      const msg = this.webhookMessage(ctx);
      if (!msg) return discordError(ctx.res, 404, 10008, "Unknown Message");
      sendJson(ctx.res, 200, stripPrivate(msg));
    });
    this.on("PATCH", "/webhooks/:app/:token/messages/:m", (ctx) => {
      const msg = this.webhookMessage(ctx);
      if (!msg) return discordError(ctx.res, 404, 10008, "Unknown Message");
      this.hub.editMessage(msg, ctx.body.json, ctx.body.files);
      sendJson(ctx.res, 200, stripPrivate(msg));
    });
    this.on("DELETE", "/webhooks/:app/:token/messages/:m", (ctx) => {
      const msg = this.webhookMessage(ctx);
      if (msg) this.hub.removeMessage(msg.channel_id, msg.id);
    });
  }

  // ---- interaction plumbing ----

  private channelWebhook(ctx: Ctx): Json | undefined {
    const w = this.store.state.webhooks?.[ctx.params[0]];
    return w && w.token === ctx.params[1] ? w : undefined;
  }

  private webhookJson(w: Json, withToken = true): Json {
    const out = { ...w };
    if (!withToken) delete out.token;
    out.url = `${this.publicUrl() || ""}/api/webhooks/${w.id}/${w.token}`;
    return out;
  }

  private webhookMessage(ctx: Ctx): StoredMessage | undefined {
    const hook = this.channelWebhook(ctx);
    if (hook) {
      const m = this.store.findMessageAnywhere(ctx.params[2]);
      return m && m.webhook_id === hook.id ? m : undefined;
    }
    const inter = this.store.interactionsByToken.get(ctx.params[1]);
    if (!inter) return undefined;
    const id = ctx.params[2] === "@original" ? inter.original_id : ctx.params[2];
    if (!id) return undefined;
    return this.store.findMessage(inter.channel_id, id) ?? this.store.findMessageAnywhere(id);
  }

  private interactionMessage(inter: Interaction, json: Json, atts: Json[], channelId: string, followup = false) {
    const s = this.store.state;
    const msg = this.hub.buildMessage(channelId, s.bot_id, json, atts);
    msg.webhook_id = s.bot_id;
    msg.application_id = s.bot_id;
    msg.type = inter.type === 2 ? 20 : 19;
    if (msg.type === 19 && !msg.message_reference) msg.type = 0;
    msg.interaction_metadata = {
      id: inter.id,
      type: inter.type,
      user: this.store.userJson(inter.user_id),
      authorizing_integration_owners: { "0": s.guild_id },
    };
    if (inter.type === 2 && inter.command_name) {
      msg.interaction_metadata.name = inter.command_name;
      msg.interaction_metadata.command_type = 1;
    }
    if (inter.type === 3 && inter.message_id) msg.interaction_metadata.interacted_message_id = inter.message_id;
    if (followup && inter.original_id) msg.interaction_metadata.original_response_message_id = inter.original_id;
    if ((json.flags ?? 0) & 64) msg._ephemeral_for = inter.user_id;
    return msg;
  }

  private interactionCallback(ctx: Ctx) {
    const inter = this.store.interactions.get(ctx.params[0]);
    if (!inter || inter.token !== ctx.params[1]) return discordError(ctx.res, 404, 10062, "Unknown interaction");
    if (inter.acked) return discordError(ctx.res, 400, 40060, "Interaction has already been acknowledged.");
    inter.acked = true;
    const { type, data = {} } = ctx.body.json;
    const files = ctx.body.files;
    let resource: Json | undefined;
    switch (type) {
      case 4:
      case 5: {
        const json = type === 4 ? data : { content: "", flags: (data.flags ?? 0) | 128 };
        const atts = this.hub.resolveAttachments(data, files) ?? [];
        const msg = this.interactionMessage(inter, json, atts, inter.channel_id);
        inter.original_id = msg.id;
        inter.ephemeral = !!msg._ephemeral_for;
        this.hub.postMessage(msg);
        resource = { type, message: stripPrivate(msg) };
        break;
      }
      case 6:
        // DEFERRED_UPDATE_MESSAGE: @original now refers to the message the component is on.
        if (inter.message_id) inter.original_id = inter.message_id;
        resource = { type };
        break;
      case 7: {
        const msg = inter.message_id ? this.store.findMessage(inter.channel_id, inter.message_id) : undefined;
        if (msg) {
          this.hub.editMessage(msg, data, files);
          inter.original_id = msg.id;
          resource = { type, message: stripPrivate(msg) };
        }
        break;
      }
      case 8:
        this.autocompleteResults.set(inter.id, data.choices ?? []);
        resource = { type };
        break;
      case 9:
        // Discord assigns numeric component ids (depth-first, 1-based) to modal components lacking one.
        data.components = normalizeComponents(data.components ?? []);
        inter.modal = data;
        for (const l of this.hub.listeners) l.modal(inter.user_id, inter.id, data);
        resource = { type };
        break;
      default:
        log.warn(`interaction callback type ${type} not supported`);
    }
    if (type !== 9) for (const l of this.hub.listeners) l.interactionDone(inter.id);
    const withResponse = ctx.query.get("with_response") === "true";
    if (!withResponse) return noContent(ctx.res);
    sendJson(ctx.res, 200, {
      interaction: {
        id: inter.id,
        type: inter.type,
        activity_instance_id: null,
        response_message_id: resource?.message?.id ?? null,
        response_message_loading: type === 5,
        response_message_ephemeral: !!inter.ephemeral,
      },
      resource,
    });
  }

  autocompleteResults = new Map<string, Json[]>();

  private followup(ctx: Ctx) {
    const inter = this.store.interactionsByToken.get(ctx.params[1]);
    if (!inter) return discordError(ctx.res, 404, 10015, "Unknown Webhook");
    const json = ctx.body.json;
    // A followup on a deferred reply that never got edited replaces the "thinking" placeholder.
    const placeholder = inter.original_id ? this.store.findMessage(inter.channel_id, inter.original_id) : undefined;
    if (placeholder && (placeholder.flags & 128) !== 0) {
      this.hub.editMessage(placeholder, { ...json, flags: (json.flags ?? 0) | (placeholder.flags & 64) }, ctx.body.files);
      return sendJson(ctx.res, 200, stripPrivate(placeholder));
    }
    const atts = this.hub.resolveAttachments(json, ctx.body.files) ?? [];
    const msg = this.interactionMessage(inter, json, atts, inter.channel_id, true);
    this.hub.postMessage(msg);
    sendJson(ctx.res, 200, stripPrivate(msg));
  }
}

function syncReactions(msg: StoredMessage, botId: string) {
  msg.reactions = Object.entries(msg._reactors ?? {})
    .filter(([, users]) => (users as string[]).length)
    .map(([key, users]) => {
      const m = /^(\w+):(\d+)$/.exec(key);
      const u = users as string[];
      return {
        count: u.length,
        count_details: { burst: 0, normal: u.length },
        me: u.includes(botId),
        me_burst: false,
        burst_colors: [],
        emoji: m ? { id: m[2], name: m[1] } : { id: null, name: key },
      };
    });
}
