import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { snowflake } from "./ids.js";
import { imageSize, type UploadedFile } from "./http.js";
import type { Gateway } from "./gateway.js";
import type { Json, Store, StoredMessage } from "./store.js";
import { log } from "./log.js";

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

  /** Copies messages in the bot's log channels (and their stack-trace threads) to the shim log; caps history. */
  private mirrorBotLog(msg: StoredMessage) {
    const ch = this.store.channel(msg.channel_id);
    if (!ch) return;
    const parent = ch.parent_id ? this.store.channel(ch.parent_id) : undefined;
    const isLog = (c?: Json) => !!c && typeof c.name === "string" && c.name.startsWith("bot-log");
    if (!isLog(ch) && !isLog(parent)) return;
    const text = String(msg.content ?? "");
    if (isLog(parent) || /ERROR|WARNING|CRITICAL|Exception/.test(text)) log.warn(`[bot-log${isLog(parent) ? "/" + ch.name : ""}] ${text.slice(0, 6000)}`);
    const list = this.store.messages(ch.id);
    if (list.length > 1000) list.splice(0, list.length - 1000);
  }

  buildMessage(channelId: string, authorId: string, json: Json, attachments: Json[] = []): StoredMessage {
    json = localizeArt(json, this.publicUrl());
    const ch = this.store.channel(channelId);
    const id = snowflake();
    const content: string = json.content ?? "";
    const { mentions, mentionRoles } = this.computeMentions(content, json.components ?? []);
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
      components: normalizeComponents(json.components ?? []),
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
    this.unfurl(msg);
    return msg;
  }

  /**
   * Discord's link unfurling, for direct image links only (the bot posts strategy-card art this way): adds an
   * `image` embed per image URL in the content unless the URL is <wrapped> or SUPPRESS_EMBEDS (1<<2) is set.
   */
  unfurl(msg: StoredMessage) {
    const previous: string[] = msg._unfurled ?? [];
    let embeds: Json[] = (msg.embeds ?? []).filter((e: Json) => !(e.type === "image" && previous.includes(e.url)));
    const urls: string[] = [];
    if (!((msg.flags ?? 0) & 4)) {
      for (const m of String(msg.content ?? "").matchAll(/(<)?(https?:\/\/[^\s<>]+?\.(?:png|jpe?g|gif|webp))(?:\?[^\s<>]*)?(>)?(?=\s|$)/gi)) {
        if (m[1] && m[3]) continue;
        const url = m[0].replace(/^<|>$/g, "");
        if (!urls.includes(url)) urls.push(url);
      }
    }
    embeds = embeds.concat(urls.map((url) => ({ type: "image", url, thumbnail: { url, proxy_url: url, flags: 0 }, content_scan_version: 0 })));
    msg.embeds = embeds;
    if (urls.length) msg._unfurled = urls;
    else delete msg._unfurled;
  }

  computeMentions(content: string, components: Json[]) {
    const mentionText = [content, ...textDisplays(components)].join("\n");
    const mentions = [...mentionText.matchAll(/<@!?(\d+)>/g)]
      .map((m) => m[1])
      .filter((uid, i, a) => a.indexOf(uid) === i && this.store.state.users[uid])
      .map((uid) => ({ ...this.store.userJson(uid), member: this.store.memberJson(uid, false) }));
    const mentionRoles = [...new Set([...mentionText.matchAll(/<@&(\d+)>/g)].map((m) => m[1]))];
    return { mentions, mentionRoles };
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

  /**
   * Discord adds users to a thread when a message there mentions them (directly or via a role) and they can see
   * the parent channel. The bot relies on this to give players their private `Cards Info` threads.
   */
  autoJoinMentioned(msg: StoredMessage) {
    const ch = this.store.channel(msg.channel_id);
    if (!ch || ![10, 11, 12].includes(ch.type) || msg._ephemeral_for) return;
    const ids = new Set<string>((msg.mentions ?? []).map((u: Json) => u.id));
    for (const roleId of msg.mention_roles ?? []) {
      for (const m of Object.values(this.store.state.members)) if (m.roles.includes(roleId)) ids.add(m.user_id);
    }
    for (const id of ids) {
      if (this.store.state.users[id]?.bot) continue;
      if (ch.parent_id && !this.store.canView(id, ch.parent_id)) continue;
      this.addThreadMember(ch.id, id);
    }
  }

  postMessage(msg: StoredMessage) {
    this.autoJoinMentioned(msg);
    this.store.insertMessage(msg);
    this.mirrorBotLog(msg);
    if (!msg._ephemeral_for) this.gateway.dispatch("MESSAGE_CREATE", stripPrivate(msg));
    for (const l of this.listeners) l.messageCreate(msg);
    const ch = this.store.channel(msg.channel_id);
    if (ch?.thread_metadata?.archived) {
      ch.thread_metadata.archived = false;
      this.channelUpdate(ch);
    }
  }

  editMessage(msg: StoredMessage, json: Json, files: UploadedFile[]) {
    json = localizeArt(json, this.publicUrl());
    if ("content" in json) msg.content = json.content ?? "";
    if ("components" in json) msg.components = normalizeComponents(json.components ?? []);
    const atts = this.resolveAttachments(json, files, msg.attachments ?? []);
    if (atts) msg.attachments = atts;
    if ("embeds" in json) msg.embeds = this.normalizeEmbeds(json.embeds ?? [], msg.attachments ?? []);
    if ("flags" in json && json.flags != null) msg.flags = (json.flags & ~128) | (msg.flags & 64);
    else msg.flags = (msg.flags ?? 0) & ~128;
    if ("content" in json || "components" in json) {
      const { mentions, mentionRoles } = this.computeMentions(msg.content ?? "", msg.components ?? []);
      msg.mentions = mentions;
      msg.mention_roles = mentionRoles;
    }
    if ("content" in json || "embeds" in json || "flags" in json) this.unfurl(msg);
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

/**
 * Discord assigns every component a numeric `id` (unique within the message) when the sender omits it.
 */
export function normalizeComponents(comps: Json[]): Json[] {
  let next = 1;
  const used = new Set<number>();
  const walk = (list: Json[], fn: (c: Json) => void) => {
    for (const c of list ?? []) {
      if (!c || typeof c !== "object") continue;
      fn(c);
      if (Array.isArray(c.components)) walk(c.components, fn);
      if (c.accessory) walk([c.accessory], fn);
      if (c.component) walk([c.component], fn);
    }
  };
  walk(comps, (c) => typeof c.id === "number" && used.add(c.id));
  walk(comps, (c) => {
    if (typeof c.id === "number") return;
    while (used.has(next)) next++;
    c.id = next;
    used.add(next);
  });
  return comps;
}

/** Text of every components-v2 Text Display (type 10) in a component tree. */
export function textDisplays(comps: Json[], out: string[] = []): string[] {
  for (const c of comps ?? []) {
    if (c.type === 10 && typeof c.content === "string") out.push(c.content);
    if (c.components) textDisplays(c.components, out);
    if (c.accessory) textDisplays([c.accessory], out);
  }
  return out;
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

/** Upstream art CDNs the bot links to; we serve the same files from /art (see index.ts). */
const ART_CDN = /https?:\/\/(?:cdn\.statically\.io\/gh|raw\.githubusercontent\.com|cdn\.jsdelivr\.net\/gh)\/AsyncTI4\/TI4_map_generator_bot\/[^/]+\/src\/main\/resources\/([^\s)"'<>?#]*)(?:\?raw=true)?/gi;

/** Rewrites links to AsyncTI4's art CDNs (e.g. strategy card images) to our own /art route. */
export function localizeArt<T>(value: T, publicUrl: string): T {
  if (typeof value === "string") return value.replace(ART_CDN, (_m, path: string) => `${publicUrl}/art/${path}`) as T;
  if (Array.isArray(value)) return value.map((v) => localizeArt(v, publicUrl)) as T;
  if (value && typeof value === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) out[k] = localizeArt(v, publicUrl);
    return out as T;
  }
  return value;
}
