import type { WebSocket } from "ws";
import type { Json, Store } from "./store.js";
import { token } from "./ids.js";
import { log } from "./log.js";

/**
 * The bot's side of the Discord gateway. One bot, one shard, no compression.
 * Events are queued while the bot is disconnected and replayed on RESUME.
 */
export class Gateway {
  private ws: WebSocket | null = null;
  private seq = 0;
  private sessionId = token(16);
  private ready = false;
  private backlog: { t: string; d: Json }[] = [];
  private heartbeatMs = 41250;

  constructor(private store: Store, private publicWsUrl: () => string) {}

  get isReady() {
    return this.ready;
  }

  attach(ws: WebSocket) {
    if (this.ws) {
      try {
        this.ws.close(4000, "replaced");
      } catch {}
    }
    this.ws = ws;
    this.ready = false;
    this.send({ op: 10, d: { heartbeat_interval: this.heartbeatMs } });
    ws.on("message", (raw) => this.onMessage(ws, raw.toString()));
    ws.on("close", (code) => {
      if (this.ws === ws) {
        this.ws = null;
        this.ready = false;
        log.warn(`bot gateway closed (${code})`);
      }
    });
  }

  private send(payload: Json, ws = this.ws) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  dispatch(t: string, d: Json) {
    if (!this.ready) {
      this.backlog.push({ t, d });
      if (this.backlog.length > 5000) this.backlog.shift();
      return;
    }
    this.send({ op: 0, t, s: ++this.seq, d });
  }

  private onMessage(ws: WebSocket, raw: string) {
    let msg: Json;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.op) {
      case 1:
        this.send({ op: 11 }, ws);
        return;
      case 2:
        this.identify(ws);
        return;
      case 6:
        this.resume(ws, msg.d);
        return;
      case 8:
        this.requestMembers(ws, msg.d);
        return;
      case 3: // presence update
      case 4: // voice state
        return;
      default:
        log.debug(`gateway op ${msg.op} ignored`);
    }
  }

  private identify(ws: WebSocket) {
    const s = this.store.state;
    this.sessionId = token(16);
    this.seq = 0;
    this.backlog = [];
    const ready = {
      v: 10,
      user: { ...this.store.userJson(s.bot_id), verified: true, mfa_enabled: false, flags: 0, email: null },
      guilds: [{ id: s.guild_id, unavailable: true }],
      session_id: this.sessionId,
      resume_gateway_url: this.publicWsUrl(),
      shard: [0, 1],
      application: { id: s.bot_id, flags: 0 },
      private_channels: [],
      relationships: [],
      presences: [],
      guild_join_requests: [],
      geo_ordered_rtc_regions: [],
      user_settings: {},
      auth: {},
    };
    this.send({ op: 0, t: "READY", s: ++this.seq, d: ready }, ws);
    this.send({ op: 0, t: "GUILD_CREATE", s: ++this.seq, d: this.guildCreate() }, ws);
    this.ready = true;
    log.info("bot identified; guild sent");
  }

  private resume(ws: WebSocket, d: Json) {
    if (d.session_id !== this.sessionId) {
      this.send({ op: 9, d: false }, ws);
      return;
    }
    this.ready = true;
    for (const e of this.backlog.splice(0)) this.send({ op: 0, t: e.t, s: ++this.seq, d: e.d }, ws);
    this.send({ op: 0, t: "RESUMED", s: ++this.seq, d: {} }, ws);
  }

  private requestMembers(ws: WebSocket, d: Json) {
    const s = this.store.state;
    let ids: string[] = Object.keys(s.members);
    if (Array.isArray(d.user_ids)) ids = ids.filter((id) => d.user_ids.includes(id));
    else if (typeof d.user_ids === "string") ids = ids.filter((id) => id === d.user_ids);
    if (d.query) ids = ids.filter((id) => s.users[id]?.username.startsWith(String(d.query).toLowerCase()));
    if (d.limit) ids = ids.slice(0, d.limit);
    this.send(
      {
        op: 0,
        t: "GUILD_MEMBERS_CHUNK",
        s: ++this.seq,
        d: {
          guild_id: s.guild_id,
          members: ids.map((id) => this.store.memberJson(id)),
          chunk_index: 0,
          chunk_count: 1,
          not_found: [],
          nonce: d.nonce,
        },
      },
      ws,
    );
  }

  guildCreate(): Json {
    const s = this.store.state;
    const all = Object.values(s.channels).filter((c) => c.type !== 1);
    const channels = all.filter((c) => ![10, 11, 12].includes(c.type));
    const threads = all.filter((c) => [10, 11, 12].includes(c.type) && !c.thread_metadata?.archived);
    return {
      id: s.guild_id,
      name: "TI4 Online",
      icon: null,
      icon_hash: null,
      splash: null,
      discovery_splash: null,
      owner_id: s.bot_id,
      afk_channel_id: null,
      afk_timeout: 300,
      widget_enabled: false,
      verification_level: 0,
      default_message_notifications: 1,
      explicit_content_filter: 0,
      roles: Object.values(s.roles),
      emojis: [],
      stickers: [],
      soundboard_sounds: [],
      features: [],
      mfa_level: 0,
      application_id: null,
      system_channel_id: null,
      system_channel_flags: 0,
      rules_channel_id: null,
      max_members: 500000,
      vanity_url_code: null,
      description: null,
      banner: null,
      premium_tier: 0,
      premium_subscription_count: 0,
      preferred_locale: "en-US",
      public_updates_channel_id: null,
      nsfw_level: 0,
      premium_progress_bar_enabled: false,
      safety_alerts_channel_id: null,
      joined_at: new Date().toISOString(),
      large: false,
      unavailable: false,
      member_count: Object.keys(s.members).length,
      voice_states: [],
      members: Object.keys(s.members).map((id) => this.store.memberJson(id)),
      channels,
      threads: threads.map((t) => ({
        ...t,
        member: (s.thread_members[t.id] ?? []).includes(s.bot_id) || t.owner_id === s.bot_id
          ? { id: t.id, user_id: s.bot_id, join_timestamp: t.thread_metadata?.create_timestamp, flags: 0 }
          : undefined,
      })),
      presences: [],
      stage_instances: [],
      guild_scheduled_events: [],
    };
  }
}
