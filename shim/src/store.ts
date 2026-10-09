import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { snowflake, isoFromSnowflake, token } from "./ids.js";

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
};

export type StoredMessage = Json & {
  id: string;
  channel_id: string;
  /** Set for ephemeral messages: only this user may see it. Never returned to the bot's history reads. */
  _ephemeral_for?: string;
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
  /** Admin token for creating tables. */
  admin_token: string;
};

export const PERMS_ALL = "2251799813685247";
export const PERMS_EVERYONE = "1071698660929";

export class Store {
  state: State;
  private dir: string;
  private saveTimer: NodeJS.Timeout | null = null;
  interactions = new Map<string, Interaction>();
  interactionsByToken = new Map<string, Interaction>();

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, "files"), { recursive: true });
    mkdirSync(join(dir, "emojis"), { recursive: true });
    const file = join(dir, "state.json");
    if (existsSync(file)) {
      this.state = JSON.parse(readFileSync(file, "utf8"));
    } else {
      this.state = this.freshState();
      this.saveNow();
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

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 1000);
  }

  saveNow() {
    const file = join(this.dir, "state.json");
    writeFileSync(file + ".tmp", JSON.stringify(this.state));
    renameSync(file + ".tmp", file);
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
    this.state.messages[id] ??= [];
    this.scheduleSave();
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
    this.scheduleSave();
  }

  deleteMessage(channelId: string, messageId: string): boolean {
    const list = this.state.messages[channelId];
    if (!list) return false;
    const i = list.findIndex((m) => m.id === messageId);
    if (i < 0) return false;
    list.splice(i, 1);
    this.scheduleSave();
    return true;
  }

  // ---- visibility ----

  /** Mirrors Discord's VIEW_CHANNEL resolution closely enough for our use. */
  canView(userId: string, channelId: string): boolean {
    const ch = this.state.channels[channelId];
    if (!ch) return false;
    if (ch.type === 1) return (ch.recipients ?? []).some((r: Json) => r.id === userId);
    if (ch.type === 12) {
      return (this.state.thread_members[channelId] ?? []).includes(userId) || ch.owner_id === userId;
    }
    if (ch.type === 10 || ch.type === 11) return ch.parent_id ? this.canView(userId, ch.parent_id) : true;
    const member = this.state.members[userId];
    if (!member) return false;
    if (this.memberHasPerm(member, 8n)) return true;
    let allowed = this.basePerms(member);
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

  private memberHasPerm(member: Member, bit: bigint) {
    return (this.basePerms(member) & bit) === bit;
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
