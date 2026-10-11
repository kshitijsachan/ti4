/*
 * Recordings: one game's history as data, from what the local stack already keeps.
 *
 *   saves     the bot's undo copies (maps/undo/<game>/<game>_N.txt, the last ~100 saves; all of them for short games)
 *             = the authoritative state after every saved action. Kept as the first save + line deltas.
 *   actions   one per save: who did what to produce it, from the save's `latest_command` (button presses with label
 *             and custom id, slash commands with their options, selections, modals, web API calls, roll-backs)
 *             enriched from the bot's #button-log (exact press time, channel, message, and the custom id of presses
 *             the save hides as "[CLASSIFIED]") and the dice the bot posted for it (d10 emojis in its messages).
 *   presses   every #button-log press in the game's channels, including presses that did not save.
 *   checkpoints  the bot's web data at some saves (materialized through a fork, see materialize.ts), and live.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { BOT_STORAGE, shimState, undoFile, type Json } from "./env.ts";
import { applyDelta, isRealPlayer, lineDelta, parseSave, type Delta } from "./savefile.ts";
import type { Snapshot } from "./invariants.ts";

export type ActionKind = "button" | "hidden-button" | "select" | "modal" | "command" | "api" | "rewind" | "system" | "unknown";

export type Action = {
  /** undo index of the save this action produced */
  index: number;
  savedAt: number;
  /** the save's latest_command */
  label: string;
  kind: ActionKind;
  user?: { id: string; username: string; name: string } | null;
  customId?: string;
  buttonLabel?: string;
  /** slash command: name, sub-command path and option text as logged */
  command?: { name: string; path: string[]; text: string; options?: Json[] };
  /** where the press happened (from #button-log) */
  channel?: { id: string; name: string };
  messageId?: string;
  /** text of that message, if the shim still has it */
  messageContent?: string;
  pressedAt?: number;
  /** dice the bot showed for this action (1-10), in posting order */
  dice?: number[];
  /** can the replayer reproduce it from the log alone? */
  replayable: boolean;
  why?: string;
};

export type Press = { t: number; user: string; label: string; customId: string; channelId: string; channelName: string; messageId: string; saveIndex?: number };

export type Recording = {
  version: 1;
  game: string;
  recordedAt: string;
  players: { userId: string; username: string; name: string; faction: string; color: string }[];
  settings: Json;
  saves: { first: number; base: string; steps: { index: number; delta: Delta }[] };
  actions: Action[];
  presses: Press[];
  checkpoints: { index: number | "live"; web: Json }[];
  /** the original game's channels and threads (id -> name) */
  channels: Record<string, string>;
  /** the bot's per-person settings (user_settings/<id>.json) at record time: handlers read them (auto-pass, colours) */
  userSettings?: Record<string, Json>;
  notes: string[];
};

/* ------------------------------------------------------------------------------------------------------------------ */

export function gameChannels(state: Json, game: string): Map<string, string> {
  const out = new Map<string, string>();
  const chans = Object.values(state.channels as Record<string, Json>);
  const mine = (c: Json): boolean => {
    const n = String(c.name ?? "");
    return n.startsWith(`${game}-`) || n.includes(`-${game}-`) || n === game;
  };
  for (const c of chans) if (mine(c)) out.set(c.id, c.name);
  for (const c of chans) if (c.parent_id && out.has(c.parent_id)) out.set(c.id, c.name);
  return out;
}

const LOG_ENTRY = /\*\*__`(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?)\s*`__\*\* (.*?) pressed button (.*?)__\*\*(.*?)\*\*__\s+`\[(.*?)\]` in: \[(.*?)\]\(https:\/\/discord\.com\/channels\/\d+\/(\d+)\/(\d+)\)/s;

/** The bot's #button-log entries (UTC timestamps) for presses in `channels`. */
export function buttonLog(state: Json, channels: Map<string, string>): Press[] {
  const log = Object.values(state.channels as Record<string, Json>).find((c) => c.name === "button-log");
  if (!log) return [];
  const out: Press[] = [];
  for (const m of state.messages[log.id] ?? []) {
    for (const part of String(m.content ?? "").split(/\n\n(?=(?:\[STANDBY [^\]]*\] )?\*\*__`)/)) {
      const x = LOG_ENTRY.exec(part);
      if (!x || !channels.has(x[7])) continue;
      out.push({ t: Date.parse(x[1].replace(" ", "T") + "Z"), user: x[2], label: x[4], customId: x[5], channelName: x[6], channelId: x[7], messageId: x[8] });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

const DIE = /<a?:d10(?:red|grey|green|blue|purple|gray)_(\d)(?:\w*):\d+>/g;

/** Bot messages with dice in the game's channels: [{t, dice}] */
export function diceMessages(state: Json, channels: Map<string, string>): { t: number; dice: number[]; channel: string }[] {
  const out: { t: number; dice: number[]; channel: string }[] = [];
  for (const id of channels.keys()) {
    for (const m of state.messages[id] ?? []) {
      if (!state.users[m.author?.id]?.bot) continue;
      const text = String(m.content ?? "") + JSON.stringify(m.embeds ?? []);
      const dice = [...text.matchAll(DIE)].map((d) => (d[1] === "0" ? 10 : Number(d[1])));
      if (dice.length) out.push({ t: Date.parse(m.timestamp), dice, channel: channels.get(id)! });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

type UserIndex = { byUsername: Map<string, Json>; byName: Map<string, Json>; byId: Map<string, Json> };
export function userIndex(state: Json): UserIndex {
  const byUsername = new Map<string, Json>();
  const byName = new Map<string, Json>();
  const byId = new Map<string, Json>();
  for (const u of Object.values(state.users as Record<string, Json>)) {
    byId.set(u.id, u);
    if (u.username) byUsername.set(String(u.username).toLowerCase(), u);
    if (u.global_name) byName.set(u.global_name, u);
  }
  return { byUsername, byName, byId };
}

const PRESSED = /^(.+?) pressed button: (.*?)(?: \(([^()]*)\))?$/s;
const USED = /^(.+?) used: \/?(.*)$/s;
const USED_KIND = /^(.+?) used (string selection|modal|user selection|entity selection): (.*)$/s;
const CALLED = /^(.+?) called \/api\/game\/[^/]+\/(.*)$/s;

/** Slash command text ("game start_phase specific_phase: statusScoring") -> command name, sub path, typed options. */
export function parseCommand(text: string, state: Json, users: UserIndex): { name: string; path: string[]; options: Json[] | undefined; error?: string } {
  const words = text.trim().split(" ");
  const name = words.shift()!;
  const cmd = Object.values(state.commands as Record<string, Json>).find((c) => c.name === name && (c.type ?? 1) === 1);
  if (!cmd) return { name, path: [], options: undefined, error: `unknown command /${name}` };
  const path: string[] = [];
  let level: Json[] = cmd.options ?? [];
  while (words.length) {
    const sub = level.find((o) => (o.type === 1 || o.type === 2) && o.name === words[0]);
    if (!sub) break;
    path.push(sub.name);
    words.shift();
    level = sub.options ?? [];
  }
  const params = level.filter((o) => o.type >= 3);
  const rest = words.join(" ");
  const opts: Json[] = [];
  if (rest.trim()) {
    const names = params.map((o) => o.name).sort((a, b) => b.length - a.length);
    if (!names.length) return { name, path, options: undefined, error: `cannot parse options "${rest}"` };
    const re = new RegExp(`(?:^|\\s)(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}): `, "g");
    const marks = [...rest.matchAll(re)];
    if (!marks.length || rest.slice(0, marks[0].index).trim()) return { name, path, options: undefined, error: `cannot parse options "${rest}"` };
    marks.forEach((m, i) => {
      const start = m.index! + m[0].length;
      const end = i + 1 < marks.length ? marks[i + 1].index! : rest.length;
      const raw = rest.slice(start, end).trim();
      const def = params.find((o) => o.name === m[1])!;
      let value: unknown = raw;
      if (def.type === 4) value = parseInt(raw, 10);
      else if (def.type === 10) value = Number(raw);
      else if (def.type === 5) value = raw === "true";
      else if (def.type === 6 || def.type === 9) {
        const u = users.byUsername.get(raw.replace(/^@/, "").toLowerCase()) ?? users.byName.get(raw.replace(/^@/, ""));
        value = u?.id ?? raw;
      }
      opts.push({ type: def.type, name: def.name, value });
    });
  }
  let options: Json[] = opts;
  // Sub-command group (type 2) > sub-command (type 1) > options.
  if (path.length === 2) options = [{ type: 2, name: path[0], options: [{ type: 1, name: path[1], options: opts }] }];
  else if (path.length === 1) options = [{ type: 1, name: path[0], options: opts }];
  return { name, path, options };
}

/* ------------------------------------------------------------------------------------------------------------------ */

export function readUndoSaves(game: string, indexes: number[]): { index: number; text: string }[] {
  return indexes.map((index) => ({ index, text: readFileSync(undoFile(game, index), "utf8") }));
}

export function buildRecording(game: string, saves: { index: number; text: string }[], o: { state?: Json } = {}): Recording {
  const state = o.state ?? shimState();
  const users = userIndex(state);
  const channels = gameChannels(state, game);
  const presses = buttonLog(state, channels);
  const dice = diceMessages(state, channels);
  const notes: string[] = [];
  if (!presses.length) notes.push("no #button-log entries for this game (the log keeps only its last 1000 posts): actions come from the saves alone");

  const last = parseSave(saves.at(-1)!.text);
  const players = last.players.filter(isRealPlayer).map((p) => {
    const u = users.byId.get(p.userId);
    return { userId: p.userId, username: u?.username ?? "", name: p.userName, faction: p.kv.get("faction") ?? "", color: p.kv.get("color") ?? "" };
  });
  const settings: Json = {};
  for (const k of ["player_count_for_map", "vp_count", "strategy_card_set", "ac_deck_id", "so_deck_id", "agenda_deck_id", "map_template", "absol_mode", "discordant_stars_mode", "thunders_edge_mode", "base_game_mode", "fow_mode"])
    if (last.game.has(k)) settings[k] = last.game.get(k);

  const used = new Set<Press>();
  const actions: Action[] = [];
  const parsed = saves.map((s) => parseSave(s.text));
  const savedAts = parsed.map((p) => Number(p.game.get("last_modified_date") ?? 0));
  const labels = parsed.map((p) => p.game.get("latest_command") ?? "");
  const facOf = (p: ReturnType<typeof parseSave>) => new Map(p.players.map((pl) => [pl.userId, pl.kv.get("faction") ?? ""]));
  /** Factions whose own player block changed between save i-1 and i (who acted, for hidden presses). */
  const changedFactions = (i: number) => {
    const out = new Set<string>();
    if (i === 0) return out;
    const before = new Map(parsed[i - 1].players.map((pl) => [pl.userId, pl]));
    for (const pl of parsed[i].players) {
      const b = before.get(pl.userId);
      if (!b) continue;
      for (const [k, v] of pl.kv) if (!/turn_time|number_of_turns|thread|stats_/.test(k) && b.kv.get(k) !== v) out.add(pl.kv.get("faction") ?? "");
    }
    return out;
  };
  // Pass 1 claims the presses of visible button saves (exact id and person); hidden ones pick from the rest.
  // A press precedes its save (same clock: the bot writes both); it may precede the previous save when two race.
  const window = (i: number) => (x: Press) => !used.has(x) && x.t <= savedAts[i] + 100 && x.t >= Math.max((savedAts[i - 1] ?? 0) - 1000, savedAts[i] - 120000);
  const claim = (i: number, x: Press | undefined) => {
    if (x) {
      used.add(x);
      x.saveIndex = saves[i].index;
    }
    return x;
  };
  const visible = new Map<number, Press | undefined>();
  for (let i = 1; i < saves.length; i++) {
    const m = PRESSED.exec(labels[i]);
    if (!m || /^someone pressed button: \[CLASSIFIED\]/.test(labels[i])) continue;
    const u = users.byUsername.get(m[1].toLowerCase()) ?? users.byName.get(m[1]);
    visible.set(i, claim(i, presses.filter(window(i)).filter((x) => x.customId === m[3] && (!u || x.user === (u.global_name ?? u.username))).at(-1)));
  }
  const hidden = new Map<number, Press | undefined>();
  for (let i = 1; i < saves.length; i++) {
    if (!/^someone pressed button: \[CLASSIFIED\]/.test(labels[i])) continue;
    const changed = changedFactions(i);
    const fac = facOf(parsed[i]);
    const cands = presses.filter(window(i));
    const acting = cands.filter((x) => changed.has(fac.get(users.byName.get(x.user)?.id ?? "") ?? "-"));
    hidden.set(i, claim(i, (acting.length ? acting : cands).at(-1)));
  }

  let prevSavedAt = 0;
  for (let i = 0; i < saves.length; i++) {
    const savedAt = savedAts[i];
    const label = labels[i];
    const a: Action = { index: saves[i].index, savedAt, label, kind: "unknown", replayable: false };
    const who = (s: string) => {
      const u = users.byUsername.get(s.toLowerCase()) ?? users.byName.get(s);
      return u ? { id: u.id, username: u.username, name: u.global_name ?? u.username } : null;
    };
    const findPress = (_match: (x: Press) => boolean) => visible.get(i) ?? hidden.get(i);
    let m: RegExpExecArray | null;
    if (i === 0) {
      a.kind = "system";
      a.why = "first recorded save (the replay starts from it)";
    } else if (/^⏪|rewound the game|^Rolled back/.test(label)) {
      a.kind = "rewind";
      a.why = "roll-back: the replay resynchronizes to the recorded save";
    } else if (/^(Game created|Created game channels|Milty)/.test(label)) {
      a.kind = "system";
      a.why = "bot-internal save";
    } else if (/^someone pressed button: \[CLASSIFIED\]/.test(label)) {
      a.kind = "hidden-button";
      const press = findPress(() => true);
      if (press) {
        const u = users.byName.get(press.user);
        Object.assign(a, { user: u ? { id: u.id, username: u.username, name: u.global_name } : null, customId: press.customId, buttonLabel: press.label, channel: { id: press.channelId, name: press.channelName }, messageId: press.messageId, pressedAt: press.t });
        a.replayable = !!u;
      } else a.why = "hidden press with no #button-log entry";
    } else if ((m = PRESSED.exec(label))) {
      a.kind = "button";
      a.user = who(m[1]);
      a.buttonLabel = m[2];
      a.customId = m[3];
      const press = findPress((x) => x.customId === m![3] && (!a.user || x.user === a.user.name));
      if (press) Object.assign(a, { channel: { id: press.channelId, name: press.channelName }, messageId: press.messageId, pressedAt: press.t });
      a.replayable = !!(a.user && a.customId);
      if (!a.customId) a.why = "the save does not name the button's id";
    } else if ((m = USED_KIND.exec(label))) {
      a.kind = m[2] === "modal" ? "modal" : "select";
      a.user = who(m[1]);
      a.customId = m[3];
      a.why = `${m[2]} values are not logged`;
    } else if ((m = USED.exec(label))) {
      a.kind = "command";
      a.user = who(m[1]);
      const parsed = parseCommand(m[2], state, users);
      a.command = { name: parsed.name, path: parsed.path, text: m[2], options: parsed.options };
      a.replayable = !!a.user && !parsed.error && !!parsed.options;
      if (parsed.error) a.why = parsed.error;
    } else if ((m = CALLED.exec(label))) {
      a.kind = "api";
      a.user = who(m[1]);
      a.command = { name: `api:${m[2]}`, path: [], text: m[2] };
      a.why = "web API call: its request body is not logged";
    } else a.why = "unrecognized latest_command";
    // Dice posted for this action: after the previous save, up to this save (+ the bot's async posting delay, but
    // never past the next save).
    const until = Math.min(savedAt + 2500, (savedAts[i + 1] ?? Infinity) - 1);
    const d = dice.filter((x) => x.t > prevSavedAt && x.t <= until && (i + 1 >= saves.length || x.t <= savedAts[i + 1] - 1));
    if (d.length && i > 0) a.dice = d.flatMap((x) => x.dice);
    actions.push(a);
    prevSavedAt = savedAt;
  }

  // The text of the message each press was made on: some handlers read it as state (e.g. "Done Gaining Command
  // Tokens" parses "command tokens have gone from 3/3/2" out of its own message), so the replay's carrier repeats it.
  for (const a of actions) {
    if (!a.channel || !a.messageId) continue;
    const m = (state.messages[a.channel.id] ?? []).find((x: Json) => x.id === a.messageId);
    if (m?.content) a.messageContent = String(m.content).slice(0, 1800);
  }

  const base = saves[0].text;
  const steps: { index: number; delta: Delta }[] = [];
  for (let i = 1; i < saves.length; i++) steps.push({ index: saves[i].index, delta: lineDelta(saves[i - 1].text, saves[i].text) });
  return {
    version: 1,
    game,
    recordedAt: new Date().toISOString(),
    players,
    settings,
    saves: { first: saves[0].index, base, steps },
    actions,
    presses,
    checkpoints: [],
    channels: Object.fromEntries(channels),
    userSettings: readUserSettings(players.map((p) => p.userId)),
    notes,
  };
}

function readUserSettings(ids: string[]): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const id of ids) {
    try {
      out[id] = JSON.parse(readFileSync(join(BOT_STORAGE, "user_settings", `${id}.json`), "utf8"));
    } catch {
      /* none */
    }
  }
  return out;
}

/** Save texts of a recording, in order: [{index, text}] */
export function recordingSaves(rec: Recording): { index: number; text: string }[] {
  const out = [{ index: rec.saves.first, text: rec.saves.base }];
  for (const s of rec.saves.steps) out.push({ index: s.index, text: applyDelta(out.at(-1)!.text, s.delta) });
  return out;
}

export function loadRecording(path: string): Recording {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeRecording(path: string, rec: Recording) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(rec, null, 0).replace(/\},\{"index"/g, '},\n{"index"'));
}

/** Snapshots for the invariant checker: every save (with web data where a checkpoint has it) and the live state. */
export function recordingSnapshots(rec: Recording): Snapshot[] {
  const webAt = new Map(rec.checkpoints.map((c) => [c.index, c.web]));
  const labels = new Map(rec.actions.map((a) => [a.index, a.label]));
  const out: Snapshot[] = recordingSaves(rec).map((s) => ({ id: s.index, save: s.text, web: webAt.get(s.index) ?? null, label: labels.get(s.index) }));
  if (webAt.has("live")) out.push({ id: "live", web: webAt.get("live")!, label: "live" });
  return out;
}
