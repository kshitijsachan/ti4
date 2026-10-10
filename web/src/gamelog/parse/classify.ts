import type { Actor, Classification, EventKind, Importance, Phase, Seg } from "../types.ts";
import {
  actorAt,
  actorLabel,
  b,
  emo,
  emojiRef,
  findActor,
  plain,
  richText,
  stripHeading,
  stripPing,
  tidy,
  titleCase,
  txt,
  unitWord,
  unmark,
  who,
} from "./markup.ts";
import { exploreEffect } from "./explore.ts";

/** The parts of a Discord message the log reads, flattened. */
export type LogMessage = {
  id: string;
  channelId: string;
  channelName: string;
  content: string;
  embeds: { title?: string; description?: string; fields?: { name: string; value: string }[] }[];
  attachments: string[];
  hasComponents: boolean;
  bot: boolean;
  ephemeral: boolean;
  time: string;
};

/** An event before the timeline stamps it with id, time, round and phase. */
export type Draft = {
  kind: EventKind;
  importance?: Importance;
  actor?: Actor;
  target?: Actor;
  summary: Seg[];
  details?: Seg[][];
  systemPosition?: string;
  vp?: number;
  /** Key for dropping repeats (undo replays, the same notice posted in a thread and the channel). `{round}` is filled in. */
  dedupe?: string;
  /** Like `dedupe`, but the later event wins (a redone step supersedes the undone one). */
  replaceKey?: string;
};

/** Running state the timeline threads through the rules. */
export type ParseContext = {
  nameOf: (userId: string) => string | undefined;
  agenda?: string;
  lastActivation?: { actor?: Actor; position: string };
  /** The newest explore, so the bot's follow-ups (attachment, "removing an infantry…", declined) fold into its row. */
  lastExplore?: { faction?: string; card: string; summary: Seg[]; settled: boolean; channelId: string; at: number };
  /** Card text from the bot's exploration data, for an explore posted without its card text. */
  exploreText?: (cardName: string) => string | undefined;
};

/** How long after an explore the bot's posts about the same player still count as its follow-ups. */
const EXPLORE_FOLLOW_MS = 10 * 60_000;
/** What the player then chose or got: "gained 1 commodity (0->1/4)", "placed 1 infantry on Bereg", "drew 2 action cards". */
const EXPLORE_RESULT = /^(gained|gains|drew|draws|placed|places|spent|replenished|converted|purged|received|readied|produced|researched|chose|put|added|got)\b/i;

export type Marker = { round?: number; phase?: Phase };

export type Classified = { cls: Classification; drafts: Draft[]; marker?: Marker };

type Rule = (m: LogMessage, ctx: ParseContext) => Classified | null;

export const SC_NAMES: Record<number, string> = {
  1: "Leadership",
  2: "Diplomacy",
  3: "Politics",
  4: "Construction",
  5: "Trade",
  6: "Warfare",
  7: "Technology",
  8: "Imperial",
};

const ev = (drafts: Draft | Draft[], marker?: Marker): Classified => {
  const list = Array.isArray(drafts) ? drafts : [drafts];
  return { cls: { type: "event", kind: list[0]?.kind ?? "other" }, drafts: list, marker };
};
const noise = (rule: string, marker?: Marker): Classified => ({ cls: { type: "noise", rule }, drafts: [], marker });

/** Embed titles look like `<:Public1alt:id>__**Name**__`. */
const lowerFirstWord = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function embedTitle(t: string | undefined): { name: string; emoji?: { id: string; name: string } } | null {
  if (!t) return null;
  const e = t.match(/<a?:(\w+):(\d+)>/);
  return { name: plain(t), emoji: e ? emojiRef(e) : undefined };
}

function scNumbers(src: string): number[] {
  const out: number[] = [];
  for (const m of src.matchAll(/<a?:sc_(\d+)_1:\d+>/g)) out.push(Number(m[1]));
  return out;
}

function scLabel(n: number) {
  return `${n} · ${SC_NAMES[n] ?? "Strategy card"}`;
}

/** `__**Tile: 201 (Cresius/Lazul Rex)**__`, thread `pbd1-round-1-system-201-turn-2-yssaril-vs-mentak`. */
export function combatThread(name: string): { round: number; position: string; sides: string[] } | null {
  const m = name.match(/-round-(\d+)-system-(\w+?)-turn-\d+-(.+)$/);
  if (!m) return null;
  return { round: Number(m[1]), position: m[2], sides: m[3].split("-vs-") };
}

export function roundThread(name: string): { round: number; card?: string } | null {
  const m = name.match(/-round-(\d+)-([A-Za-z]+)$/);
  if (!m) return null;
  return { round: Number(m[1]), card: m[2] };
}

/** One line per `> moved 2 <:fighter:>` etc., summed per unit type. */
function unitTally(lines: string[]): { counts: Map<string, number>; emoji: Map<string, { id: string; name: string }> } {
  const counts = new Map<string, number>();
  const emoji = new Map<string, { id: string; name: string }>();
  for (const line of lines) {
    const m = line.match(/(\d+)\s*<a?:(\w+):(\d+)>/);
    if (!m) continue;
    const unit = m[2].toLowerCase();
    counts.set(unit, (counts.get(unit) ?? 0) + Number(m[1]));
    emoji.set(unit, { name: m[2], id: m[3] });
  }
  return { counts, emoji };
}

function tallySegs(t: ReturnType<typeof unitTally>): Seg[] {
  const out: Seg[] = [];
  for (const [unit, n] of t.counts) {
    if (out.length) out.push(txt(", "));
    out.push(...emo(t.emoji.get(unit)), b(`${n} ${unitWord(unit, n)}`));
  }
  return out;
}

const VOTE_NOISE = [
  /^# Vote Count/,
  /^The game is currently waiting on \d+ players? to decide on/,
  /^# All players have passed on "(when|after)"s/,
  /Current status of votes and outcomes is:/,
  /No current riders or votes have been cast yet/,
  /^These buttons can help with bugs\/issues that occur during the Agenda Phase/,
  /you are being skipped because/,
  /up to vote! Please use the buttons/,
  /There are no shenanigans possible/,
  /No player can legally play _Bribery_/,
  /Please (play or )?confirm (that you will not be playing|no) /,
  /You may hold while people resolve shenanigans/,
  /don't forget you now have to decide on whether you will play any more/,
  /all players have indicated "No Sabotage"/,
  /^Agenda put on (top|bottom)/,
  /^All planets have been readied at the end of the Agenda Phase/,
  /It will will now be revealed for the purposes of revoting/,
];

const PLAIN_NOISE: [RegExp, string][] = [
  // Async-play nudges and Discord housekeeping: everyone is at the table here.
  [/this is a gentle reminder that it is your turn|this is a quick nudge in case you forgot|This is a nudge that the "\w+" queue/, "async nudge"],
  [/^Role deleted: /, "role notice"],
  [/had queued a strategy card pick\.?$/, "async queue"],
  [/^Whispers have been disabled/, "whispers"],
  [/you need to assign speaker first before drawing agendas|The bot thinks that a public objective was already revealed/, "bot refusal"],
  [/\b\w+(Exception|Error): /, "bot error"],
  [/^- actions channel\b|^This channel is for taking actions in the game/, "channel intro"],
  [/^Reminder that all games played on this server must abide/, "code of conduct"],
  [/^The button failed\. An exception has been logged/, "bot error"],
  [/^Map Image sent to /, "map link"],
  [/^Here are the quick reference cards for the factions/, "reference cards"],
  [/^New Thread for /, "thread notice"],
  [/^Resolve combat in this thread:?$/, "combat thread pointer"],
  [/^## Generating the milty draft/, "draft setup"],
  [/^# \*\*__Draft (Settings|Picks So Far)/, "draft board"],
  [/^Set game to use /, "expansion choice"],
  [/^(frontier tokens have been added|\d+ secret objectives? dealt|dealt to all players)/, "setup step"],
  [/frontier tokens have been added to empty spaces/, "setup step"],
  [/dealt to all players\. Check your/, "setup step"],
  [/^set order in the following way/, "speaker order"],
  [/^__Turn Order:__/, "turn order"],
  [/^## __Following Summary__/, "following summary"],
  [/^All players have reacted to this strategy card/, "following done"],
  [/^The \*\*\w+\*\* player is neighbors with/, "trade neighbours"],
  [/^These buttons will work inside the thread/, "thread buttons"],
  [/^Please score objectives\./, "scoring prompt"],
  [/^# __Scoring Summary__/, "scoring summary"],
  [/cannot score any public objectives according to the bot/, "auto no-score"],
  [/has opted not to score a (secret|public) objective/, "no-score"],
  [/^\*\*Status Cleanup Run!\*\*/, "status cleanup"],
  [/all players have indicated completion of Status Phase/, "status done"],
  [/is ready for (strategy|agenda) phase\.?$/, "ready"],
  [/^Resolve status homework using the buttons/, "status homework"],
  [/ended turn\.$/, "ended turn"],
  [/^Use buttons to (do your turn|resolve)/, "turn buttons"],
  [/your opponent has (no action cards to play|finished assigning hits)/, "combat hint"],
  [/you may roll dice for Combat Round/, "combat hint"],
  [/^## __Start of Combat Round #\d+__/, "combat round header"],
  [/, you suffered \d+ hits? in round #\d+/, "hits notice"],
  [/^__\*\*Tile: /, "combat tile summary"],
  [/^There are no units in space on tile/, "combat hint"],
  [/^Buttons (for|to) /, "combat buttons"],
  [/is up to pick their strategy card/, "pick prompt"],
  [/^### .* is up to draft!/, "draft prompt"],
  [/^You are not up to draft/, "draft prompt"],
  [/the draft is finished!/, "draft done"],
  [/ found an _[^_]+_ on /, "explore echo"],
  [/declined exploration card/, "explore declined"],
  [/you may (pay \d+ resources to DEPLOY|force players to replenish)/, "optional prompt"],
  [/Please resolve these before doing anything else/, "reminder"],
  [/^You currently have \d+ command tokens in your strategy pool/, "token reminder"],
  [/^Image of /, "image"],
  [/has units in the system\.?$/, "activation note"],
  [/Ping (jazz|bothelper)|ping a bothelper/i, "help text"],
  [/^## Generating nucleus and slices/, "draft setup"],
  [/should receive a reminder ping as well/, "combat reminder"],
  [/^🛑/, "bot warning"],
  [/^Added \d+ trade goods? to \*\*\w+\*\*\. There (is|are) now/, "unpicked card bonus"],
  [/^Secret objective shown to player/, "secret shown"],
  [/a reminder that you should declare/, "reminder"],
  [/It looks like you are playing with Thunder's Edge/, "rules help"],
  [/be sure to wait for \w+ to setup/, "help text"],
  [/please purge \d+ relic fragments/, "purge prompt"],
  [/^Press this button /, "prompt"],
  [/^(How would you like to set up|These buttons can help you setup)/, "setup prompt"],
  [/^## Which expansion are you using/, "setup prompt"],
  [/^\*\*__(Slices|Factions|Speaker Order):__\*\*/, "draft board"],
];

/**
 * A slash command the bot echoes (`/add_units tile_name: 101 unit_names: 2 dd, ca`) as words a player reads
 * ("add units: 101, 2 dd, ca") — there is no command line here, so the `/command option:` syntax means nothing.
 */
export function commandText(cmd: string): string {
  const s = cmd.trim().replace(/^\//, "");
  const firstOpt = s.search(/\b\w+: /);
  const name = (firstOpt < 0 ? s : s.slice(0, firstOpt)).trim().replace(/_/g, " ");
  if (firstOpt < 0) return name;
  const values = s
    .slice(firstOpt)
    .split(/\b\w+: /)
    .map((v) => v.trim())
    .filter(Boolean);
  return `${name}: ${values.join(", ")}`;
}

const rules: Rule[] = [
  // Phase markers -----------------------------------------------------------------------------------------
  (m) => {
    const banner = m.attachments.map((a) => a.match(/^(strategy|action|status|agenda)(\d+)banner/)).find(Boolean);
    if (!banner || m.content.trim()) return null;
    // agendaNbanner counts agendas (1st/2nd), not rounds.
    if (banner[1] === "agenda") return noise("phase banner", { phase: "agenda" });
    return noise("phase banner", { round: Number(banner[2]), phase: banner[1] as Phase });
  },
  (m) => {
    const r = m.content.match(/^Started Round (\d+)/);
    return r ? noise("round start", { round: Number(r[1]), phase: "strategy" }) : null;
  },
  (m) => (/^All players have picked a strategy card/.test(m.content) ? noise("picks done", { phase: "action" }) : null),
  (m) => (/^All players have passed\.?$/.test(m.content.trim()) ? noise("all passed", { phase: "status" }) : null),

  // Rewind / undo from the web (bot/patches: UndoService) -----------------------------------------------------
  (m) => {
    if (!m.content.startsWith("\u23EA")) return null;
    const hit = actorAt(m.content.slice(1));
    const rest = hit?.rest ?? m.content.slice(1);
    const rw = rest.match(/rewound the game to just after: \*\*(.+?)\*\*/);
    if (rw) return ev({ kind: "edit", importance: 3, actor: hit?.actor, summary: [txt("rewound the game to just after "), b(rw[1])] });
    const un = rest.match(/undid: \*\*(.+?)\*\*/);
    if (un) {
      // Undoing a rewind: the undone step is the rewind notice itself ("⏪ Solo rewound the game to: …").
      const rewind = un[1].match(/rewound the game to(?: just after)?:?\s*(.+)$/);
      if (rewind) return ev({ kind: "edit", importance: 2, actor: hit?.actor, summary: [txt("undid the rewind to "), b(rewind[1])] });
      return ev({ kind: "edit", importance: 2, actor: hit?.actor, summary: [txt("undid "), b(un[1])] });
    }
    return null;
  },

  // Edits -------------------------------------------------------------------------------------------------
  (m) => {
    const c = m.content.match(/^```(?:sus|notSus)?\n?(.+?) used (\/[^\n`]+)\n?```/s);
    if (!c) return null;
    return ev({ kind: "edit", importance: 1, actor: { name: c[1].trim() }, summary: [txt("edited the game: "), b(commandText(c[2]))] });
  },

  // Setup / draft ----------------------------------------------------------------------------------------
  (m, ctx) => {
    const d = m.content.match(/^<@!?(\d+)> drafted (.+?)!?$/s);
    if (!d) return null;
    const what = d[2];
    const faction = what.match(/^<a?:(\w+):(\d+)>\s*(.+)$/);
    const actor: Actor = { userId: d[1], name: ctx.nameOf(d[1]) };
    if (faction) {
      actor.faction = faction[1].toLowerCase();
      actor.factionEmoji = emojiRef(faction);
      return ev({ kind: "setup", actor, summary: [txt("drafted "), b(plain(faction[3]))] });
    }
    return ev({ kind: "setup", importance: 1, actor, summary: [txt("drafted "), b(plain(what))] });
  },
  (m, ctx) => {
    const d = m.content.match(/^<@!?(\d+)> only had one option available to draft, so they were given (.+?)!/);
    if (!d) return null;
    return ev({ kind: "setup", importance: 1, actor: { userId: d[1], name: ctx.nameOf(d[1]) }, summary: [txt("took "), b(d[2])] });
  },
  (m) => {
    const p = m.content.match(/^Player: (.+) has been set up/);
    const hit = p && actorAt(p[1]);
    if (!hit) return null;
    return ev({ kind: "setup", importance: 1, actor: hit.actor, summary: [txt("set up as "), b(hit.actor.color ?? "")], replaceKey: `setup:${hit.actor.faction}` });
  },

  // Speaker ----------------------------------------------------------------------------------------------
  (m) => {
    const s = m.content.match(/Speaker (?:has been )?assigned to:? (.+)$/s);
    if (!s) return null;
    const hit = actorAt(s[1], true);
    return ev({ kind: "speaker", actor: hit?.actor, summary: [txt("became "), b("speaker")], dedupe: `speaker:${hit?.actor.faction}` });
  },

  // Strategy cards ----------------------------------------------------------------------------------------
  (m) => {
    const hit = actorAt(m.content);
    if (!hit || !/^picked <a?:sc_\d+_1:/.test(hit.rest)) return null;
    const n = scNumbers(hit.rest)[0];
    return ev({ kind: "sc_pick", actor: hit.actor, summary: [txt("picked "), b(scLabel(n))] });
  },
  (m) => {
    const p = m.content.match(/^((?:<a?:sc_\d+_\d+:\d+>⁠?)+) played by (.+?)\.\s*(?:\n|$)/);
    if (!p) return null;
    const hit = actorAt(p[2]);
    const n = scNumbers(p[1])[0];
    return ev({ kind: "sc_play", importance: 2, actor: hit?.actor, summary: [txt("played "), b(scLabel(n))] });
  },
  (m) => {
    const hit = actorAt(m.content);
    const f = hit?.rest.match(/^following to perform the secondary ability of \*\*(\w+)\*\*/);
    if (!hit || !f) return null;
    return ev({ kind: "sc_follow", actor: hit.actor, summary: [txt("followed "), b(f[1])] });
  },
  (m) => {
    const hit = actorAt(m.content);
    const f = hit?.rest.match(/^is not following \*\*(\w+)\*\*/);
    if (!hit || !f) return null;
    return ev({ kind: "sc_follow", importance: 1, actor: hit.actor, summary: [txt("did not follow "), b(f[1])] });
  },

  // Turns ------------------------------------------------------------------------------------------------
  (m) => {
    const hit = actorAt(m.content);
    const t = hit?.rest.match(/^it is now your turn \(your (\d+)\w* turn of round (\d+)\)/);
    if (!hit || !t) return null;
    return ev({ kind: "turn", importance: 1, actor: hit.actor, summary: [txt("started turn "), b(t[1])] }, { round: Number(t[2]), phase: "action" });
  },
  (m) => {
    const hit = actorAt(m.content);
    if (!hit || !/^has passed\.?$/.test(hit.rest.trim())) return null;
    return ev({ kind: "pass", actor: hit.actor, summary: [b("passed")] });
  },

  // Tactical action -------------------------------------------------------------------------------------
  (m, ctx) => {
    const hit = actorAt(m.content);
    const a = hit?.rest.match(/^activated (\w+) \(([^)]*)\)/);
    if (!hit || !a) return null;
    ctx.lastActivation = { actor: hit.actor, position: a[1] };
    return ev({
      kind: "activate",
      actor: hit.actor,
      systemPosition: a[1],
      summary: [txt("activated "), b(a[2] || a[1])],
    });
  },
  (m, ctx) => {
    const t = m.content.match(/^## Tactical Action in system (\w+) \(([^)]*)\):/);
    if (!t) return null;
    const lines = m.content.split("\n");
    const moved = lines.filter((l) => /^>\s*moved /.test(l));
    const tally = unitTally(moved);
    const details: Seg[][] = [];
    let from: Seg[] | null = null;
    let fromLines: string[] = [];
    const flush = () => {
      if (from && fromLines.length) details.push([...from, txt(": "), ...tallySegs(unitTally(fromLines))]);
      fromLines = [];
    };
    for (const l of lines) {
      const f = l.match(/^From system (\w+) \(([^)]*)\)/);
      if (f) {
        flush();
        from = [txt("from "), b(f[2]), txt(` (${f[1]})`)];
      } else if (/^>\s*moved /.test(l)) fromLines.push(l);
    }
    flush();
    const actor = ctx.lastActivation?.position === t[1] ? ctx.lastActivation.actor : undefined;
    return ev({
      kind: "move",
      actor,
      systemPosition: t[1],
      summary: tally.counts.size ? [txt("moved "), ...tallySegs(tally), txt(" into "), b(t[2] || t[1])] : [txt("moved into "), b(t[2] || t[1])],
      details,
    });
  },
  (m) => {
    const hit = actorAt(m.content, true);
    const l = hit?.rest.match(/^landed (\d+) (\w+) on (.+?)\.?$/);
    if (!hit || !l) return null;
    return ev({ kind: "land", actor: hit.actor, summary: [txt("landed "), b(`${l[1]} ${unitWord(l[2], Number(l[1]))}`), txt(" on "), b(l[3])] });
  },
  (m) => {
    const hit = actorAt(m.content, true);
    const p = hit?.rest.match(/^(placed|produced|deployed) (\d+) (?:<a?:(\w+):\d+>|(\w+(?: \w+)?)) (?:on|in) (.+?)\.?$/i);
    if (!hit || !p) return null;
    const unit = p[3] ?? p[4] ?? "unit";
    return ev({ kind: "produce", actor: hit.actor, summary: [txt(`${p[1].toLowerCase()} `), b(`${p[2]} ${unitWord(unit, Number(p[2]))}`), txt(" on "), b(unmark(p[5]).replace(/\s*\([\d/]+\)$/, ""))] });
  },
  (m) => {
    const hit = actorAt(m.content, true);
    const p = hit?.rest.match(/^is producing units in (.+?)(?: in the space area| on the planet (.+?))?\.\n/s);
    if (!hit || !p) return null;
    const lines = m.content.split("\n").slice(1).filter((l) => /\d/.test(l));
    const tally = unitTally(lines);
    const where = plain(p[2] ?? p[1]);
    return ev({
      kind: "produce",
      actor: hit.actor,
      summary: tally.counts.size ? [txt("produced "), ...tallySegs(tally), txt(" in "), b(where)] : [txt("is producing in "), b(where)],
      details: lines.map((l) => richText(l.replace(/^>\s*/, ""))),
    });
  },
  (m) => {
    const hit = actorAt(m.content);
    if (!hit || !/^exhausted the following:/.test(hit.rest)) return null;
    const total = m.content.match(/for a total spend of (.+?)(?:\.|\n|$)/);
    const lines = m.content.split("\n").filter((l) => l.startsWith(">"));
    return ev({
      kind: "resources",
      importance: 1,
      actor: hit.actor,
      summary: [txt("spent "), b(total ? unmark(total[1]) : `${lines.length} planets`)],
      details: lines.map((l) => richText(l.replace(/^>\s*/, ""))),
    });
  },

  // Hand limit -------------------------------------------------------------------------------------------
  (m) => {
    const hit = findActor(m.content);
    const at = m.content.match(/exceeding the action card hand limit of (\d+)/);
    if (!at) return null;
    return ev({ kind: "action_card", actor: hit?.actor, summary: [txt("is over the action card hand limit of "), b(at[1]), txt(" — discarding down")] });
  },

  // Explore ----------------------------------------------------------------------------------------------
  (m, ctx) => {
    const hit = actorAt(m.content);
    const x = hit?.rest.match(/^explored (?:<a?:(\w+):\d+>)?\s*Planet (?:<a?:\w+:\d+>)?\s*([^<]+?)\s*(?:<.*)? in tile (\w+):?/);
    if (!hit || !x) return null;
    const planet = x[2].trim();
    const card = embedTitle(m.embeds[0]?.title);
    const desc = m.embeds[0]?.description || (card && ctx.exploreText?.(card.name)) || "";
    const summary: Seg[] = [txt("explored "), b(planet)];
    if (x[1] && /^(hazardous|industrial|cultural|frontier)$/i.test(x[1])) summary.push(txt(` (${x[1].toLowerCase()})`));
    if (card) {
      summary.push(txt(" → "), b(card.name));
      const effect = exploreEffect(card.name, plain(desc), planet);
      if (effect) summary.push(txt(`: ${effect}`));
      ctx.lastExplore = { faction: hit.actor.faction, card: card.name, summary, settled: false, channelId: m.channelId, at: Date.parse(m.time) || 0 };
    }
    return ev({ kind: "explore", actor: hit.actor, systemPosition: x[3], summary, details: desc ? [richText(desc)] : undefined });
  },
  (m, ctx) => {
    const hit = actorAt(m.content);
    const x = hit?.rest.match(/^explored the frontier token in (.+?)(?:[:.]|$)/s);
    if (!hit || !x) return null;
    const card = embedTitle(m.embeds[0]?.title);
    const desc = m.embeds[0]?.description || (card && ctx.exploreText?.(card.name)) || "";
    const summary: Seg[] = [txt("explored the frontier in "), b(plain(x[1]))];
    if (card) {
      summary.push(txt(" → "), b(card.name));
      const effect = exploreEffect(card.name, plain(desc));
      if (effect) summary.push(txt(`: ${effect}`));
      ctx.lastExplore = { faction: hit.actor.faction, card: card.name, summary, settled: false, channelId: m.channelId, at: Date.parse(m.time) || 0 };
    }
    return ev({ kind: "explore", actor: hit.actor, summary, details: desc ? [richText(desc)] : undefined });
  },
  // The bot's follow-ups to an explore fold into its row.
  (m, ctx) => {
    const last = ctx.lastExplore;
    if (!last || last.settled) return null;
    if (m.channelId !== last.channelId) return null;
    if ((Date.parse(m.time) || 0) - last.at > EXPLORE_FOLLOW_MS) {
      last.settled = true;
      return null;
    }
    const a = m.content.match(/^Attachment _([^_]+)_ added to /);
    if (a && a[1] === last.card) return noise("explore attachment (folded)");
    const hit = actorAt(m.content, true);
    if (!hit || (last.faction && hit.actor.faction !== last.faction)) return null;
    if (/^declined exploration card/.test(hit.rest)) {
      last.settled = true;
      last.summary.push(txt(" — declined"));
      return noise("explore declined (folded)");
    }
    const r = hit.rest.match(/^is removing an infantry to resolve _([^_]+)_\.?\s*(.*)$/s);
    if (r && r[1] === last.card) {
      last.settled = true;
      const gained = plain(r[2]).replace(/\s*->\s*/g, " → ").replace(/\.$/, "");
      last.summary.push(txt(` — removed 1 infantry${gained ? `; ${lowerFirstWord(gained)}` : ""}`));
      return noise("explore resolved (folded)");
    }
    if (/^ended turn/.test(hit.rest)) {
      last.settled = true;
      return null;
    }
    if (EXPLORE_RESULT.test(hit.rest.trim())) {
      last.settled = true;
      const got = plain(hit.rest).replace(/\s*->\s*/g, " → ").replace(/\.$/, "");
      last.summary.push(txt(` — ${lowerFirstWord(got)}`));
      return noise("explore result (folded)");
    }
    return null;
  },
  (m) => {
    const a = m.content.match(/^Attachment _([^_]+)_ added to (.+?)\.?$/s);
    if (!a) return null;
    return ev({ kind: "explore", importance: 1, summary: [b(a[1]), txt(" attached to "), b(plain(a[2]))] });
  },

  // Combat -----------------------------------------------------------------------------------------------
  (m) => {
    const c = m.content.match(/^(.+?), please resolve the interaction here\./s);
    if (!c) return null;
    const thread = combatThread(m.channelName);
    const first = actorAt(c[1]);
    const second = first ? actorAt(first.rest) : null;
    const tile = m.content.match(/system (\w+)/);
    return ev({
      kind: "combat",
      importance: 3,
      actor: first?.actor,
      target: second?.actor,
      systemPosition: thread?.position ?? tile?.[1],
      summary: [txt("started combat"), ...(second ? [txt(" against "), who(second.actor)] : [])],
    });
  },
  (m) => {
    const hit = actorAt(m.content, true);
    const r = hit?.rest.match(/^rolls for (.+?) (combat|ANTI-FIGHTER BARRAGE|AFB|SPACE CANNON[\w ]*|bombardment)\s*(?:\(round #(\d+)\))?/i);
    if (!hit || !r) return null;
    const total = m.content.match(/\*\*Total hits (\d+)\*\*/);
    const hits = total ? Number(total[1]) : 0;
    const lines = m.content.split("\n").filter((l) => l.startsWith(">"));
    const kindWord = /combat/i.test(r[2]) ? (r[3] ? `round ${r[3]}` : "combat") : r[2].toLowerCase();
    const thread = combatThread(m.channelName);
    return ev({
      kind: "combat",
      actor: hit.actor,
      systemPosition: thread?.position,
      summary: [txt("rolled "), b(`${hits} hit${hits === 1 ? "" : "s"}`), txt(` (${kindWord})`)],
      details: lines.map((l) => richText(l.replace(/^>\s*/, ""))),
    });
  },
  (m) => {
    const hit = actorAt(m.content, true);
    if (!hit || !/^assigned (?:the )?hits? in the following way:/.test(hit.rest)) return null;
    const lines = m.content.split("\n").filter((l) => l.startsWith(">"));
    const lost = unitTally(lines.filter((l) => /Destroyed|Removed/i.test(l)));
    const sustained = unitTally(lines.filter((l) => /Sustained/i.test(l)));
    const summary: Seg[] = [];
    if (lost.counts.size) summary.push(txt("lost "), ...tallySegs(lost));
    if (sustained.counts.size) summary.push(txt(summary.length ? "; sustained " : "sustained "), ...tallySegs(sustained));
    if (!summary.length) summary.push(txt("assigned hits"));
    const thread = combatThread(m.channelName);
    return ev({ kind: "combat", actor: hit.actor, systemPosition: thread?.position, summary, details: lines.map((l) => richText(l.replace(/^>\s*/, ""))) });
  },
  (m) => {
    const hit = actorAt(m.content);
    const d = hit?.rest.match(/^destroyed (\d+) (\w+) in tile (\w+)(?: \(([^)]*)\))?/);
    if (!hit || !d) return null;
    return ev({ kind: "combat", actor: hit.actor, systemPosition: d[3], summary: [txt("destroyed "), b(`${d[1]} ${unitWord(d[2], Number(d[1]))}`), txt(" in "), b(d[4] ?? d[3])] });
  },

  // Planets ----------------------------------------------------------------------------------------------
  (m) => {
    const hit = actorAt(m.content, true);
    const p = hit?.rest.match(/^(?:has )?(gained|took|acquired|lost) control of (?:the )?(.+?)(?: \(and could perhaps[^)]*\))?\.?$/s);
    if (!hit || !p) return null;
    const verb = p[1] === "lost" ? "lost " : "gained ";
    return ev({ kind: "planet", actor: hit.actor, summary: [txt(verb), b(plain(p[2]))] });
  },

  // Tech -------------------------------------------------------------------------------------------------
  (m) => {
    const hit = actorAt(m.content, true);
    const t = hit?.rest.match(/^acquired the technology (?:<a?:(\w+):(\d+)>)?\s*_?([^_.]+)_?\.?/);
    if (!hit || !t) return null;
    const summary: Seg[] = [txt("researched "), ...(t[1] ? emo({ name: t[1], id: t[2] }) : []), b(t[3].trim())];
    return ev({ kind: "tech", actor: hit.actor, summary });
  },

  // Objectives -------------------------------------------------------------------------------------------
  (m) => {
    const objectives = m.embeds.filter((e) => /<a?:Public[12]\w*:\d+>/.test(e.title ?? ""));
    if (!objectives.length || m.content.trim()) return null;
    return ev(
      objectives.map((e) => {
        const t = embedTitle(e.title)!;
        const stage = /Public2/.test(e.title ?? "") ? "Stage II" : "Stage I";
        return {
          kind: "objective" as const,
          importance: 3 as const,
          summary: [txt(`${stage} objective revealed: `), ...emo(t.emoji), b(t.name)],
          details: e.description ? [richText(e.description.replace(/\n-#.*$/s, ""))] : undefined,
          dedupe: `po:${t.name}`,
        };
      }),
    );
  },
  (m) => (/(?:two |a )?stage \d public objectives? (?:have|has) been revealed/.test(stripPing(stripHeading(m.content))) ? noise("objective reveal heading") : null),
  (m) => (/^<a?:Public[12]alt:\d+>_[^_]+_ - .+\(\d VP\)/.test(m.content) ? noise("objective progress") : null),
  (m) => {
    const hit = actorAt(m.content);
    const s = hit?.rest.match(/^scored (?:(<a?:(\w+):\d+>)\s*)?(?:Custom )?_([^_]+)_/);
    if (!hit || !s) return null;
    const emojiName = s[2] ?? "";
    const secret = /Secret/i.test(emojiName);
    const vp = /Public2/.test(emojiName) ? 2 : 1;
    const label = secret ? "secret objective" : /Public2/.test(emojiName) ? "Stage II" : /Public1/.test(emojiName) ? "Stage I" : "";
    const emoji = s[1]?.match(/<a?:(\w+):(\d+)>/);
    return ev({
      kind: "objective",
      importance: 3,
      actor: hit.actor,
      vp,
      dedupe: `scored:${hit.actor.faction}:${s[3]}`,
      summary: [txt("scored "), ...(emoji ? emo(emojiRef(emoji)) : []), b(s[3]), ...(label ? [txt(` (${label})`)] : [])],
    });
  },
  (m) => {
    const hit = actorAt(m.content);
    if (!hit) return null;
    if (/^drew (?:a|1) secret objective as the elected player/.test(hit.rest)) {
      return ev({ kind: "objective", actor: hit.actor, summary: [txt("drew a "), b("secret objective"), txt(" (elected)")] });
    }
    if (/^drew (?:a|1|their queued) secret objective/.test(hit.rest)) {
      return ev({ kind: "objective", importance: 1, actor: hit.actor, summary: [txt("drew a "), b("secret objective")] });
    }
    if (/^discarded a secret objective/.test(hit.rest)) {
      return ev({ kind: "objective", importance: 1, actor: hit.actor, summary: [txt("discarded a "), b("secret objective")] });
    }
    return null;
  },
  (m) => (/is picking up a secret objective that they accidentally discarded/.test(m.content) ? noise("secret fixup") : null),

  // Agenda -----------------------------------------------------------------------------------------------
  (m, ctx) => {
    if (!/an agenda has been revealed/.test(m.content)) return null;
    const e = m.embeds[0];
    const t = embedTitle(e?.title);
    if (!t) return noise("agenda heading", { phase: "agenda" });
    ctx.agenda = t.name;
    const type = e?.description?.match(/^\*\*(Law|Directive):\*\*\s*\*([^*]+)\*/);
    const summary: Seg[] = [txt("Agenda revealed: "), ...emo(t.emoji), b(t.name)];
    if (type) summary.push(txt(` (${type[1]} · ${type[2]})`));
    const body = e?.description?.split("\n").slice(1).join("\n").trim();
    return ev({ kind: "agenda", importance: 3, summary, details: body ? body.split("\n").map((l) => richText(l)) : undefined }, { phase: "agenda" });
  },
  (m) => {
    const hit = actorAt(m.content, true);
    const v = m.content.match(/For a total of \*\*(\d+)\*\* votes? on the outcome "([^"]+)"/);
    if (!hit || !v || !/^used the following/.test(hit.rest)) return null;
    const lines = m.content.split("\n").filter((l) => l.startsWith(">"));
    return ev({ kind: "agenda", actor: hit.actor, summary: [txt("voted "), b(v[1]), txt(" for "), b(v[2])], details: lines.map((l) => richText(l.replace(/^>\s*/, ""))) });
  },
  (m) => {
    const hit = actorAt(m.content);
    if (!hit || !/^abstained\.?$/.test(hit.rest.trim())) return null;
    return ev({ kind: "agenda", importance: 1, actor: hit.actor, summary: [b("abstained")] });
  },
  (m) => {
    const hit = actorAt(m.content);
    const r = hit?.rest.match(/^chose to put an? (.+?) on "([^"]+)"/);
    if (!hit || !r) return null;
    return ev({ kind: "agenda", actor: hit.actor, summary: [txt("put a "), b(r[1]), txt(" on "), b(r[2])] });
  },
  (m) => {
    const hit = actorAt(stripHeading(m.content));
    const r = hit?.rest.match(/^had \*\*Politics\*\* and placed the agendas in this order: (.+?)\.?$/);
    if (!hit || !r) return null;
    return ev({ kind: "agenda", importance: 1, actor: hit.actor, summary: [txt("placed the agendas: "), b(r[1])] });
  },
  (m) => {
    const hit = actorAt(m.content);
    const r = hit?.rest.match(/^drew (\d+) agendas?/);
    if (!hit || !r) return null;
    return ev({ kind: "agenda", importance: 1, actor: hit.actor, summary: [txt("looked at the top "), b(`${r[1]} agendas`)] });
  },
  (m) => {
    const t = stripHeading(m.content).match(/^The speaker has broken the tie for "([^"]+)"/);
    return t ? ev({ kind: "agenda", summary: [txt("Speaker broke the tie for "), b(t[1])] }) : null;
  },
  (m, ctx) => {
    const r = m.content.match(/^Resolving vote for "([^"]+)"/);
    if (!r) return null;
    const summary: Seg[] = ctx.agenda ? [b(ctx.agenda), txt(" resolved: "), b(r[1])] : [txt("Agenda resolved: "), b(r[1])];
    return ev({ kind: "agenda", importance: 3, summary });
  },
  (m, ctx) => {
    if (!/Added law to map!/.test(m.content)) return null;
    return ev({ kind: "agenda", importance: 3, summary: ctx.agenda ? [b(ctx.agenda), txt(" is now "), b("law")] : [txt("A "), b("law"), txt(" was enacted")] });
  },
  (m) => {
    const r = stripHeading(m.content).match(/^Repealed the _([^_]+)_ law/);
    return r ? ev({ kind: "agenda", importance: 3, summary: [txt("Law repealed: "), b(r[1])] }) : null;
  },
  (m) => (VOTE_NOISE.some((re) => re.test(m.content) || re.test(stripPing(stripHeading(m.content)))) ? noise("agenda bookkeeping") : null),
  (m) => (/^# _[^_]+_\s*\n/.test(m.content) ? noise("agenda status") : null),

  // Action cards -----------------------------------------------------------------------------------------
  (m) => {
    const src = stripPing(m.content);
    const hit = actorAt(src);
    const p = hit?.rest.match(/^played the action card _([^_]+)_/);
    if (!hit || !p) return null;
    const desc = m.embeds[0]?.description?.trim();
    return ev({ kind: "action_card", actor: hit.actor, summary: [txt("played "), b(p[1])], details: desc ? [richText(desc.replace(/\n+/g, " "))] : undefined });
  },
  (m) => {
    const hit = actorAt(m.content);
    const p = hit?.rest.match(/^discarded the action card _([^_]+)_/);
    if (!hit || !p) return null;
    return ev({ kind: "action_card", importance: 1, actor: hit.actor, summary: [txt("discarded "), b(p[1])] });
  },
  (m) => {
    const hit = actorAt(m.content);
    const d = hit?.rest.match(/^(?:drew (\d+) action cards?|Drawing `(\d+)` action cards for status phase)/);
    if (!hit || !d) return null;
    const n = Number(d[1] ?? d[2]);
    const replaceKey = d[2] ? `status-ac:${hit.actor.faction}:{round}` : undefined;
    return ev({ kind: "action_card", importance: 1, actor: hit.actor, summary: [txt("drew "), b(`${n} action card${n === 1 ? "" : "s"}`)], replaceKey });
  },

  // Transactions -----------------------------------------------------------------------------------------
  (m) => {
    if (!/^A transaction has been ratified:/.test(m.content)) return null;
    const blocks = m.content.split(/\n\s*\n/).map((blk) => blk.split("\n").filter((l) => l.startsWith(">")));
    const sides = blocks
      .map((lines) => {
        const head = lines[0]?.replace(/^>\s*/, "").match(/^(.+?) gives:/);
        if (!head) return null;
        const hit = actorAt(head[1], true);
        const nameMatch = head[1].match(/>([^<>]+)$/);
        const actor: Actor = hit?.actor ?? {};
        if (nameMatch && !actor.name) actor.name = nameMatch[1].trim();
        const items = lines.slice(1).map((l) => describeItem(l.replace(/^>\s*-\s*/, "")));
        return { actor, items };
      })
      .filter((s): s is { actor: Actor; items: string[] } => !!s);
    const [a, bSide] = sides;
    if (!a) return ev({ kind: "transaction", summary: [txt("A "), b("transaction"), txt(" was ratified")] });
    const short = (items: string[]) => {
      const j = items.join(", ") || "nothing";
      return j.length > 48 ? `${j.slice(0, 46)}…` : j;
    };
    const summary: Seg[] = [txt("traded with "), ...(bSide ? [who(bSide.actor)] : [b("someone")])];
    if (bSide) summary.push(txt(": "), b(short(a.items)), txt(" for "), b(short(bSide.items)));
    const details = sides.map((s) => [who(s.actor), txt(" gave: "), b(s.items.join(", ") || "nothing")]);
    return ev({ kind: "transaction", actor: a.actor, target: bSide?.actor, summary, details });
  },
  (m) => {
    const hit = actorAt(m.content);
    const o = hit?.rest.match(/^sent a transaction offer to (.+?)\.?$/);
    if (!hit || !o) return null;
    const to = actorAt(o[1]);
    return ev({ kind: "transaction", importance: 1, actor: hit.actor, target: to?.actor, summary: [txt("offered a deal to "), to ? who(to.actor) : b(plain(o[1]))] });
  },
  (m) => {
    const hit = actorAt(m.content);
    const o = hit?.rest.match(/^sent a promissory note to the hand of (.+?)\.?$/);
    if (!hit || !o) return null;
    const to = actorAt(o[1]);
    return ev({ kind: "transaction", importance: 1, actor: hit.actor, target: to?.actor, summary: [txt("sent a "), b("promissory note"), txt(" to "), to ? who(to.actor) : b(plain(o[1]))] });
  },

  // Leaders, relics, abilities ---------------------------------------------------------------------------
  (m) => {
    if (!/^Exhausted:/.test(m.content.trim())) return null;
    const t = embedTitle(m.embeds[0]?.title);
    const name = t?.name ?? m.content.replace(/^Exhausted:\s*/, "");
    const actor = t?.emoji ? { faction: t.emoji.name.toLowerCase(), factionEmoji: t.emoji } : undefined;
    return ev({ kind: "leader", actor, summary: [txt("exhausted "), b(name.replace(/\s*\(.*?\)\s*$/, ""))] });
  },
  (m) => {
    const hit = actorAt(m.content, true);
    if (!hit) return null;
    const u = hit.rest.match(/^(?:has )?unlocked (?:their )?(.+?)\.?$/s);
    if (u && !/breakthrough/.test(u[1])) return ev({ kind: "leader", actor: hit.actor, summary: [txt("unlocked "), b(plain(u[1]))] });
    const bt = hit.rest.match(/^(unlocked|exhausted) their _([^_]+)_ breakthrough/);
    if (bt) return ev({ kind: "tech", actor: hit.actor, summary: [txt(`${bt[1]} breakthrough `), b(bt[2])] });
    if (/^played:?$/.test(hit.rest.trim())) {
      const t = embedTitle(m.embeds[0]?.title);
      return ev({ kind: "leader", importance: 3, actor: hit.actor, summary: [txt("played hero "), b(t?.name ?? "")] });
    }
    const hero = hit.rest.match(/^played (.+?)(?:\nLeader will be purged.*)?$/s);
    if (hero && /hero/i.test(hero[1])) return ev({ kind: "leader", importance: 3, actor: hit.actor, summary: [txt("played "), b(plain(hero[1]))] });
    return null;
  },
  (m) => {
    const hit = actorAt(m.content, true);
    const r = hit?.rest.match(/^(drew|gained|purged) (?:the )?_([^_]+)_(?: relic)?/);
    if (!hit || !r) return null;
    const relicish = /relic/i.test(m.content) || r[1] === "drew";
    return ev({ kind: relicish ? "relic" : "explore", actor: hit.actor, summary: [txt(`${r[1]} `), b(r[2])] });
  },
  (m) => {
    const hit = actorAt(m.content, true);
    const s = hit?.rest.match(/^spent (\d+) strategy tokens? using (?:<a?:\w+:\d+>)?\*\*([^*]+)\*\*/);
    if (!hit || !s) return null;
    return ev({ kind: "ability", actor: hit.actor, summary: [txt("used "), b(s[2])] });
  },
  (m) => {
    const hit = actorAt(m.content);
    const p = hit?.rest.match(/^played _([^_]+)_\.?$/);
    if (!hit || !p) return null;
    return ev({ kind: "transaction", actor: hit.actor, summary: [txt("played promissory note "), b(p[1])] });
  },

  // Resources --------------------------------------------------------------------------------------------
  (m) => {
    const hit = actorAt(m.content);
    const g = hit?.rest.match(/^gained (\d+)\s*<a?:tg:\d+>\s*\((\d+) -> (\d+)\) and replenished commodities \((\d+) -> (\d+)/);
    if (!hit || !g) return null;
    return ev({ kind: "resources", actor: hit.actor, summary: [txt("gained "), b(`${g[1]} TG`), txt(" and replenished "), b(`${g[5]} commodities`)] });
  },
  (m) => {
    const hit = actorAt(m.content);
    if (!hit) return null;
    const r = hit.rest;
    const pick = r.match(/^gained (\d+) trade goods? from picking \*\*(\w+)\*\*/);
    if (pick) return ev({ kind: "resources", importance: 1, actor: hit.actor, summary: [txt("gained "), b(`${pick[1]} TG`), txt(` from ${pick[2]}`)] });
    if (/^has replenished commodities/.test(r)) return ev({ kind: "resources", importance: 1, actor: hit.actor, summary: [txt("replenished "), b("commodities")] });
    const cc = r.match(/initial command token allocation was ([\d/]+)\. Your final command tokens allocation is ([\d/]+)/);
    if (cc) return ev({ kind: "resources", actor: hit.actor, summary: [txt("command tokens "), b(`${cc[1]} → ${cc[2]}`)] });
    const ab = r.match(/^your \*\*([^*]+)\*\* ability was triggered\. (.+)$/s);
    if (ab) return ev({ kind: "ability", importance: 1, actor: hit.actor, summary: [b(ab[1]), txt(": "), ...richText(ab[2].replace(/\s*\(\d+ -> \d+\)/, ""))] });
    const tg = r.match(/^gained (\d+) ?(?:trade goods?|tg|<a?:tg:\d+>)(.*)$/s);
    if (tg) return ev({ kind: "resources", importance: 1, actor: hit.actor, summary: [txt("gained "), b(`${tg[1]} TG`), ...richText(tg[2].replace(/\s*\(\d+\s*->\s*\d+\)/, ""))] });
    return null;
  },
];

/** Short label for a transaction line like `<:tg:><:tg:>` or `The Front Half Of Our Pantomime Horse`. */
function describeItem(src: string): string {
  const emojis = [...src.matchAll(/<a?:(\w+):\d+>/g)].map((m) => m[1]);
  const text = plain(src);
  const count = (name: string) => emojis.filter((e) => e === name).length;
  const parts: string[] = [];
  if (count("tg")) parts.push(`${count("tg")} TG`);
  if (count("comm")) parts.push(`${count("comm")} commodit${count("comm") === 1 ? "y" : "ies"}`);
  if (count("PN")) parts.push("promissory note");
  if (text && text !== "TG") parts.push(text.replace(/\bTG\b/g, "").trim());
  return parts.filter(Boolean).join(" ") || text;
}

/** Every message's text, embeds and Components-v2 text displays, as one string the rules can read. */
export function classify(m: LogMessage, ctx: ParseContext): Classified {
  if (!m.bot) return noise("player chat");
  if (m.ephemeral) return noise("ephemeral");
  const content = m.content.trim();
  for (const rule of rules) {
    const hit = rule(m, ctx);
    if (hit) return hit;
  }
  const bare = stripPing(stripHeading(content));
  for (const [re, name] of PLAIN_NOISE) {
    if (re.test(content) || re.test(bare)) return noise(name);
  }
  if (!content && !m.embeds.length) return noise(m.attachments.length ? "image" : "empty");
  if (/^(https?:\/\/\S+|\/art\/\S+)$/.test(content)) return noise("image link");
  if (m.hasComponents) return noise("prompt with buttons");
  if (!content && m.embeds.length) return noise("embed only");
  return { cls: { type: "other" }, drafts: [otherDraft(m, ctx)] };
}

function otherDraft(m: LogMessage, ctx: ParseContext): Draft {
  const first = m.content.split("\n").find((l) => l.trim()) ?? "";
  const hit = findActor(first);
  const line = hit && hit.index === 0 ? hit.rest : stripPing(stripHeading(first));
  const summary = tidy(richText(line.length > 220 ? `${line.slice(0, 217)}…` : line, ctx.nameOf));
  const rest = m.content.split("\n").slice(1).filter((l) => l.trim());
  return {
    kind: "other",
    importance: 1,
    actor: hit && hit.index === 0 ? hit.actor : undefined,
    summary: summary.length ? summary : [txt(titleCase(actorLabel(undefined)) || "…")],
    details: rest.length ? rest.slice(0, 8).map((l) => richText(l.replace(/^>\s*/, ""), ctx.nameOf)) : undefined,
  };
}
