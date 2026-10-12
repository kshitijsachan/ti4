import type { Message } from "@/discord";
import { EMOJI_UNIT } from "./units";

export type RollKind = "combat" | "afb" | "bombardment" | "spaceCannonOffence" | "spaceCannonDefence";

export type Die = { value: number; hit: boolean };
export type RollLine = { count: number; unit?: string; hitsOn?: number; dice: Die[]; hits: number };

/** One dice report: "<faction> rolls for Andeara combat (round #1)". */
export type Roll = {
  id: string;
  faction: string;
  kind: RollKind;
  round?: number;
  /** A ground combat round (only ground forces rolled). */
  ground: boolean;
  lines: RollLine[];
  total: number;
  at: number;
};

const HEAD = /<a?:(\w+):\d+>\s*rolls for (.+?)(?:<a?:RollDice|:\s*$|\s:\n)/i;

function kindOf(what: string): RollKind {
  if (/anti-fighter barrage/i.test(what)) return "afb";
  if (/bombardment/i.test(what)) return "bombardment";
  if (/space cannon offence/i.test(what)) return "spaceCannonOffence";
  if (/space cannon defence/i.test(what)) return "spaceCannonDefence";
  return "combat";
}

function diceOf(text: string): Die[] {
  return [...text.matchAll(/<a?:d10(red|grey|green|blue)?_(\d+):\d+>/gi)].map((m) => ({
    value: Number(m[2]) === 0 ? 10 : Number(m[2]),
    hit: (m[1] ?? "").toLowerCase() === "red" || (m[1] ?? "").toLowerCase() === "green",
  }));
}

function lineOf(text: string): RollLine | null {
  if (!/^>/.test(text.trim())) return null;
  const dice = diceOf(text);
  if (!dice.length) return null;
  const count = Number(text.match(/`(\d+)x`/)?.[1] ?? dice.length);
  const emoji = [...text.matchAll(/<a?:(\w+):\d+>/g)].map((m) => m[1].toLowerCase()).find((n) => EMOJI_UNIT[n]);
  const hitsOn = Number(text.match(/hits on \*\*(\d+)\*\*/)?.[1]) || undefined;
  const hits = Number(text.match(/-\s*(\d+)\s*hits?\b/)?.[1] ?? dice.filter((d) => d.hit).length);
  return { count, unit: emoji ? EMOJI_UNIT[emoji] : undefined, hitsOn, dice, hits };
}

/** A bot dice report, or null for any other message. */
export function parseRoll(m: Message): Roll | null {
  if (!m.author?.bot) return null;
  const head = m.content.match(HEAD);
  if (!head) return null;
  const what = head[2];
  const lines = m.content.split("\n").map(lineOf).filter((l): l is RollLine => !!l);
  const total = Number(m.content.match(/Total hits (\d+)/i)?.[1] ?? lines.reduce((n, l) => n + l.hits, 0));
  const round = Number(what.match(/round #(\d+)/)?.[1]) || undefined;
  const units = lines.map((l) => l.unit).filter(Boolean);
  const ground = units.length > 0 && units.every((u) => u === "gf" || u === "mf" || u === "pd");
  return {
    id: m.id,
    faction: head[1].toLowerCase(),
    kind: kindOf(what),
    round,
    ground,
    lines,
    total,
    at: Date.parse(m.timestamp),
  };
}

/** What happened in a combat thread so far, read from the bot's posts. */
export type CombatLog = {
  rolls: Roll[];
  /** Hits the bot says I suffered, by round. */
  suffered: Record<number, number>;
  /** I announced a retreat (and have not retreated yet). */
  retreatAnnounced: boolean;
  /** "X destroyed 2 fighters", "X sustained 1 dreadnought", "assigned hits in the following way". */
  losses: { faction?: string; text: string; at: number }[];
};

/** Reads the dice, hits and losses out of a combat thread's messages (oldest first). */
export function readCombatLog(messages: Message[], myFaction?: string, myId?: string): CombatLog {
  const log: CombatLog = { rolls: [], suffered: {}, retreatAnnounced: false, losses: [] };
  for (const m of messages) {
    if (!m.author?.bot) continue;
    const roll = parseRoll(m);
    if (roll) {
      log.rolls.push(roll);
      continue;
    }
    const content = m.content ?? "";
    const suffered = content.match(/<@!?(\d+)>,? you suffered (\d+) hits? in round #(\d+)/i);
    if (suffered && suffered[1] === myId) log.suffered[Number(suffered[3])] = Number(suffered[2]);
    const lead = content.match(/^(?:#+\s*)?<a?:(\w+):\d+>/)?.[1]?.toLowerCase();
    const mine = !!lead && !!myFaction && (lead.startsWith(myFaction) || myFaction.startsWith(lead));
    if (/has announced a retreat/i.test(content) && mine) log.retreatAnnounced = true;
    if (/retreated all units/i.test(content) && mine) log.retreatAnnounced = false;
    if (/\b(destroyed|sustained|assigned (?:the hit|hits) in the following way)\b/i.test(content) && !/would be assigned/i.test(content))
      log.losses.push({ faction: lead, text: content, at: Date.parse(m.timestamp) });
  }
  return log;
}
