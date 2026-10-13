import { mkdirSync, readFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { snowflake, isoFromSnowflake, token } from "./ids.js";
import { ShardStore, type SaveStats } from "./shards.js";
import { log } from "./log.js";
import { syncSpan } from "./lag.js";

/** Raw Discord-shaped JSON objects. We keep them close to the wire format. */
export type Json = Record<string, any>;

export type User = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  discriminator: string;
  bot: boolean;
};

export type Member = {
  user_id: string;
  roles: string[];
  nick: string | null;
  joined_at: string;
};

export type Seat = {
  /** Secret that identifies the player in their invite link. */
  token: string;
  user_id: string;
  /** Played by the shim's autopilot (see autopilot.ts) instead of a person. */
  autopilot?: boolean;
};

export type StoredMessage = Json & {
  id: string;
  channel_id: string;
  /** Set for ephemeral messages: only this user may see it. Never returned to the bot's history reads. */
  _ephemeral_for?: string;
  /** The player whose button press this bot post answers (see Hub.attributePrompt); browsers get `prompted_user_id`. */
  _prompted_for?: string;
  /** Each player's latest press on this message: when (ISO) and the controls it had then. */
  _presses?: Record<string, { at: string; controls: string }>;
};

export type Interaction = {
  id: string;
  token: string;
  type: number;
  user_id: string;
  channel_id: string;
  /** Message the component lives on (component interactions). */
  message_id?: string;
  /** Message created as the interaction's response (reply / deferred reply). */
  original_id?: string;
  ephemeral?: boolean;
  /** Slash command name (application command interactions). */
  command_name?: string;
  /** The modal this interaction opened (type 9 callback), with Discord-assigned component ids. */
  modal?: Json;
  created: number;
  acked: boolean;
};

export type State = {
  version: 1;
  guild_id: string;
  bot_id: string;
  bot_token: string;
  users: Record<string, User>;
  members: Record<string, Member>;
  roles: Record<string, Json>;
  channels: Record<string, Json>;
  /** Users added to private (or any) threads. */
  thread_members: Record<string, string[]>;
  messages: Record<string, StoredMessage[]>;
  commands: Record<string, Json>;
  emojis: Record<string, Json>;
  seats: Record<string, Seat>;
  /** Channel webhooks (id -> webhook object incl. token). */
  webhooks?: Record<string, Json>;
  /** Gateway session id, kept across restarts so the bot can RESUME. */
  gateway_session?: string;
  /** Admin token for creating tables. */
  admin_token: string;
};

export const PERMS_ALL = "2251799813685247";
export const PERMS_EVERYONE = "1071698660929";

/**
 * Longest a canView answer is reused (see Store.canView); permission changes invalidate them at once, so this is only a
 * safety net. It was 10 s: with 180 seats x 9000 channels every seat rebuilt its whole list every 10 s (~20 ms each,
 * a third of the shim's CPU in the pbd539 soak), on top of every full invalidation.
 */
const VIEW_TTL_MS = 120_000;

/** Channel-scoped view changes kept for catching up (see Store.invalidateChannels); older caches start over. */
const VIEW_LOG_MAX = 1000;

/** One user's cached visibility answers (see Store.canView). seq: the last channel-scoped change applied. */
type ViewCache = {
  gen: number;
  at: number;
  seq: number;
  ok: Map<string, boolean>;
  base?: bigint;
  list?: Json[];
  listIds?: Set<string>;
  listObjs?: Set<Json>;
  listSeq?: number;
};

/** How often the verifier re-checks a slice of the files for unmarked changes (see ShardStore.verifySome). */
const VERIFY_EVERY_MS = 5000;

export class Store {
  state: State;
  private dir: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private lastSaveMs = 0;
  /** The files on disk: store/global.json, store/shards/*.json, store/segments/*.json (see shards.ts). */
  readonly disk: ShardStore;
  lastSave: SaveStats | null = null;
  interactions = new Map<string, Interaction>();
  interactionsByToken = new Map<string, Interaction>();

  constructor(dir: string, opts: { verifier?: boolean } = {}) {
    this.dir = dir;
    mkdirSync(join(dir, "files"), { recursive: true });
    mkdirSync(join(dir, "emojis"), { recursive: true });
    this.disk = new ShardStore(dir);
    const legacy = join(dir, "state.json");
    if (this.disk.exists()) {
      const t0 = Date.now();
      this.state = this.disk.load();
      log.info(`state loaded from ${this.disk.root} in ${Date.now() - t0}ms`);
      this.repairOverwrites();
    } else if (existsSync(legacy)) {
      // One-time migration from the single state.json (format 1): write every shard, then the global file (whose
      // presence marks the migration done), then keep the old file as a backup. A crash before the global file is
      // written just migrates again on the next start.
      const t0 = Date.now();
      this.state = JSON.parse(readFileSync(legacy, "utf8"));
      this.repairOverwrites();
      this.disk.markAll();
      const stats = this.disk.save(this.state);
      let backup = legacy + ".pre-shards";
      if (existsSync(backup)) backup += `-${Date.now()}`;
      renameSync(legacy, backup);
      log.info(`migrated ${legacy} to ${this.disk.root} (${stats.written.length} files, ${Date.now() - t0}ms); backup: ${backup}`);
    } else {
      this.state = this.freshState();
      this.saveNow();
    }
    if (opts.verifier !== false) setInterval(() => this.verifyTick(), VERIFY_EVERY_MS).unref();
  }

  /** Safety net for changes made without scheduleSave(channelId): see ShardStore.verifySome. */
  private verifyTick() {
    if (this.saveTimer || this.disk.pending) return;
    syncSpan("store verify", () => this.disk.verifySome(this.state));
    if (this.disk.unmarked.length) log.warn(`store: unmarked changes saved by the verifier: ${this.disk.unmarked.join(", ")}`);
    this.disk.unmarked.length = 0;
  }

  /**
   * State written before `parseJson` kept snowflakes intact holds permission-overwrite ids that JS rounded
   * (e.g. the @everyone deny on a game category). JDA then dropped them when syncing a new channel to its
   * category, so game channels created later became visible to everyone. Restore the exact ids, and give
   * such channels the @everyone deny their category carries.
   */
  private repairOverwrites() {
    // Overwrite type 0 targets a role (incl. @everyone = guild id), 1 a member; ids of both kinds can round alike.
    const byType = [Object.keys(this.state.roles), Object.keys(this.state.users)];
    const exact = byType.map((ids) => new Map(ids.map((id) => [String(Number(id)), id])));
    let fixed = 0;
    for (const ch of Object.values(this.state.channels)) {
      for (const o of ch.permission_overwrites ?? []) {
        const kind = o.type === 1 ? 1 : 0;
        if (typeof o.id === "number" || !byType[kind].includes(String(o.id))) {
          const id = exact[kind].get(String(Number(o.id)));
          if (id && id !== o.id) {
            o.id = id;
            fixed++;
          }
        }
      }
    }
    const everyone = this.state.guild_id;
    for (const ch of Object.values(this.state.channels)) {
      const parent = ch.parent_id ? this.state.channels[ch.parent_id] : undefined;
      if (!parent || ch.type !== 0 || !Array.isArray(ch.permission_overwrites) || !fixed) continue;
      const deny = (parent.permission_overwrites ?? []).find((o: Json) => o.id === everyone);
      if (!deny || ch.permission_overwrites.some((o: Json) => o.id === everyone)) continue;
      ch.permission_overwrites.push({ ...deny });
    }
    if (fixed) {
      this.disk.markAll();
      this.scheduleSave();
    }
  }

  get dataDir() {
    return this.dir;
  }

  private freshState(): State {
    const guild_id = snowflake();
    const bot_id = snowflake();
    // JDA decodes the first token segment as the bot's user id.
    const bot_token = `${Buffer.from(bot_id).toString("base64url")}.${token(4)}.${token(27)}`;
    const now = new Date().toISOString();
    const state: State = {
      version: 1,
      guild_id,
      bot_id,
      bot_token,
      users: {},
      members: {},
      roles: {},
      channels: {},
      thread_members: {},
      messages: {},
      commands: {},
      emojis: {},
      seats: {},
      admin_token: token(18),
    };
    state.users[bot_id] = {
      id: bot_id,
      username: "TI4 Bot",
      global_name: "TI4 Bot",
      avatar: null,
      discriminator: "0",
      bot: true,
    };
    state.roles[guild_id] = role(guild_id, "@everyone", PERMS_EVERYONE, 0);
    const botRole = snowflake();
    state.roles[botRole] = { ...role(botRole, "TI4 Bot", PERMS_ALL, 1), managed: true, tags: { bot_id } };
    state.members[bot_id] = { user_id: bot_id, roles: [botRole], nick: null, joined_at: now };
    return state;
  }

  /**
   * Marks state changed and schedules a save. Pass the channel whose channel object or thread members changed, plus
   * the message id when a message was added / edited / is being deleted; no channel means global state (users,
   * members, roles, commands, emojis, seats, webhooks, gateway session). See ShardStore for what each mark rewrites.
   */
  scheduleSave(channelId?: string | null, messageId?: string) {
    if (channelId && messageId) this.disk.markMessage(channelId, messageId);
    else {
      this.disk.markChannel(channelId);
      // A thread started from a message is embedded in that message (`thread`).
      const parent = channelId ? this.state.channels[channelId]?.parent_id : undefined;
      if (parent) this.disk.markIfChunked(parent, channelId!);
    }
    if (this.saveTimer) return;
    // A save writes only the shards that changed (normally tens of milliseconds); still space saves out so a slow one
    // stays under ~10% of the event loop.
    this.saveTimer = setTimeout(
      () => {
        this.saveTimer = null;
        this.saveNow();
      },
      Math.min(30000, Math.max(1000, 10 * this.lastSaveMs)),
    );
  }

  /** Writes what changed now. `all` also re-checks every file (used at exit). */
  saveNow(all = false) {
    const stats = syncSpan(all ? "store save (all)" : "store save", () => this.disk.save(this.state, { all }));
    this.lastSave = stats;
    this.lastSaveMs = stats.ms;
    if (stats.ms > 500 && !all) log.info(`store: slow save ${stats.ms}ms (${stats.written.length} files, ${stats.bytes} bytes)`);
    if (this.disk.unmarked.length) log.warn(`store: unmarked changes saved: ${this.disk.unmarked.join(", ")}`);
    this.disk.unmarked.length = 0;
    return stats;
  }

  // ---- users / members ----

  addUser(name: string): User {
    const id = snowflake();
    const username = name.toLowerCase().replace(/[^a-z0-9_.]/g, "") || `player${id.slice(-4)}`;
    const user: User = { id, username, global_name: name, avatar: null, discriminator: "0", bot: false };
    this.state.users[id] = user;
    this.state.members[id] = { user_id: id, roles: [], nick: null, joined_at: new Date().toISOString() };
    this.scheduleSave();
    return user;
  }

  userJson(id: string): Json {
    const u = this.state.users[id];
    if (!u) return { id, username: "unknown", global_name: null, avatar: null, discriminator: "0", bot: false };
    return {
      id: u.id,
      username: u.username,
      global_name: u.global_name,
      avatar: u.avatar,
      discriminator: u.discriminator,
      public_flags: 0,
      bot: u.bot,
      ...(u.bot ? { bot: true } : {}),
    };
  }

  memberJson(id: string, withUser = true): Json {
    const m = this.state.members[id];
    const base: Json = {
      roles: m ? m.roles : [],
      nick: m?.nick ?? null,
      avatar: null,
      banner: null,
      joined_at: m?.joined_at ?? new Date().toISOString(),
      premium_since: null,
      deaf: false,
      mute: false,
      flags: 0,
      pending: false,
      communication_disabled_until: null,
    };
    if (withUser) base.user = this.userJson(id);
    return base;
  }

  // ---- channels ----

  channel(id: string): Json | undefined {
    return this.state.channels[id];
  }

  createChannel(fields: Json): Json {
    const id = fields.id ?? snowflake();
    const isThread = [10, 11, 12].includes(fields.type);
    const ch: Json = {
      id,
      type: fields.type ?? 0,
      guild_id: this.state.guild_id,
      name: fields.name ?? "channel",
      position: fields.position ?? Object.keys(this.state.channels).length,
      parent_id: fields.parent_id ?? null,
      permission_overwrites: fields.permission_overwrites ?? [],
      topic: fields.topic ?? null,
      nsfw: false,
      last_message_id: null,
      rate_limit_per_user: 0,
      flags: 0,
    };
    if (isThread) {
      delete ch.permission_overwrites;
      delete ch.position;
      ch.owner_id = fields.owner_id ?? this.state.bot_id;
      ch.message_count = 0;
      ch.member_count = 0;
      ch.total_message_sent = 0;
      ch.thread_metadata = {
        archived: false,
        auto_archive_duration: fields.auto_archive_duration ?? 10080,
        archive_timestamp: new Date().toISOString(),
        locked: false,
        invitable: fields.invitable ?? true,
        create_timestamp: new Date().toISOString(),
      };
      this.state.thread_members[id] = [];
    }
    if (ch.type === 4) {
      delete ch.parent_id;
      delete ch.topic;
    }
    this.state.channels[id] = ch;
    this.invalidateChannels([id]);
    this.state.messages[id] ??= [];
    this.scheduleSave(id);
    return ch;
  }

  // ---- messages ----

  messages(channelId: string): StoredMessage[] {
    return (this.state.messages[channelId] ??= []);
  }

  findMessage(channelId: string, messageId: string): StoredMessage | undefined {
    const list = this.state.messages[channelId];
    if (!list) return undefined;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].id === messageId) return list[i];
    return undefined;
  }

  findMessageAnywhere(messageId: string): StoredMessage | undefined {
    for (const list of Object.values(this.state.messages)) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].id === messageId) return list[i];
    }
    return undefined;
  }

  insertMessage(msg: StoredMessage) {
    this.messages(msg.channel_id).push(msg);
    const ch = this.state.channels[msg.channel_id];
    if (ch && !msg._ephemeral_for) {
      ch.last_message_id = msg.id;
      if (ch.thread_metadata) {
        ch.message_count = (ch.message_count ?? 0) + 1;
        ch.total_message_sent = (ch.total_message_sent ?? 0) + 1;
      }
    }
    this.scheduleSave(msg.channel_id, msg.id);
  }

  deleteMessage(channelId: string, messageId: string): boolean {
    const list = this.state.messages[channelId];
    if (!list) return false;
    const i = list.findIndex((m) => m.id === messageId);
    if (i < 0) return false;
    this.scheduleSave(channelId, messageId);
    list.splice(i, 1);
    return true;
  }

  /** Keeps only the newest `keep` messages of a channel (log channels cap their history). */
  trimMessages(channelId: string, keep: number) {
    const list = this.state.messages[channelId];
    if (!list || list.length <= keep) return;
    for (const m of list.slice(0, list.length - keep)) this.scheduleSave(channelId, m.id);
    list.splice(0, list.length - keep);
  }

  // ---- visibility ----

  /**
   * Mirrors Discord's VIEW_CHANNEL resolution closely enough for our use. Answers are cached per user until the next
   * invalidateViews() (every permission-relevant change calls it) and at most VIEW_TTL_MS as a safety net. The old
   * cache (one map of user|channel entries, 3 s each, cleared whole past 200k entries) thrashed once seats x channels
   * passed 200k (live 15:15: 86 autopilot seats x 3600 channels), so every autopilot pass recomputed every channel.
   */
  private views = new Map<string, ViewCache>();
  private viewGen = 0;
  /** Channel-scoped changes (invalidateChannels), oldest first, numbered by viewSeq. */
  private viewLog: { seq: number; ids: string[] }[] = [];
  private viewSeq = 0;
  /** Changes whenever any channel was added, removed or changed in a way that may matter to visibility or grouping. */
  private chanGen = 0;

  private viewsOf(userId: string): ViewCache {
    const now = Date.now();
    let v = this.views.get(userId);
    if (!v || v.gen !== this.viewGen || now - v.at > VIEW_TTL_MS || (v.seq !== this.viewSeq && !this.catchUp(v))) {
      v = { gen: this.viewGen, at: now, seq: this.viewSeq, ok: new Map() };
      this.views.set(userId, v);
    }
    return v;
  }

  /**
   * Applies the channel-scoped changes since v.seq to one user's cache: drops those channels' answers and, when one of
   * them joined or left the user's visible list, the list (rebuilt on demand from the remaining answers). False when
   * the log no longer reaches back to v.seq (start over).
   */
  private catchUp(v: ViewCache): boolean {
    const first = this.viewLog[0];
    if (!first || first.seq > v.seq + 1) return false;
    const changed = new Set<string>();
    for (const c of this.viewLog) if (c.seq > v.seq) for (const id of c.ids) changed.add(id);
    v.seq = this.viewSeq;
    for (const id of changed) v.ok.delete(id);
    return true;
  }

  canView(userId: string, channelId: string): boolean {
    const v = this.viewsOf(userId);
    let ok = v.ok.get(channelId);
    if (ok === undefined) {
      ok = this.computeCanView(userId, channelId, v);
      v.ok.set(channelId, ok);
    }
    return ok;
  }

  /**
   * Every channel (any type) this user can see, in state order; cached like canView. Loops that only care about one
   * user's channels walk this instead of every channel of every game (3600+ live, most of them ended games').
   */
  visibleChannels(userId: string): Json[] {
    const v = this.viewsOf(userId);
    if (v.list && v.listIds && v.listSeq !== v.seq) {
      // Channel-scoped changes since the list was built: keep it unless one of them joined or left it (or was replaced).
      let keep = true;
      for (const c of this.viewLog) {
        if (c.seq <= (v.listSeq ?? 0) || !keep) continue;
        for (const id of c.ids) {
          const ch = this.state.channels[id];
          const now = !!ch && this.canView(userId, id);
          if (now !== v.listIds.has(id) || (now && !v.listObjs?.has(ch))) {
            keep = false;
            break;
          }
        }
      }
      if (!keep || (this.viewLog[0]?.seq ?? Infinity) > (v.listSeq ?? 0) + 1) v.list = undefined;
      else v.listSeq = v.seq;
    }
    if (!v.list) {
      const list: Json[] = [];
      for (const ch of Object.values(this.state.channels)) if (this.canView(userId, ch.id)) list.push(ch);
      v.list = list;
      v.listIds = new Set(list.map((c) => c.id));
      v.listObjs = new Set(list);
      v.listSeq = v.seq;
    }
    return v.list;
  }

  /** Changes whenever all cached views are dropped (permissions changed guild-wide, members, roles). */
  get viewGeneration() {
    return this.viewGen;
  }

  /** Changes whenever a channel was created, deleted or changed (or all views were dropped): per-game channel indexes. */
  get channelGeneration() {
    return this.chanGen;
  }

  /** Forget every cached canView answer (member / role / guild-wide change, or a change whose reach is unknown). */
  invalidateViews() {
    this.viewGen++;
    this.chanGen++;
    this.views.clear();
    this.viewLog = [];
  }

  /**
   * Only these channels' visibility may have changed (created, deleted, moved, renamed, overwrites, thread members):
   * every user's cached answers for them, and for the threads under them (a thread is visible where its parent is), are
   * dropped lazily on the user's next lookup. Everything else stays cached: a full invalidation per thread created
   * made every seat rebuild its list over all 9000 channels (~3.7 s of CPU per change with 180 seats).
   */
  invalidateChannels(ids: Iterable<string>) {
    const set = new Set<string>();
    let parents = false;
    for (const id of ids) {
      if (!id) continue;
      set.add(id);
      const ch = this.state.channels[id];
      if (!ch || ![10, 11, 12].includes(ch.type)) parents = true;
    }
    if (!set.size) return;
    if (parents) for (const ch of Object.values(this.state.channels)) if ((ch.type === 10 || ch.type === 11) && ch.parent_id && set.has(ch.parent_id)) set.add(ch.id);
    this.chanGen++;
    this.viewSeq++;
    this.viewLog.push({ seq: this.viewSeq, ids: [...set] });
    if (this.viewLog.length > VIEW_LOG_MAX) this.viewLog.splice(0, this.viewLog.length - VIEW_LOG_MAX);
  }

  private computeCanView(userId: string, channelId: string, v?: ViewCache): boolean {
    const ch = this.state.channels[channelId];
    if (!ch) return false;
    if (ch.type === 1) return (ch.recipients ?? []).some((r: Json) => r.id === userId);
    if (ch.type === 12) {
      return (this.state.thread_members[channelId] ?? []).includes(userId) || ch.owner_id === userId;
    }
    if (ch.type === 10 || ch.type === 11) return ch.parent_id ? (v ? this.canView(userId, ch.parent_id) : this.computeCanView(userId, ch.parent_id)) : true;
    const member = this.state.members[userId];
    if (!member) return false;
    const base = v ? (v.base ??= this.basePerms(member)) : this.basePerms(member);
    if ((base & 8n) === 8n) return true;
    let allowed = base;
    const apply = (ows: Json[]) => {
      const everyone = ows.find((o) => o.id === this.state.guild_id);
      if (everyone) allowed = (allowed & ~BigInt(everyone.deny ?? 0)) | BigInt(everyone.allow ?? 0);
      let roleAllow = 0n;
      let roleDeny = 0n;
      for (const o of ows) {
        if (o.type === 0 && member.roles.includes(o.id)) {
          roleAllow |= BigInt(o.allow ?? 0);
          roleDeny |= BigInt(o.deny ?? 0);
        }
      }
      allowed = (allowed & ~roleDeny) | roleAllow;
      const mine = ows.find((o) => o.type === 1 && o.id === userId);
      if (mine) allowed = (allowed & ~BigInt(mine.deny ?? 0)) | BigInt(mine.allow ?? 0);
    };
    apply(ch.permission_overwrites ?? []);
    return (allowed & 1024n) !== 0n;
  }

  private basePerms(member: Member): bigint {
    let p = BigInt(this.state.roles[this.state.guild_id]?.permissions ?? PERMS_EVERYONE);
    for (const r of member.roles) p |= BigInt(this.state.roles[r]?.permissions ?? 0);
    return p;
  }

  // ---- interactions ----

  newInteraction(i: Omit<Interaction, "id" | "token" | "created" | "acked">): Interaction {
    const full: Interaction = { ...i, id: snowflake(), token: "aW50ZXJhY3Rpb24" + token(60), created: Date.now(), acked: false };
    this.interactions.set(full.id, full);
    this.interactionsByToken.set(full.token, full);
    // Interaction tokens live 15 minutes on Discord.
    setTimeout(() => {
      this.interactions.delete(full.id);
      this.interactionsByToken.delete(full.token);
    }, 15 * 60 * 1000).unref();
    return full;
  }
}

function role(id: string, name: string, permissions: string, position: number): Json {
  return {
    id,
    name,
    color: 0,
    colors: { primary_color: 0, secondary_color: null, tertiary_color: null },
    hoist: false,
    icon: null,
    unicode_emoji: null,
    position,
    permissions,
    managed: false,
    mentionable: false,
    flags: 0,
  };
}

export function newRole(fields: Json, position: number): Json {
  const r = role(snowflake(), fields.name ?? "new role", fields.permissions ?? "0", position);
  if (fields.color != null) r.color = fields.color;
  if (fields.mentionable != null) r.mentionable = fields.mentionable;
  if (fields.hoist != null) r.hoist = fields.hoist;
  return r;
}

export { isoFromSnowflake };
