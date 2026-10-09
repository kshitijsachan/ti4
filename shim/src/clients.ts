import type { WebSocket } from "ws";
import { stripPrivate, type Hub, type Listener } from "./hub.js";
import { PERMS_ALL, type Json, type StoredMessage } from "./store.js";
import { log } from "./log.js";

type Client = { ws: WebSocket; userId: string };

/**
 * Browser-facing realtime API. Each socket is one player (identified by their seat token).
 * Server -> client frames: {t, ...}. Client -> server frames: {op, nonce?, ...}.
 */
export class Clients implements Listener {
  private clients = new Set<Client>();
  private pendingInteractions = new Map<string, { client: Client; nonce?: string; timer: NodeJS.Timeout }>();

  constructor(private hub: Hub) {
    hub.listeners.push(this);
  }

  private get store() {
    return this.hub.store;
  }

  userForToken(tok: string | null): string | null {
    if (!tok) return null;
    return this.store.state.seats[tok]?.user_id ?? null;
  }

  attach(ws: WebSocket, userId: string) {
    const client: Client = { ws, userId };
    this.clients.add(client);
    ws.on("close", () => this.clients.delete(client));
    ws.on("message", (raw) => {
      let msg: Json;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        this.onMessage(client, msg);
      } catch (e) {
        log.error(`client op ${msg.op} failed: ${(e as Error).stack}`);
        this.send(client, { t: "error", nonce: msg.nonce, error: String(e) });
      }
    });
    this.send(client, this.hello(userId));
  }

  private send(c: Client, payload: Json) {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(payload));
  }

  private hello(userId: string): Json {
    const s = this.store.state;
    return {
      t: "hello",
      me: this.store.userJson(userId),
      bot_id: s.bot_id,
      guild_id: s.guild_id,
      users: Object.values(s.users).map((u) => ({ ...this.store.userJson(u.id), roles: s.members[u.id]?.roles ?? [] })),
      roles: Object.values(s.roles),
      channels: Object.values(s.channels)
        .filter((c) => this.store.canView(userId, c.id))
        .map((c) => this.channelView(c)),
      commands: Object.values(s.commands),
      bot_online: this.hub.gateway.isReady,
    };
  }

  private channelView(c: Json): Json {
    return { ...c, thread_members: this.store.state.thread_members[c.id] };
  }

  private messageVisible(userId: string, msg: StoredMessage) {
    if (msg._ephemeral_for && msg._ephemeral_for !== userId) return false;
    return this.store.canView(userId, msg.channel_id);
  }

  // ---- Listener ----

  messageCreate(msg: StoredMessage) {
    for (const c of this.clients) if (this.messageVisible(c.userId, msg)) this.send(c, { t: "message_create", message: view(msg) });
  }

  messageUpdate(msg: StoredMessage) {
    for (const c of this.clients) if (this.messageVisible(c.userId, msg)) this.send(c, { t: "message_update", message: view(msg) });
  }

  messageDelete(channelId: string, id: string, ephemeralFor?: string) {
    for (const c of this.clients) {
      if (ephemeralFor && ephemeralFor !== c.userId) continue;
      if (this.store.canView(c.userId, channelId) || ephemeralFor) this.send(c, { t: "message_delete", channel_id: channelId, id });
    }
  }

  channelUpsert(ch: Json) {
    for (const c of this.clients) {
      if (this.store.canView(c.userId, ch.id)) this.send(c, { t: "channel_upsert", channel: this.channelView(ch) });
      else this.send(c, { t: "channel_delete", id: ch.id });
    }
  }

  channelDelete(ch: Json) {
    for (const c of this.clients) this.send(c, { t: "channel_delete", id: ch.id });
  }

  threadMembers(channelId: string) {
    const ch = this.store.channel(channelId);
    if (ch) this.channelUpsert(ch);
  }

  memberUpdate(userId: string) {
    const s = this.store.state;
    const user = { ...this.store.userJson(userId), roles: s.members[userId]?.roles ?? [] };
    for (const c of this.clients) {
      this.send(c, { t: "user_upsert", user });
      // Role changes alter channel visibility: resend the visible channel set.
      if (c.userId === userId) this.send(c, { t: "channels", channels: Object.values(s.channels).filter((ch) => this.store.canView(userId, ch.id)).map((ch) => this.channelView(ch)) });
    }
  }

  modal(userId: string, interactionId: string, modal: Json) {
    const pending = this.pendingInteractions.get(interactionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingInteractions.delete(interactionId);
    }
    for (const c of this.clients) {
      if (c.userId !== userId) continue;
      if (pending && pending.client !== c) continue;
      this.send(c, { t: "modal", interaction_id: interactionId, nonce: pending?.nonce, modal });
    }
  }

  interactionDone(interactionId: string, error?: string) {
    const pending = this.pendingInteractions.get(interactionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingInteractions.delete(interactionId);
    this.send(pending.client, { t: "interaction_done", nonce: pending.nonce, error });
  }

  // ---- client ops ----

  private onMessage(c: Client, msg: Json) {
    switch (msg.op) {
      case "history":
        return this.history(c, msg);
      case "click":
        return this.component(c, msg, 2);
      case "select":
        return this.component(c, msg, msg.component_type ?? 3);
      case "modal_submit":
        return this.modalSubmit(c, msg);
      case "send":
        return this.chat(c, msg);
      case "command":
        return this.command(c, msg);
      case "autocomplete":
        return this.autocomplete(c, msg);
      case "dismiss":
        return this.dismiss(c, msg);
      case "ping":
        return this.send(c, { t: "pong", nonce: msg.nonce });
      default:
        this.send(c, { t: "error", nonce: msg.nonce, error: `unknown op ${msg.op}` });
    }
  }

  private history(c: Client, msg: Json) {
    if (!this.store.canView(c.userId, msg.channel_id)) {
      return this.send(c, { t: "history", channel_id: msg.channel_id, messages: [], has_more: false, nonce: msg.nonce });
    }
    const limit = Math.min(200, msg.limit ?? 100);
    const all = this.store.messages(msg.channel_id).filter((m) => this.messageVisible(c.userId, m));
    const pool = msg.before ? all.filter((m) => BigInt(m.id) < BigInt(msg.before)) : all;
    const page = pool.slice(-limit);
    this.send(c, {
      t: "history",
      nonce: msg.nonce,
      channel_id: msg.channel_id,
      messages: page.map(view),
      has_more: pool.length > page.length,
    });
  }

  private dismiss(c: Client, msg: Json) {
    const m = this.store.findMessage(msg.channel_id, msg.message_id);
    if (m && m._ephemeral_for === c.userId) this.hub.removeMessage(m.channel_id, m.id);
  }

  private basePayload(c: Client, channelId: string): Json {
    const s = this.store.state;
    const ch = this.store.channel(channelId)!;
    const payload: Json = {
      application_id: s.bot_id,
      channel_id: channelId,
      channel: ch,
      version: 1,
      app_permissions: PERMS_ALL,
      locale: "en-US",
      entitlements: [],
      authorizing_integration_owners: { "0": s.guild_id },
      attachment_size_limit: 26214400,
    };
    if (ch.type === 1) {
      payload.user = this.store.userJson(c.userId);
      payload.context = 1;
    } else {
      payload.guild_id = s.guild_id;
      payload.guild = { id: s.guild_id, locale: "en-US", features: [] };
      payload.guild_locale = "en-US";
      payload.member = { ...this.store.memberJson(c.userId), permissions: this.permissionsFor(c.userId) };
      payload.context = 0;
    }
    return payload;
  }

  private permissionsFor(userId: string): string {
    const s = this.store.state;
    let p = BigInt(s.roles[s.guild_id]?.permissions ?? 0);
    for (const r of s.members[userId]?.roles ?? []) p |= BigInt(s.roles[r]?.permissions ?? 0);
    return p.toString();
  }

  private dispatchInteraction(c: Client, nonce: string | undefined, type: number, channelId: string, data: Json, message?: StoredMessage) {
    if (!this.store.canView(c.userId, channelId)) {
      return this.send(c, { t: "interaction_done", nonce, error: "You cannot use that channel." });
    }
    if (!this.hub.gateway.isReady) {
      return this.send(c, { t: "interaction_done", nonce, error: "The game server is starting up. Try again in a moment." });
    }
    const inter = this.store.newInteraction({
      type,
      user_id: c.userId,
      channel_id: channelId,
      message_id: message?.id,
      command_name: type === 2 ? data.name : undefined,
    });
    const payload: Json = { ...this.basePayload(c, channelId), id: inter.id, token: inter.token, type, data };
    if (message) payload.message = stripPrivate(message);
    const timer = setTimeout(() => {
      this.pendingInteractions.delete(inter.id);
      if (!inter.acked) this.send(c, { t: "interaction_done", nonce, error: "The bot did not respond to that action." });
    }, 15000);
    this.pendingInteractions.set(inter.id, { client: c, nonce, timer });
    this.hub.gateway.dispatch("INTERACTION_CREATE", payload);
  }

  private component(c: Client, msg: Json, componentType: number) {
    const m = this.store.findMessage(msg.channel_id, msg.message_id);
    if (!m || !this.messageVisible(c.userId, m)) {
      return this.send(c, { t: "interaction_done", nonce: msg.nonce, error: "That message no longer exists." });
    }
    const data: Json = { custom_id: msg.custom_id, component_type: componentType };
    if (componentType !== 2) {
      data.values = msg.values ?? [];
      if (componentType === 5 || componentType === 7) {
        data.resolved = this.resolveUsers(data.values);
      }
    }
    this.dispatchInteraction(c, msg.nonce, 3, m.channel_id, data, m);
  }

  private modalSubmit(c: Client, msg: Json) {
    // The modal belongs to the interaction that opened it; its channel/message carry over.
    const origin = this.store.interactions.get(msg.interaction_id);
    const channelId = origin?.channel_id ?? msg.channel_id;
    const message = origin?.message_id ? this.store.findMessage(channelId, origin.message_id) : undefined;
    const data = { custom_id: msg.custom_id, components: msg.components };
    this.dispatchInteraction(c, msg.nonce, 5, channelId, data, message);
  }

  private chat(c: Client, msg: Json) {
    if (!this.store.canView(c.userId, msg.channel_id)) return;
    const json: Json = { content: String(msg.content ?? "").slice(0, 4000) };
    if (msg.reply_to) json.message_reference = { message_id: msg.reply_to, channel_id: msg.channel_id };
    const m = this.hub.buildMessage(msg.channel_id, c.userId, json);
    this.hub.postMessage(m);
    this.send(c, { t: "interaction_done", nonce: msg.nonce });
  }

  private command(c: Client, msg: Json) {
    const cmd = Object.values(this.store.state.commands).find((x) => x.name === msg.name && (x.type ?? 1) === 1);
    if (!cmd) return this.send(c, { t: "interaction_done", nonce: msg.nonce, error: `Unknown command /${msg.name}` });
    const options: Json[] = msg.options ?? [];
    const userIds: string[] = [];
    const walk = (opts: Json[]) => {
      for (const o of opts) {
        if (o.type === 6 || o.type === 9) userIds.push(String(o.value));
        if (o.options) walk(o.options);
      }
    };
    walk(options);
    const data: Json = { id: cmd.id, name: cmd.name, type: 1, options, guild_id: this.store.state.guild_id };
    if (userIds.length) data.resolved = this.resolveUsers(userIds);
    this.dispatchInteraction(c, msg.nonce, 2, msg.channel_id, data);
  }

  private autocomplete(c: Client, msg: Json) {
    const cmd = Object.values(this.store.state.commands).find((x) => x.name === msg.name);
    if (!cmd || !this.hub.gateway.isReady) return this.send(c, { t: "autocomplete", nonce: msg.nonce, choices: [] });
    const inter = this.store.newInteraction({ type: 4, user_id: c.userId, channel_id: msg.channel_id });
    const payload = {
      ...this.basePayload(c, msg.channel_id),
      id: inter.id,
      token: inter.token,
      type: 4,
      data: { id: cmd.id, name: cmd.name, type: 1, options: msg.options ?? [], guild_id: this.store.state.guild_id },
    };
    this.hub.gateway.dispatch("INTERACTION_CREATE", payload);
    const started = Date.now();
    const poll = setInterval(() => {
      const rest = (this.hub as any).rest;
      const choices = rest?.autocompleteResults.get(inter.id);
      if (choices || Date.now() - started > 3000) {
        clearInterval(poll);
        rest?.autocompleteResults.delete(inter.id);
        this.send(c, { t: "autocomplete", nonce: msg.nonce, choices: choices ?? [] });
      }
    }, 25);
  }

  private resolveUsers(ids: string[]): Json {
    const users: Json = {};
    const members: Json = {};
    for (const id of ids) {
      if (!this.store.state.users[id]) continue;
      users[id] = this.store.userJson(id);
      const m = this.store.memberJson(id, false);
      members[id] = { ...m, permissions: this.permissionsFor(id) };
    }
    return { users, members };
  }
}

/** What a browser sees of a message: wire format plus whether it is only visible to them. */
function view(msg: StoredMessage): Json {
  const out = stripPrivate(msg);
  if (msg._ephemeral_for) out.ephemeral = true;
  return out;
}
