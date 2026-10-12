/*
 * The bot's game save format (maps/<game>.txt and the undo copies maps/undo/<game>/<game>_N.txt).
 *
 *   line 1  owner user id      line 2  owner name      line 3  game name
 *   -mapinfo- -gameinfo- <key value>* -endgameinfo- -playerinfo- (-player- <user id> <user name> <key value>* -endplayer-)*
 *   -endplayerinfo- -endmapinfo- then the tiles (-tile- ... -endtile-)*
 *
 * Every line is read on its own by GameLoadService (first token = key), so a multi-line value such as
 * `saved_message` only keeps its first line on load; its continuation lines are junk the loader ignores.
 */

export type SavePlayer = { userId: string; userName: string; kv: Map<string, string>; start: number; end: number };
export type ParsedSave = {
  lines: string[];
  ownerId: string;
  ownerName: string;
  name: string;
  game: Map<string, string>;
  players: SavePlayer[];
  tilesStart: number;
};

export const splitLines = (text: string) => text.replace(/\r\n/g, "\n").split("\n");

function kv(line: string): [string, string] {
  const i = line.indexOf(" ");
  return i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + 1)];
}

export function parseSave(text: string): ParsedSave {
  const lines = splitLines(text);
  const game = new Map<string, string>();
  const players: SavePlayer[] = [];
  let i = 3;
  let section = "";
  let player: SavePlayer | null = null;
  let tilesStart = lines.length;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l === "-gameinfo-") section = "game";
    else if (l === "-endgameinfo-") section = "";
    else if (l === "-player-") {
      player = { userId: lines[i + 1], userName: lines[i + 2], kv: new Map(), start: i, end: i };
      i += 2;
      section = "player";
    } else if (l === "-endplayer-") {
      if (player) {
        player.end = i;
        players.push(player);
      }
      player = null;
      section = "";
    } else if (l === "-endmapinfo-") {
      tilesStart = i + 1;
      break;
    } else if (section === "game") {
      const [k, v] = kv(l);
      if (k === "saved_message") {
        // Its continuation lines (the loader ignores them) run up to bot_map_channel, the next key written.
        let j = i + 1;
        while (j < lines.length && !lines[j].startsWith("bot_map_channel ") && lines[j] !== "-endgameinfo-") j++;
        if (j < lines.length && lines[j].startsWith("bot_map_channel ")) i = j - 1;
      }
      if (!game.has(k)) game.set(k, v);
    } else if (section === "player" && player) {
      const [k, v] = kv(l);
      if (!player.kv.has(k)) player.kv.set(k, v);
    }
  }
  return { lines, ownerId: lines[0], ownerName: lines[1], name: lines[2], game, players, tilesStart };
}

/** The neutral "Dicecord" seat and other placeholders are not real people: never remapped. */
export const isRealPlayer = (p: SavePlayer) => p.kv.get("dummy") !== "true" && p.kv.get("npc") !== "true" && /^\d{15,20}$/.test(p.userId);

/** Channel-valued keys a fork must point at its own channels. */
export const GAME_CHANNEL_KEYS = ["table_talk_channel", "main_game_channel", "saved_channel", "bot_map_channel", "game_launch_thread_id"];
export const PLAYER_CHANNEL_KEYS = ["cards_info_thread_channel_id", "draft_bag_info_thread_channel_id"];

export type ForkMap = {
  /** original game name -> fork game name */
  game: [string, string];
  /** original user id -> fork user id */
  users: Map<string, string>;
  /** original user name -> fork user name (player header lines, owner line) */
  names: Map<string, string>;
  /** original user id -> fork username (stats_tracked_user_name etc.) */
  usernames: Map<string, string>;
  /** values for GAME_CHANNEL_KEYS in the fork */
  gameChannels: Map<string, string>;
  /** fork user id -> { key -> channel id } for PLAYER_CHANNEL_KEYS ("null" lets the bot create a thread) */
  playerChannels: Map<string, Map<string, string>>;
  /** any other snowflake of the original game's channels (round threads, ...) -> this (the fork's actions channel) */
  otherChannel?: string;
  otherChannelIds?: Set<string>;
};

/**
 * Rewrites an original save so it loads as the fork game: its name, its people (seat for seat) and its channels.
 * Card decks, dice-free state, tiles, stored values are left byte-for-byte as recorded.
 */
export function rewriteForFork(
  text: string,
  m: ForkMap,
  opts: { savedButtons?: string; savedMessage?: string; savedChannel?: string; customName?: string } = {},
): string {
  const [fromGame, toGame] = m.game;
  const lines = splitLines(text);
  const out: string[] = [];
  const gameRe = new RegExp(`\\b${fromGame}\\b`, "g");
  const swapIds = (s: string) =>
    s.replace(/\d{15,20}/g, (id) => m.users.get(id) ?? (m.otherChannelIds?.has(id) && m.otherChannel ? m.otherChannel : id));
  let section = "";
  let forkUser = "";
  let skippingSavedMessage = false;
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (i === 0) {
      out.push(m.users.get(l) ?? l);
      continue;
    }
    if (i === 1) {
      out.push(m.names.get(l) ?? l);
      continue;
    }
    if (i === 2) {
      out.push(toGame);
      continue;
    }
    if (skippingSavedMessage) {
      if (!l.startsWith("bot_map_channel ")) continue;
      skippingSavedMessage = false;
    }
    if (l === "-gameinfo-") section = "game";
    else if (l === "-endgameinfo-") section = "";
    else if (l === "-player-") {
      const uid = lines[i + 1];
      forkUser = m.users.get(uid) ?? uid;
      out.push(l, forkUser, m.names.get(lines[i + 2]) ?? lines[i + 2]);
      i += 2;
      section = "player";
      continue;
    } else if (l === "-endplayer-") section = "";
    else if (l === "-endmapinfo-") section = "tiles";
    const [k, v] = kv(l);
    if (section === "game") {
      if (k === "saved_message") {
        skippingSavedMessage = true;
        out.push(`saved_message ${opts.savedMessage ?? v}`.trimEnd());
        continue;
      }
      if (k === "saved_buttons" && opts.savedButtons !== undefined) {
        out.push(`saved_buttons ${opts.savedButtons}`);
        continue;
      }
      if (k === "game_custom_name" && opts.customName) {
        // A marker the web data shows (gameCustomName): tells a fresh web-data payload from a stale one.
        out.push(`game_custom_name ${opts.customName}`);
        continue;
      }
      if (k === "saved_channel" && opts.savedChannel) {
        out.push(`saved_channel ${opts.savedChannel}`);
        continue;
      }
      if (GAME_CHANNEL_KEYS.includes(k) && m.gameChannels.has(k)) {
        out.push(`${k} ${m.gameChannels.get(k)}`);
        continue;
      }
    }
    if (section === "player") {
      const pc = m.playerChannels.get(forkUser);
      if (PLAYER_CHANNEL_KEYS.includes(k) && pc) {
        out.push(`${k} ${pc.get(k) ?? "null"}`);
        continue;
      }
      if (k === "stats_tracked_user_name") {
        const orig = [...m.users.entries()].find(([, f]) => f === forkUser)?.[0];
        out.push(`${k} ${(orig && m.usernames.get(orig)) ?? v}`);
        continue;
      }
    }
    l = swapIds(l);
    if (section !== "tiles") l = l.replace(gameRe, toGame);
    out.push(l);
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Comparison                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * Keys whose values are bookkeeping, not game state: wall-clock times, the label of the last command, the prompt the
 * undo button would re-post, counters of presses and renders. A replay never reproduces them exactly.
 */
export const VOLATILE_GAME_KEYS = new Set([
  "last_modified_date",
  "latest_command",
  "saved_buttons",
  "saved_message",
  "saved_channel",
  "last_active_player_change",
  "button_press_count",
  "image_gen_count",
  "creation_date",
  "creation_date_time",
  "started_date",
  "ended_date",
  "strat_pings",
  "game_custom_name",
  "temporary_ping_disable",
  "table_talk_channel",
  "main_game_channel",
  "bot_map_channel",
  "game_launch_thread_id",
  "owner",
  "pinged_systems",
]);

/** Stored values that only steer where the bot posts or when it pings, and per-message bookkeeping keyed by a Discord
 * message id ("<message id>SCReacts" etc.: who reacted to which post; the follows themselves are in followed_sc).
 * engineExploreLog: the engine-int bot's explore/relic history for clients (ExploreLog, written by hooks in
 * ExploreService/RelicHelper on every path) — recordings made before it existed never carry it.
 * engineCombatLedger: the engine's persisted roll ledger (CombatSupport: once-per-activation space cannon / barrage). */
export const VOLATILE_STORED_KEYS = [/^engineExploreLog$/, /^engineCombatLedger$/, /^savedChannelType$/, /[Pp]ing/, /^lastActive/, /MsgID|MessageID|messageId|ThreadId/, /\d{15,20}/];

/** The game's stored values: `check_reacts_info k1,v1:k2,v2:...` (see Game.getStoredValue). */
export function storedValues(v: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const entry of v.split(":")) {
    if (!entry) continue;
    const i = entry.indexOf(",");
    if (i < 0) m.set(entry, "");
    else m.set(entry.slice(0, i), entry.slice(i + 1));
  }
  return m;
}
export const VOLATILE_PLAYER_KEYS = new Set([
  "total_turn_time",
  "number_of_turns",
  "cards_info_thread_channel_id",
  "draft_bag_info_thread_channel_id",
  "stats_tracked_user_name",
  "stats_tracked_user_id",
  "expected_hits_times_10",
  "actual_hits",
]);

/**
 * Card lists stored as "card,handle;card,handle;": the handle is a random 0-999 number the bot draws for every card it
 * deals (Game: ThreadLocalRandom.nextInt(1000)) so buttons can name the card. Not game state: compared without it.
 */
export const CARD_HANDLE_KEYS =
  /^(action_cards|action_cards_discarded|action_cards_purged|secret_objectives|secret_objectives_scored|promissory_notes|discarded_agendas|sent_agenda|law|scored_secrets|events|discarded_events)$/;
export const stripHandles = (v: string) => v.replace(/([^,;]+),\d{1,4};/g, "$1;");

export type NormalizeOpts = {
  /** keep the random card handles (see CARD_HANDLE_KEYS) */
  keepHandles?: boolean;
  /** fork user id -> original user id (applied first) */
  reverseUsers?: Map<string, string>;
  forkGame?: string;
  origGame?: string;
  extraVolatile?: string[];
};

/**
 * Canonical, comparable lines of a save: `game.<key> <value>`, `player[<faction or user>].<key> <value>`,
 * `tile <position>: <line>`. Volatile keys are dropped; user ids are mapped back to the original seats; other
 * snowflakes (channel and message ids) become `#id` and epoch-millis become `#ts`.
 */
export function normalizeSave(text: string, o: NormalizeOpts = {}): string[] {
  const p = parseSave(text);
  const extra = new Set(o.extraVolatile ?? []);
  const back = (id: string) => o.reverseUsers?.get(id) ?? id;
  // People keep their (original) ids; channel / message ids do not survive a fork and become `#id`.
  const userIds = new Set([back(p.ownerId), ...p.players.map((pl) => back(pl.userId))]);
  const fix = (v: string) => {
    let s = v;
    if (o.reverseUsers) s = s.replace(/\d{15,20}/g, back);
    if (o.forkGame && o.origGame) s = s.replace(new RegExp(`\\b${o.forkGame}\\b`, "g"), o.origGame);
    return s.replace(/\d{15,20}/g, (id) => (userIds.has(id) ? id : "#id")).replace(/\b1[6-9]\d{11}\b/g, "#ts");
  };
  const out: string[] = [];
  for (const [k, v] of p.game) {
    if (VOLATILE_GAME_KEYS.has(k) || extra.has(`game.${k}`) || !/^[a-z0-9_]+$/.test(k)) continue;
    if (k === "check_reacts_info") {
      // The game's stored values ("key,value" entries joined by ':'): compared one by one.
      for (const [sk, sv] of storedValues(v)) {
        if (VOLATILE_STORED_KEYS.some((r) => r.test(sk)) || extra.has(`stored.${sk}`)) continue;
        // Agenda double-press guard (agendaRes<round><n> = outcome + the agenda's random discard handle).
        const val = !o.keepHandles && /^agendaRes\d+$/.test(sk) ? sv.replace(/\d{1,4}$/, "#") : sv;
        out.push(`stored.${fix(sk)} ${fix(val)}`);
      }
      continue;
    }
    let val = !o.keepHandles && CARD_HANDLE_KEYS.test(k) ? stripHandles(v) : v;
    // The agenda being voted on carries its random handle too: Law_For/Against_899_conscription.
    if (!o.keepHandles && k === "current_agenda_info") val = val.replace(/_\d{1,4}_/, "_#_");
    out.push(`game.${k} ${fix(val)}`);
  }
  for (const pl of p.players) {
    const uid = o.reverseUsers?.get(pl.userId) ?? pl.userId;
    const who = pl.kv.get("faction") && pl.kv.get("faction") !== "null" ? pl.kv.get("faction") : uid;
    for (const [k, v] of pl.kv) {
      if (VOLATILE_PLAYER_KEYS.has(k) || extra.has(`player.${k}`) || !/^[a-z0-9_]+$/.test(k)) continue;
      out.push(`player[${who}].${k} ${fix(!o.keepHandles && CARD_HANDLE_KEYS.test(k) ? stripHandles(v) : v)}`);
    }
  }
  let tile = "";
  for (let i = p.tilesStart; i < p.lines.length; i++) {
    const l = p.lines[i];
    if (l === "-tile-") {
      tile = p.lines[i + 1] ?? "";
      continue;
    }
    if (!l) continue;
    out.push(`tile ${tile.split(" ")[1] ?? tile}: ${fix(l)}`);
  }
  return out;
}

/** `orderOnly`: the same items in another order (a shuffle, or a hash-set iteration order). */
export type SaveDiff = { key: string; expected: string | null; actual: string | null; orderOnly?: boolean };

const tokens = (s: string | null) =>
  (s ?? "")
    .split(/[\s,;|{}\[\]":⏎]+/)
    .filter(Boolean)
    .sort()
    .join(" ");

/** Key-wise difference of two normalized saves (tiles compared as multisets of lines per tile). */
export function diffNormalized(expected: string[], actual: string[]): SaveDiff[] {
  const keyed = (lines: string[]) => {
    const m = new Map<string, string[]>();
    for (const l of lines) {
      const tileM = /^(tile [^:]*):/.exec(l);
      const key = tileM ? tileM[1] : l.slice(0, Math.max(0, l.indexOf(" ")) || l.length);
      const val = tileM ? l.slice(tileM[1].length + 2) : l.slice(key.length + 1);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(val);
    }
    return m;
  };
  const e = keyed(expected);
  const a = keyed(actual);
  const out: SaveDiff[] = [];
  for (const k of new Set([...e.keys(), ...a.keys()])) {
    const ev = (e.get(k) ?? []).slice().sort().join("\n");
    const av = (a.get(k) ?? []).slice().sort().join("\n");
    if (ev !== av) {
      const d: SaveDiff = { key: k, expected: e.has(k) ? ev : null, actual: a.has(k) ? av : null };
      if (d.expected !== null && d.actual !== null && tokens(d.expected) === tokens(d.actual)) d.orderOnly = true;
      out.push(d);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Line deltas: recordings keep the first save whole and every later one as a delta from its predecessor.        */
/* ------------------------------------------------------------------------------------------------------------ */

/** [start, deleteCount, ...insertedLines] hunks against the previous text, applied in order. */
export type Delta = Array<[number, number, ...string[]]>;

export function lineDelta(aText: string, bText: string): Delta {
  const a = splitLines(aText);
  const b = splitLines(bText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  if (!A.length && !B.length) return [];
  const n = A.length;
  const mm = B.length;
  if (n * mm > 4_000_000) return [[pre, n, ...B]];
  // LCS table (suffix lengths), then walk it to emit hunks.
  const w = mm + 1;
  const T = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = mm - 1; j >= 0; j--) T[i * w + j] = A[i] === B[j] ? T[(i + 1) * w + j + 1] + 1 : Math.max(T[(i + 1) * w + j], T[i * w + j + 1]);
  const hunks: Delta = [];
  let i = 0;
  let j = 0;
  let cur: [number, number, ...string[]] | null = null;
  let shift = 0; // position in the *output* (after earlier hunks applied)
  while (i < n || j < mm) {
    if (i < n && j < mm && A[i] === B[j]) {
      if (cur) {
        hunks.push(cur);
        shift += cur.length - 2 - cur[1];
        cur = null;
      }
      i++;
      j++;
    } else if (j < mm && (i >= n || T[i * w + j + 1] >= T[(i + 1) * w + j])) {
      cur ??= [pre + i + shift, 0];
      cur.push(B[j]);
      j++;
    } else {
      cur ??= [pre + i + shift, 0];
      cur[1]++;
      i++;
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

export function applyDelta(aText: string, d: Delta): string {
  const lines = splitLines(aText);
  for (const [start, del, ...ins] of d) lines.splice(start, del, ...ins);
  return lines.join("\n");
}
