import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { snowflake } from "./ids.js";
import { imageSize, type UploadedFile } from "./http.js";
import type { Gateway } from "./gateway.js";
import type { Json, Store, StoredMessage } from "./store.js";

/** Anything that wants to hear about state changes (the browser client server). */
export type Listener = {
  messageCreate(msg: StoredMessage): void;
  messageUpdate(msg: StoredMessage): void;
  messageDelete(channelId: string, id: string, ephemeralFor?: string): void;
  channelUpsert(ch: Json): void;
  channelDelete(ch: Json): void;
  threadMembers(channelId: string): void;
  memberUpdate(userId: string): void;
  modal(userId: string, interactionId: string, modal: Json): void;
  interactionDone(interactionId: string, error?: string): void;
};

/**
 * Central place that mutates the store and fans changes out to both the bot (gateway dispatch)
 * and browsers (listeners), so the two views can never drift apart.
 */
export class Hub {
  listeners: Listener[] = [];

  constructor(public store: Store, public gateway: Gateway, private publicUrl: () => string) {}

  // ---- attachments ----

  saveAttachment(file: UploadedFile, meta: Json = {}): Json {
    const id = snowflake();
    const safe = (meta.filename ?? file.filename ?? "file").replace(/[^A-Za-z0-9._-]/g, "_");
    const dir = join(this.store.dataDir, "files", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, safe), file.data);
    const url = `${this.publicUrl()}/attachments/${id}/${encodeURIComponent(safe)}`;
    const att: Json = {
      id,
      filename: safe,
      size: file.data.length,
      url,
      proxy_url: url,
      content_type: file.contentType || guessType(safe),
    };
    const dims = imageSize(file.data);
    if (dims) Object.assign(att, dims);
    if (meta.description) att.description = meta.description;
    if (meta.spoiler || safe.startsWith("SPOILER_")) att.spoiler = true;
    return att;
  }

  /** Resolves payload attachments + uploaded files into Discord attachment objects. */
  resolveAttachments(json: Json, files: UploadedFile[], existing: Json[] = []): Json[] | undefined {
    const byIndex = new Map<string, UploadedFile>();
    files.forEach((f, i) => {
      const m = /^files\[(\d+)\]$/.exec(f.field);
      byIndex.set(m ? m[1] : String(i), f);
    });
    if (!json.attachments && !files.length) return undefined;
    const out: Json[] = [];
    const used = new Set<string>();
    for (const a of json.attachments ?? []) {
      const key = String(a.id);
      const upload = byIndex.get(key);
      if (upload && !existing.some((e) => e.id === key)) {
        used.add(key);
        out.push(this.saveAttachment(upload, a));
        continue;
      }
      const old = existing.find((e) => e.id === key);
      if (old) out.push(old);
    }
    for (const [key, f] of byIndex) if (!used.has(key)) out.push(this.saveAttachment(f));
    return out;
  }

  // ---- messages ----

  buildMessage(channelId: string, authorId: string, json: Json, attachments: Json[] = []): StoredMessage {
    const ch = this.store.channel(channelId);
    const id = snowflake();
    const content: string = json.content ?? "";
    const mentions = [...content.matchAll(/<@!?(\d+)>/g)]
      .map((m) => m[1])
      .filter((uid, i, a) => a.indexOf(uid) === i && this.store.state.users[uid])
      .map((uid) => ({ ...this.store.userJson(uid), member: this.store.memberJson(uid, false) }));
    const mentionRoles = [...content.matchAll(/<@&(\d+)>/g)].map((m) => m[1]);
    const msg: StoredMessage = {
      id,
      channel_id: channelId,
      author: this.store.userJson(authorId),
      content,
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions,
      mention_roles: mentionRoles,
      mention_channels: [],
      attachments,
      embeds: this.normalizeEmbeds(json.embeds ?? [], attachments),
      reactions: [],
      pinned: false,
      type: 0,
      flags: (json.flags ?? 0) & ~4096,
      components: json.components ?? [],
      sticker_items: [],
      poll: json.poll,
    };
    if (ch && ch.type !== 1) {
      msg.guild_id = this.store.state.guild_id;
      msg.member = this.store.memberJson(authorId, false);
    }
    if (json.message_reference?.message_id) {
      const ref = this.store.findMessage(json.message_reference.channel_id ?? channelId, json.message_reference.message_id);
      msg.type = 19;
      msg.message_reference = {
        type: 0,
        message_id: json.message_reference.message_id,
        channel_id: channelId,
        guild_id: this.store.state.guild_id,
      };
      msg.referenced_message = ref ? stripPrivate(ref) : null;
    }
    if (msg.poll) delete msg.poll;
    return msg;
  }

  normalizeEmbeds(embeds: Json[], attachments: Json[]): Json[] {
    const resolve = (url?: string) => {
      if (!url?.startsWith("attachment://")) return url;
      const name = url.slice("attachment://".length);
      return attachments.find((a) => a.filename === name)?.url ?? url;
    };
    return embeds.map((e) => {
      const out: Json = { type: "rich", ...e };
      if (e.image?.url) out.image = { ...e.image, url: resolve(e.image.url), proxy_url: resolve(e.image.url) };
      if (e.thumbnail?.url) out.thumbnail = { ...e.thumbnail, url: resolve(e.thumbnail.url) };
      if (e.color != null && typeof e.color !== "number") out.color = Number(e.color);
      return out;
    });
  }

  postMessage(msg: StoredMessage) {
    this.store.insertMessage(msg);
    if (!msg._ephemeral_for) this.gateway.dispatch("MESSAGE_CREATE", stripPrivate(msg));
    for (const l of this.listeners) l.messageCreate(msg);
    const ch = this.store.channel(msg.channel_id);
    if (ch?.thread_metadata?.archived) {
      ch.thread_metadata.archived = false;
      this.channelUpdate(ch);
    }
  }

  editMessage(msg: StoredMessage, json: Json, files: UploadedFile[]) {
    if ("content" in json) msg.content = json.content ?? "";
    if ("components" in json) msg.components = json.components ?? [];
    const atts = this.resolveAttachments(json, files, msg.attachments ?? []);
    if (atts) msg.attachments = atts;
    if ("embeds" in json) msg.embeds = this.normalizeEmbeds(json.embeds ?? [], msg.attachments ?? []);
    if ("flags" in json && json.flags != null) msg.flags = (json.flags & ~128) | (msg.flags & 64);
    else msg.flags = (msg.flags ?? 0) & ~128;
    msg.edited_timestamp = new Date().toISOString();
    this.store.scheduleSave();
    if (!msg._ephemeral_for) this.gateway.dispatch("MESSAGE_UPDATE", stripPrivate(msg));
    for (const l of this.listeners) l.messageUpdate(msg);
  }

  removeMessage(channelId: string, id: string) {
    const msg = this.store.findMessage(channelId, id);
    if (!msg) return false;
    this.store.deleteMessage(channelId, id);
    if (!msg._ephemeral_for)
      this.gateway.dispatch("MESSAGE_DELETE", { id, channel_id: channelId, guild_id: this.store.state.guild_id });
    for (const l of this.listeners) l.messageDelete(channelId, id, msg._ephemeral_for);
    return true;
  }

  touchMessage(msg: StoredMessage) {
    this.store.scheduleSave();
    for (const l of this.listeners) l.messageUpdate(msg);
  }

  // ---- channels ----

  channelCreate(ch: Json) {
    const isThread = [10, 11, 12].includes(ch.type);
    this.gateway.dispatch(isThread ? "THREAD_CREATE" : "CHANNEL_CREATE", isThread ? { ...ch, newly_created: true } : ch);
    for (const l of this.listeners) l.channelUpsert(ch);
  }

  channelUpdate(ch: Json) {
    const isThread = [10, 11, 12].includes(ch.type);
    this.store.scheduleSave();
    this.gateway.dispatch(isThread ? "THREAD_UPDATE" : "CHANNEL_UPDATE", ch);
    for (const l of this.listeners) l.channelUpsert(ch);
  }

  channelDelete(ch: Json) {
    const isThread = [10, 11, 12].includes(ch.type);
    delete this.store.state.channels[ch.id];
    delete this.store.state.messages[ch.id];
    delete this.store.state.thread_members[ch.id];
    this.store.scheduleSave();
    this.gateway.dispatch(
      isThread ? "THREAD_DELETE" : "CHANNEL_DELETE",
      isThread ? { id: ch.id, guild_id: ch.guild_id, parent_id: ch.parent_id, type: ch.type } : ch,
    );
    for (const l of this.listeners) l.channelDelete(ch);
    // Threads go with their parent channel.
    for (const child of Object.values(this.store.state.channels)) {
      if (child.parent_id === ch.id && [10, 11, 12].includes(child.type)) this.channelDelete(child);
    }
  }

  addThreadMember(threadId: string, userId: string) {
    const list = (this.store.state.thread_members[threadId] ??= []);
    if (list.includes(userId)) return;
    list.push(userId);
    const ch = this.store.channel(threadId);
    if (ch) ch.member_count = list.length;
    this.store.scheduleSave();
    this.gateway.dispatch("THREAD_MEMBERS_UPDATE", {
      id: threadId,
      guild_id: this.store.state.guild_id,
      member_count: list.length,
      added_members: [
        {
          id: threadId,
          user_id: userId,
          join_timestamp: new Date().toISOString(),
          flags: 0,
          member: this.store.memberJson(userId),
        },
      ],
    });
    for (const l of this.listeners) l.threadMembers(threadId);
  }

  removeThreadMember(threadId: string, userId: string) {
    const list = this.store.state.thread_members[threadId] ?? [];
    const i = list.indexOf(userId);
    if (i < 0) return;
    list.splice(i, 1);
    this.store.scheduleSave();
    this.gateway.dispatch("THREAD_MEMBERS_UPDATE", {
      id: threadId,
      guild_id: this.store.state.guild_id,
      member_count: list.length,
      removed_member_ids: [userId],
    });
    for (const l of this.listeners) l.threadMembers(threadId);
  }

  memberUpdate(userId: string) {
    this.store.scheduleSave();
    this.gateway.dispatch("GUILD_MEMBER_UPDATE", { guild_id: this.store.state.guild_id, ...this.store.memberJson(userId) });
    for (const l of this.listeners) l.memberUpdate(userId);
  }

  memberAdd(userId: string) {
    this.gateway.dispatch("GUILD_MEMBER_ADD", { guild_id: this.store.state.guild_id, ...this.store.memberJson(userId) });
    for (const l of this.listeners) l.memberUpdate(userId);
  }
}

/** Removes our private bookkeeping fields before a message leaves the shim. */
export function stripPrivate(msg: StoredMessage): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(msg)) if (!k.startsWith("_")) out[k] = v;
  return out;
}

function guessType(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      txt: "text/plain",
      json: "application/json",
      md: "text/markdown",
    }[ext ?? ""] ?? "application/octet-stream"
  );
}
