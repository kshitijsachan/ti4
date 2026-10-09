import { createStore } from "zustand/vanilla";
import type {
  Channel,
  Command,
  Message,
  Modal,
  Role,
  ServerFrame,
  Snowflake,
  User,
} from "../types";
import { compareSnowflakes } from "../shared/snowflake";
import { readLastRead, readStored, writeLastRead, writeStored } from "./lastRead";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type ChannelMessages = {
  /** Message ids, oldest → newest. */
  ids: Snowflake[];
  byId: Record<Snowflake, Message>;
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
};

export type PendingAction = {
  nonce: string;
  /** What the spinner is attached to, e.g. `messageId:customId`, `modal:<interaction>`, `command`. */
  key: string;
  startedAt: number;
};

export type OpenModal = { interactionId: Snowflake; nonce?: string; modal: Modal; channelId?: Snowflake };

export type Toast = { id: number; kind: "error" | "info"; text: string };

export type PlayState = {
  status: ConnectionStatus;
  botOnline: boolean;
  me: User | null;
  botId: Snowflake | null;
  guildId: Snowflake | null;
  users: Record<Snowflake, User>;
  roles: Record<Snowflake, Role>;
  channels: Record<Snowflake, Channel>;
  commands: Command[];
  messages: Record<Snowflake, ChannelMessages>;
  /** Live unread counts for channels not currently on screen. */
  unread: Record<Snowflake, number>;
  /** Unread messages that mention me (or my roles). */
  mentions: Record<Snowflake, number>;
  /** Channel id → last message id I have seen (persisted per browser). */
  lastRead: Record<Snowflake, Snowflake>;
  /** Mount counts per channel; a channel with a count > 0 is on screen and never accrues unread. */
  viewing: Record<Snowflake, number>;
  pending: Record<string, PendingAction>;
  /** Outcome of recently settled actions: nonce → error text, or null on success. */
  results: Record<string, string | null>;
  modals: OpenModal[];
  toasts: Toast[];
  activeChannelId: Snowflake | null;
  /** Message the composer is replying to, per channel. */
  replyTo: Record<Snowflake, Message | null>;
  /** Channel id → newest message I pressed a button / used a select on (persisted per browser). */
  interacted: Record<Snowflake, Snowflake>;
  /** Prompts I hid from the "needs you" tray (message ids, persisted per browser). */
  dismissedPrompts: Record<Snowflake, true>;
};

export const EMPTY_CHANNEL: ChannelMessages = {
  ids: [],
  byId: {},
  hasMore: true,
  loading: false,
  loaded: false,
};

let toastSeq = 1;

export type PlayStore = ReturnType<typeof createPlayStore>;

export function createPlayStore(storageKey: string) {
  const store = createStore<PlayState>()(() => ({
    status: "idle",
    botOnline: false,
    me: null,
    botId: null,
    guildId: null,
    users: {},
    roles: {},
    channels: {},
    commands: [],
    messages: {},
    unread: {},
    mentions: {},
    lastRead: readLastRead(storageKey),
    viewing: {},
    pending: {},
    results: {},
    modals: [],
    toasts: [],
    activeChannelId: null,
    replyTo: {},
    interacted: readStored(`interacted.${storageKey}`),
    dismissedPrompts: readStored(`dismissed.${storageKey}`),
  }));

  const set = store.setState;
  const get = store.getState;

  const patchChannel = (channelId: Snowflake, fn: (c: ChannelMessages) => ChannelMessages) => {
    const cur = get().messages[channelId] ?? EMPTY_CHANNEL;
    set({ messages: { ...get().messages, [channelId]: fn(cur) } });
  };

  const mentionsMe = (m: Message) => {
    const me = get().me;
    if (!me) return false;
    if (m.mentions?.some((u) => u.id === me.id)) return true;
    if (m.content.includes(`<@${me.id}>`)) return true;
    const myRoles = get().users[me.id]?.roles ?? [];
    return (m.mention_roles ?? []).some((r) => myRoles.includes(r));
  };

  const markRead = (channelId: Snowflake) => {
    const c = get().messages[channelId];
    const lastId = c?.ids[c.ids.length - 1] ?? get().channels[channelId]?.last_message_id;
    const s = get();
    const next: Partial<PlayState> = {};
    if (s.unread[channelId]) next.unread = { ...s.unread, [channelId]: 0 };
    if (s.mentions[channelId]) next.mentions = { ...s.mentions, [channelId]: 0 };
    if (lastId && s.lastRead[channelId] !== lastId) {
      const lastRead = { ...s.lastRead, [channelId]: lastId };
      next.lastRead = lastRead;
      writeLastRead(storageKey, lastRead);
    }
    if (Object.keys(next).length) set(next);
  };

  /** First visit in this browser: treat existing history as read rather than lighting up every channel. */
  const seedLastRead = (channels: Channel[]) => {
    if (Object.keys(get().lastRead).length) return;
    const lastRead: Record<Snowflake, Snowflake> = {};
    for (const c of channels) if (c.last_message_id) lastRead[c.id] = c.last_message_id;
    set({ lastRead });
    writeLastRead(storageKey, lastRead);
  };

  const onMessage = (m: Message, isNew: boolean) => {
    patchChannel(m.channel_id, (c) => insertMessage(c, m));
    const channels = get().channels;
    const ch = channels[m.channel_id];
    if (ch && compareSnowflakes(m.id, ch.last_message_id ?? "0") > 0) {
      set({ channels: { ...channels, [ch.id]: { ...ch, last_message_id: m.id } } });
    }
    if (!isNew) return;
    if (get().viewing[m.channel_id]) return markRead(m.channel_id);
    if (m.author.id === get().me?.id) return;
    const s = get();
    set({ unread: { ...s.unread, [m.channel_id]: (s.unread[m.channel_id] ?? 0) + 1 } });
    if (mentionsMe(m)) set({ mentions: { ...s.mentions, [m.channel_id]: (s.mentions[m.channel_id] ?? 0) + 1 } });
  };

  const settle = (nonce: string | undefined, error: string | null = null) => {
    if (!nonce || !get().pending[nonce]) return;
    const rest = { ...get().pending };
    delete rest[nonce];
    const keys = Object.keys(get().results);
    const results = { ...get().results, [nonce]: error };
    if (keys.length > 50) delete results[keys[0]];
    set({ pending: rest, results });
  };

  const actions = {
    store,
    setStatus(status: ConnectionStatus) {
      set({ status });
    },
    toast(text: string, kind: Toast["kind"] = "error") {
      const t = { id: toastSeq++, kind, text };
      set({ toasts: [...get().toasts, t].slice(-5) });
      return t.id;
    },
    dismissToast(id: number) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    addPending(nonce: string, key: string) {
      set({ pending: { ...get().pending, [nonce]: { nonce, key, startedAt: Date.now() } } });
    },
    settle,
    /** Fail every in-flight action (the socket dropped, so their acks will never arrive). */
    failAllPending(reason: string) {
      const nonces = Object.keys(get().pending);
      if (!nonces.length) return;
      for (const n of nonces) settle(n, reason);
      actions.toast(reason);
    },
    setHistoryLoading(channelId: Snowflake, loading: boolean) {
      patchChannel(channelId, (c) => ({ ...c, loading }));
    },
    setActiveChannel(channelId: Snowflake | null) {
      set({ activeChannelId: channelId });
    },
    view(channelId: Snowflake) {
      const v = get().viewing;
      set({ viewing: { ...v, [channelId]: (v[channelId] ?? 0) + 1 } });
      markRead(channelId);
    },
    unview(channelId: Snowflake) {
      const v = get().viewing;
      set({ viewing: { ...v, [channelId]: Math.max(0, (v[channelId] ?? 0) - 1) } });
    },
    markRead,
    /** Remember that I acted on a message, so prompts at or before it count as answered. */
    noteInteraction(channelId: Snowflake, messageId: Snowflake) {
      const cur = get().interacted[channelId];
      if (cur && compareSnowflakes(cur, messageId) >= 0) return;
      const interacted = { ...get().interacted, [channelId]: messageId };
      set({ interacted });
      writeStored(`interacted.${storageKey}`, interacted);
    },
    dismissPrompt(messageId: Snowflake) {
      const ids = Object.keys(get().dismissedPrompts).sort(compareSnowflakes).slice(-300);
      const dismissedPrompts: Record<Snowflake, true> = { [messageId]: true };
      for (const id of ids) dismissedPrompts[id] = true;
      set({ dismissedPrompts });
      writeStored(`dismissed.${storageKey}`, dismissedPrompts);
    },
    setReply(channelId: Snowflake, message: Message | null) {
      set({ replyTo: { ...get().replyTo, [channelId]: message } });
    },
    closeModal(interactionId: Snowflake) {
      set({ modals: get().modals.filter((m) => m.interactionId !== interactionId) });
    },
    /** Apply one server frame. Returns nothing; side effects (toasts, callbacks) are driven by the connection. */
    apply(frame: ServerFrame, modalChannel?: Snowflake) {
      switch (frame.t) {
        case "hello":
          seedLastRead(frame.channels);
          set({
            me: frame.me,
            botId: frame.bot_id,
            guildId: frame.guild_id,
            botOnline: frame.bot_online,
            users: byId(frame.users),
            roles: byId(frame.roles),
            channels: byId(frame.channels),
            commands: frame.commands,
          });
          return;
        case "history":
          patchChannel(frame.channel_id, (c) => mergeHistory(c, frame.messages, frame.has_more));
          return;
        case "message_create":
          return onMessage(frame.message, true);
        case "message_update":
          return onMessage(frame.message, false);
        case "message_delete":
          patchChannel(frame.channel_id, (c) => removeMessage(c, frame.id));
          return;
        case "channel_upsert":
          set({ channels: { ...get().channels, [frame.channel.id]: frame.channel } });
          return;
        case "channel_delete": {
          const rest = { ...get().channels };
          delete rest[frame.id];
          set({ channels: rest });
          return;
        }
        case "channels":
          set({ channels: byId(frame.channels) });
          return;
        case "user_upsert":
          set({ users: { ...get().users, [frame.user.id]: frame.user } });
          return;
        case "modal":
          settle(frame.nonce);
          set({
            modals: [
              ...get().modals.filter((m) => m.interactionId !== frame.interaction_id),
              { interactionId: frame.interaction_id, nonce: frame.nonce, modal: frame.modal, channelId: modalChannel },
            ],
          });
          return;
        case "interaction_done":
        case "error":
          settle(frame.nonce, frame.error ?? null);
          if (frame.error) actions.toast(frame.error);
          return;
        default:
          return;
      }
    },
  };
  return actions;
}

export type PlayActions = ReturnType<typeof createPlayStore>;

function byId<T extends { id: Snowflake }>(list: T[]): Record<Snowflake, T> {
  const out: Record<Snowflake, T> = {};
  for (const item of list) out[item.id] = item;
  return out;
}

function insertMessage(c: ChannelMessages, m: Message): ChannelMessages {
  const byIdNext = { ...c.byId, [m.id]: m };
  if (c.byId[m.id]) return { ...c, byId: byIdNext };
  const ids = c.ids.slice();
  let i = ids.length;
  while (i > 0 && compareSnowflakes(ids[i - 1], m.id) > 0) i--;
  ids.splice(i, 0, m.id);
  return { ...c, ids, byId: byIdNext };
}

function removeMessage(c: ChannelMessages, id: Snowflake): ChannelMessages {
  if (!c.byId[id]) return c;
  const byIdNext = { ...c.byId };
  delete byIdNext[id];
  return { ...c, ids: c.ids.filter((x) => x !== id), byId: byIdNext };
}

/**
 * Merge a history page. A page older than everything we hold is a pagination step; a page that does not
 * reach back to our newest message (after a reconnect gap) replaces the list so we never show a hole.
 */
function mergeHistory(c: ChannelMessages, page: Message[], hasMore: boolean): ChannelMessages {
  const base: ChannelMessages = { ...c, loading: false, loaded: true };
  if (!page.length) return c.ids.length ? { ...base, hasMore } : { ...base, hasMore: false };
  const oldestNew = page[0].id;
  const newestNew = page[page.length - 1].id;
  const oldestHave = c.ids[0];
  const newestHave = c.ids[c.ids.length - 1];
  const isOlderPage = oldestHave !== undefined && compareSnowflakes(newestNew, oldestHave) < 0;
  const leavesGap = newestHave !== undefined && !isOlderPage && compareSnowflakes(oldestNew, newestHave) > 0;
  if (!c.ids.length || leavesGap) {
    return { ...base, ids: page.map((m) => m.id), byId: byId(page), hasMore };
  }
  let next = base;
  for (const m of page) next = insertMessage(next, m);
  return { ...next, hasMore: isOlderPage ? hasMore : c.hasMore };
}
