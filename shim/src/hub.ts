import { join } from "node:path";
import { snowflake } from "./ids.js";
import { imageSize, type UploadedFile } from "./http.js";
import type { Gateway } from "./gateway.js";
import type { Interaction, Json, Store, StoredMessage } from "./store.js";
import { log } from "./log.js";
import { Retention } from "./retention.js";
import { newRole } from "./store.js";

/** Discord's VIEW_CHANNEL permission bit. */
const VIEW_CHANNEL = 1024n;

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
  /** Attachment retention: superseded renders and ended games' files go (retention.ts). */
  readonly retention: Retention;

  constructor(public store: Store, public gateway: Gateway, private publicUrl: () => string) {
    this.retention = new Retention(() => this.store.state, this.store.dataDir, undefined, (id) => this.store.peekMessages(id));
  }

  // ---- attachments ----

  saveAttachment(file: UploadedFile, meta: Json = {}): Json {
    const id = snowflake();
    const safe = (meta.filename ?? file.filename ?? "file").replace(/[^A-Za-z0-9._-]/g, "_");
    const dir = join(this.store.dataDir, "files", id);
    this.retention.write(dir, safe, file.data);
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
    if (ch.name === "slash-command-log" || ch.name === "button-log") {
      this.store.trimMessages(ch.id, 1000);
      return;
    }
    if (!isLog(ch) && !isLog(parent)) return;
    const text = String(msg.content ?? "");
    if (isLog(parent) || /ERROR|WARNING|CRITICAL|Exception/.test(text)) log.warn(`[bot-log${isLog(parent) ? "/" + ch.name : ""}] ${text.slice(0, 6000)}`);
    this.store.trimMessages(ch.id, 1000);
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

  /**
   * The bot answers most button presses with plain channel posts rather than interaction replies, so a
   * browser cannot tell whose prompt "choose a system to activate" is. The bot works through one game's
   * presses in order, so a post belongs to the newest press made in this channel (or its parent / threads)
   * in the last few seconds.
   */
  /** The newest press in this channel (or its parent / threads) within the last few seconds. */
  private recentPress(msg: StoredMessage): Interaction | undefined {
    const ch = this.store.channel(msg.channel_id);
    /* A thread's parent is its channel; a channel's parent is a category shared by other games: not related. */
    const related = new Set([msg.channel_id, ch && [10, 11, 12].includes(ch.type) ? ch.parent_id : undefined].filter(Boolean));
    const now = Date.now();
    let newest: Interaction | undefined;
    for (const inter of this.store.interactions.values()) {
      if (inter.type === 4 || now - inter.created > PROMPT_WINDOW_MS) continue;
      const ich = this.store.channel(inter.channel_id);
      if (!related.has(inter.channel_id) && !related.has(ich?.parent_id) && ich?.parent_id !== msg.channel_id) continue;
      if (!newest || inter.created >= newest.created) newest = inter;
    }
    return newest;
  }

  private attributePrompt(msg: StoredMessage) {
    if (msg._ephemeral_for || msg.interaction_metadata || !this.store.state.users[msg.author?.id]?.bot) return;
    const press = this.recentPress(msg);
    if (press) msg._prompted_for = press.user_id;
  }

  postMessage(msg: StoredMessage) {
    this.attributePrompt(msg);
    this.autoJoinMentioned(msg);
    this.store.insertMessage(msg);
    this.mirrorBotLog(msg);
    if (msg.attachments?.length) this.retention.onPost(msg);
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
    if (atts) {
      const before: Json[] = msg.attachments ?? [];
      msg.attachments = atts;
      this.retention.onEdit(before, atts);
      if (atts.length) this.retention.onPost(msg);
    }
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
    this.store.scheduleSave(msg.channel_id, msg.id);
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
    this.store.scheduleSave(msg.channel_id, msg.id);
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
    this.store.scheduleSave(ch.id);
    this.gateway.dispatch(isThread ? "THREAD_UPDATE" : "CHANNEL_UPDATE", ch);
    for (const l of this.listeners) l.channelUpsert(ch);
  }

  /** Tells the bot a channel's current state again (no change for players). */
  channelEcho(ch: Json) {
    const isThread = [10, 11, 12].includes(ch.type);
    this.gateway.dispatch(isThread ? "THREAD_UPDATE" : "CHANNEL_UPDATE", ch);
  }

  /**
   * An ended game's channel moved into the archive category: gone for the bot (CHANNEL_DELETE, out of the guild's
   * channel count, so new games still find room under the 500-channel limit) but kept with its messages for the web
   * (game log, history). Re-archiving is a no-op.
   */
  archiveChannel(ch: Json) {
    if (ch._archived || [10, 11, 12].includes(ch.type) || ch.type === 4) return;
    ch._archived = true;
    this.store.scheduleSave(ch.id);
    this.gateway.dispatch("CHANNEL_DELETE", ch);
  }

  /** The category ended games' channels go to (EndGameService moves them into "The in-limbo PBD Archive"). */
  static readonly ARCHIVE_CATEGORY = "The in-limbo PBD Archive";

  /**
   * A game's category ("PBD #a-b") or text channel (pbd123-..., fow12-... under such a category) is never visible to
   * @everyone: the bot's channels copy their category's overrides, and a category created without the deny (the
   * bot's rewind un-end, live 20:09:01 "PBD #2150-2159") made the next game in it (pbd2159, a "Play solo" game) visible
   * to every human and all 190 autopilot seats, who then played in it. Adds the deny when missing (warns: the creator
   * has a bug). Returns whether it did.
   */
  denyEveryoneOnGameChannel(ch: Json): boolean {
    const channels = this.store.state.channels;
    const everyone = this.store.state.guild_id;
    const isGameCategory = ch.type === 4 && /^PBD #\d+-\d+/.test(String(ch.name ?? ""));
    const parent = ch.parent_id ? channels[ch.parent_id] : undefined;
    const isGameChannel =
      ch.type === 0 && /^[a-z]+\d+-/i.test(String(ch.name ?? "")) && parent?.type === 4 && /^PBD #\d+-\d+/.test(String(parent.name ?? ""));
    if (!isGameCategory && !isGameChannel) return false;
    const ows: Json[] = (ch.permission_overwrites ??= []);
    const own = ows.find((o) => o.id === everyone);
    if (own && (BigInt(own.deny ?? 0) & VIEW_CHANNEL) === VIEW_CHANNEL) return false;
    if (own) {
      own.deny = String(BigInt(own.deny ?? 0) | VIEW_CHANNEL);
      own.allow = String(BigInt(own.allow ?? 0) & ~VIEW_CHANNEL);
    } else ows.push({ id: everyone, type: 0, allow: "0", deny: String(VIEW_CHANNEL) });
    log.warn(`game channel ${ch.name} (${ch.id}) was created visible to @everyone: denied`);
    return true;
  }

  /** The archive category, created when missing (so game end moves channels there instead of leaving them). */
  ensureArchiveCategory(): Json {
    const found = Object.values(this.store.state.channels).find((c) => c.type === 4 && c.name === Hub.ARCHIVE_CATEGORY);
    if (found) return found;
    const cat = this.store.createChannel({ type: 4, name: Hub.ARCHIVE_CATEGORY, position: 9999 });
    this.channelCreate(cat);
    return cat;
  }

  /**
   * Startup / periodic sweep, by the bot's web-data phase now: an ended game's channels (phase "finished") still
   * outside the archive category are moved there and archived; an archived game whose phase is no longer "finished"
   * (a rewind past its End Game) gets its channels back (unarchiveGameChannels), so the sweep never re-archives a
   * game that is live again. Non-game channels in the archive category are archived. Keeps the guild under
   * Discord's 500-channel limit for good (live 10:05: "481 / 500 channels", no new game could be created).
   * Returns the channels archived and restored, and how many games the bot could not answer for (down, restarting,
   * 5xx: the caller retries the sweep until that is 0).
   */
  async sweepEndedGames(botApi: string): Promise<{ archived: number; restored: number; unreachable: number }> {
    const cat = this.ensureArchiveCategory();
    let n = 0;
    let restored = 0;
    let unreachable = 0;
    const games = new Map<string, Json[]>();
    for (const ch of Object.values(this.store.state.channels)) {
      if ([1, 4, 10, 11, 12].includes(ch.type)) continue;
      const m = /^(pbd\d+)-/i.exec(String(ch.name ?? ""));
      if (m) {
        const g = m[1].toLowerCase();
        (games.get(g) ?? games.set(g, []).get(g)!).push(ch);
      } else if (!ch._archived && ch.parent_id === cat.id) {
        this.archiveChannel(ch);
        n++;
      }
    }
    for (const [game, chans] of games) {
      try {
        const res = await fetch(`${botApi}/api/public/game/${encodeURIComponent(game)}/web-data`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
          if (res.status >= 500) unreachable++;
          continue;
        }
        const data = (await res.json()) as Json;
        const phase = data?.gameState?.phase;
        if (!phase) continue;
        if (phase !== "finished") {
          if (chans.some((c) => c._archived || c.parent_id === cat.id)) {
            restored += this.unarchiveGameChannels(game, chans);
            this.restoreGameRole(game, chans, playerIdsOf(data));
            await this.resumeRestoredGame(botApi, game, chans);
          }
          continue;
        }
        this.parkGameRole(game, chans);
        for (const ch of chans) {
          if (ch._archived) continue;
          if (ch.parent_id !== cat.id) {
            ch._archive_parent = ch.parent_id ?? null;
            ch.parent_id = cat.id;
            this.store.invalidateViews();
            this.channelUpdate(ch);
          }
          this.archiveChannel(ch);
          n++;
        }
      } catch {
        unreachable++; // the bot is busy or restarting: the caller sweeps again
      }
    }
    return { archived: n, restored, unreachable };
  }

  /**
   * A finished game's role leaves the guild with its channels: the bot's End Game deletes it, but not every way a game
   * ends does (a fork of an ended game, End Game with the role delete refused), and leftover roles kept the bot's
   * Discord role budget full (live 2026-10-13: 241 roles, "a new category requires space for 10 roles", no new game).
   * The role is parked on the game's channels (id, fields, holders) so a rewind that un-ends the game brings the same
   * role back (restoreGameRole). Returns how many roles were parked.
   */
  parkGameRole(game: string, chans: Json[]): number {
    const s = this.store.state;
    const roles = Object.values(s.roles).filter((r) => String(r.name).toLowerCase() === game.toLowerCase());
    const keeper = chans.find((c) => c.type === 0 && /-actions$/i.test(String(c.name ?? ""))) ?? chans[0];
    if (!roles.length || !keeper) return 0;
    const parked: Json[] = (keeper._parked_roles ??= []);
    for (const r of roles) {
      const holders = Object.values(s.members)
        .filter((m) => m.roles.includes(r.id))
        .map((m) => m.user_id);
      parked.push({ role: { ...r }, holders });
      delete s.roles[r.id];
      for (const m of Object.values(s.members)) m.roles = m.roles.filter((x: string) => x !== r.id);
      this.gateway.dispatch("GUILD_ROLE_DELETE", { guild_id: s.guild_id, role_id: r.id });
    }
    this.store.scheduleSave(keeper.id);
    this.store.scheduleSave();
    return roles.length;
  }

  /**
   * The reverse of parkGameRole for a game a rewind un-ended: its parked role comes back with the same id (the
   * channels' permission overwrites name it) and holders. A game whose role the bot's End Game deleted gets a new one
   * for its players (playerIds, from the bot's web-data), so pings and the bot's role lookups work again. No-op when a
   * role with the game's name exists. Returns whether a role was restored or created.
   */
  restoreGameRole(game: string, chans: Json[], playerIds: string[] = []): boolean {
    const s = this.store.state;
    const keepers = chans.filter((c) => Array.isArray(c._parked_roles) && c._parked_roles.length);
    const parked: Json[] = keepers.flatMap((c) => c._parked_roles);
    for (const c of keepers) {
      delete c._parked_roles;
      this.store.scheduleSave(c.id);
    }
    if (Object.values(s.roles).some((r) => String(r.name).toLowerCase() === game.toLowerCase())) return false;
    let role: Json;
    let holders: string[];
    if (parked.length) {
      role = parked[0].role;
      holders = parked[0].holders ?? [];
      if (s.roles[role.id]) return false;
    } else {
      role = newRole({ name: game, mentionable: true }, Object.keys(s.roles).length);
      holders = playerIds;
    }
    s.roles[role.id] = role;
    this.gateway.dispatch("GUILD_ROLE_CREATE", { guild_id: s.guild_id, role });
    for (const id of holders) {
      const m = s.members[id];
      if (!m || m.roles.includes(role.id)) continue;
      m.roles.push(role.id);
      this.memberUpdate(id);
    }
    this.store.scheduleSave();
    return true;
  }

  /** Whether a channel is parented to the archive category. */
  private inArchiveCategory(ch: Json): boolean {
    const parent = ch.parent_id ? this.store.state.channels[ch.parent_id] : undefined;
    return !!parent && parent.type === 4 && parent.name === Hub.ARCHIVE_CATEGORY;
  }

  /** Archives a channel now parented to the archive category (after a move). */
  archiveIfMoved(ch: Json, previousParent?: string | null) {
    if (!this.inArchiveCategory(ch)) return;
    if (previousParent !== undefined && previousParent !== ch.parent_id) ch._archive_parent = previousParent;
    this.archiveChannel(ch);
  }

  /**
   * The reverse of archiveChannel: the channel is back for the bot (CHANNEL_CREATE, then THREAD_CREATE for its
   * open threads, which the bot's cache dropped with the channel). For a game un-ended by a rewind.
   */
  restoreChannel(ch: Json) {
    if (!ch._archived) return;
    delete ch._archived;
    delete ch._archive_parent;
    this.store.invalidateViews();
    this.store.scheduleSave(ch.id);
    this.gateway.dispatch("CHANNEL_CREATE", ch);
    for (const l of this.listeners) l.channelUpsert(ch);
    for (const t of Object.values(this.store.state.channels)) {
      if (t.parent_id === ch.id && [10, 11, 12].includes(t.type) && !t.thread_metadata?.archived)
        this.gateway.dispatch("THREAD_CREATE", t);
    }
  }

  /** An archived channel moved out of the archive category (the bot restoring a rewound game) is restored. */
  restoreIfMovedOut(ch: Json) {
    if (ch._archived && !this.inArchiveCategory(ch)) this.restoreChannel(ch);
  }

  /**
   * The normal category for a game's channels: the one it came from if it still exists, else the bot's "PBD #a-b"
   * category covering the game number (created when missing, like the bot's CreateGameService).
   */
  gameCategoryFor(game: string, ch: Json): Json {
    const from = ch._archive_parent ? this.store.state.channels[ch._archive_parent] : undefined;
    if (from && from.type === 4 && from.name !== Hub.ARCHIVE_CATEGORY) return from;
    const num = Number(/^pbd(\d+)$/i.exec(game)?.[1] ?? NaN);
    const cats = Object.values(this.store.state.channels).filter((c) => c.type === 4);
    for (const c of cats) {
      const r = /^PBD #(\d+)-(\d+)/.exec(String(c.name ?? ""));
      if (r && Number(r[1]) <= num && num <= Number(r[2])) return c;
    }
    const lo = Number.isFinite(num) ? num - (num % 10) : 0;
    const name = Number.isFinite(num) ? `PBD #${lo}-${lo + 9}` : "PBD Games";
    const cat = this.store.createChannel({ type: 4, name, position: 1000 });
    this.denyEveryoneOnGameChannel(cat);
    this.channelCreate(cat);
    return cat;
  }

  /**
   * A game the sweep restored (un-ended by a rewind before its channels came back) was idle since: the autopilots
   * only look at games with a message in the last hour, and a prompt the game waits for may be gone (live 22:28:
   * pbd303 / pbd346 restored, open tactical.conclude for an autopilot seat, nobody moved). Say so in the actions
   * channel (fresh activity) and ask the bot to re-post any prompt the game waits for (engine /recover).
   */
  async resumeRestoredGame(botApi: string, game: string, chans: Json[]) {
    const actions = chans.find((c) => c.type === 0 && /-actions$/i.test(String(c.name ?? "")));
    if (actions) {
      const msg = this.buildMessage(actions.id, this.store.state.bot_id, {
        content: "This game is on again (a rewind un-ended it): its channels are back from the archive.",
      });
      this.postMessage(msg);
    }
    // Give the bot a moment to take the CHANNEL_CREATEs in before it posts anything there.
    await new Promise((r) => setTimeout(r, 3000));
    try {
      await fetch(`${botApi}/api/public/selfhost/engine/${encodeURIComponent(game)}/recover`, {
        method: "POST",
        headers: { authorization: `Bot ${this.store.state.bot_token}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      /* the open prompts still stand; the autopilots look again on the fresh activity */
    }
  }

  /** Moves a game's archived channels back to its normal category and restores them. Returns how many. */
  unarchiveGameChannels(game: string, chans: Json[]): number {
    let n = 0;
    for (const ch of chans) {
      if (!ch._archived && !this.inArchiveCategory(ch)) continue;
      if (this.inArchiveCategory(ch)) ch.parent_id = this.gameCategoryFor(game, ch).id;
      if (ch._archived) this.restoreChannel(ch);
      else {
        this.store.invalidateViews();
        this.channelUpdate(ch);
      }
      n++;
    }
    return n;
  }

  channelDelete(ch: Json) {
    const isThread = [10, 11, 12].includes(ch.type);
    delete this.store.state.channels[ch.id];
    delete this.store.state.messages[ch.id];
    delete this.store.state.thread_members[ch.id];
    this.store.invalidateChannels([ch.id]);
    this.store.scheduleSave(ch.id);
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
    this.store.invalidateChannels([threadId]);
    const ch = this.store.channel(threadId);
    if (ch) ch.member_count = list.length;
    this.store.scheduleSave(threadId);
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
    this.store.invalidateChannels([threadId]);
    this.store.scheduleSave(threadId);
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
/** How long after a press the bot's posts in that channel count as answers to it. */
const PROMPT_WINDOW_MS = 8000;

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

/** The players' user ids in the bot's web-data for a game (playerData[].discordId). */
function playerIdsOf(data: Json): string[] {
  const list = Array.isArray(data?.playerData) ? data.playerData : [];
  return list.map((p: Json) => String(p?.discordId ?? "")).filter((id: string) => /^\d+$/.test(id));
}
