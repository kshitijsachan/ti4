import type { Actor, EmojiRef, Seg } from "../types.ts";

/** `<:name:id>` / `<a:name:id>` */
export const EMOJI_RE = /<a?:(\w+):(\d+)>/g;
const EMOJI_AT_START = /^<a?:(\w+):(\d+)>/;

/** Emoji that carry no information in a one-line history (layout spacers, dice faces, decoration). */
const NOISE_EMOJI = /^(Blank|RollDice|position\w*|slice\w*|sc_\d+_\d+|SC\d+(Back)?|SpeakerToken)$/;

/** Colour emoji the bot puts in player representations are named after the colour, lower-case. */
const isColorEmojiName = (n: string) => /^[a-z][a-z_]*$/.test(n);

export function emojiRef(m: RegExpMatchArray | RegExpExecArray, at = 1): EmojiRef {
  return { name: m[at], id: m[at + 1] };
}

/** Text with emoji, mentions and markdown removed; whitespace collapsed. */
export function plain(src: string): string {
  return src
    .replace(EMOJI_RE, (_, name: string) => (/^(tg)$/.test(name) ? " TG " : " "))
    .replace(/<@[!&]?\d+>/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/[*_~`]+/g, "")
    .replace(/^[#>\-\s]+/gm, "")
    .replace(/⁠|‎|​/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip markdown emphasis only. */
export function unmark(src: string): string {
  return src.replace(/[*_~`]+/g, "").replace(/⁠|‎/g, "").trim();
}

/**
 * The bot's player representation at the start of `src`:
 * `<:Faction:id><@user> <:color:id>**Color**`, `<:Faction:id>Name <:color:id>**Color**`, or a bare `<:Faction:id>`.
 * Returns the actor and the text that follows (leading `, ` / spaces removed).
 */
export function actorAt(src: string, allowBare = false): { actor: Actor; rest: string } | null {
  const s = src.replace(/^\s+/, "");
  const full = s.match(
    /^<a?:(\w+):(\d+)>(?:<@!?(\d+)>|([^<*\n]{1,40}?))?\s*<a?:(\w+):(\d+)>\*\*([^*\n]+)\*\*/,
  );
  if (full && isColorEmojiName(full[5])) {
    const actor: Actor = {
      faction: full[1].toLowerCase(),
      factionEmoji: emojiRef(full, 1),
      color: full[7].trim(),
      colorEmoji: emojiRef(full, 5),
    };
    if (full[3]) actor.userId = full[3];
    const name = full[4]?.trim();
    if (name) actor.name = name;
    return { actor, rest: trimLead(s.slice(full[0].length)) };
  }
  if (!allowBare) return null;
  const bare = s.match(EMOJI_AT_START);
  if (!bare) return null;
  const after = s.slice(bare[0].length);
  const mention = after.match(/^<@!?(\d+)>/);
  const actor: Actor = { faction: bare[1].toLowerCase(), factionEmoji: emojiRef(bare, 1) };
  if (mention) actor.userId = mention[1];
  return { actor, rest: trimLead(mention ? after.slice(mention[0].length) : after) };
}

/** First player representation anywhere in `src`. */
export function findActor(src: string): { actor: Actor; rest: string; index: number } | null {
  const re = /<a?:\w+:\d+>(?:<@!?\d+>|[^<*\n]{1,40}?)?\s*<a?:[a-z_]+:\d+>\*\*/g;
  const m = re.exec(src);
  if (!m) return null;
  const hit = actorAt(src.slice(m.index));
  return hit ? { ...hit, index: m.index } : null;
}

function trimLead(s: string): string {
  return s.replace(/^[,:]?\s*/, "");
}

/** Strip a leading role/user ping (`<@&123>, `) the bot puts before announcements. */
export function stripPing(src: string): string {
  return src.replace(/^\s*(?:#+\s*)?<@[!&]?\d+>[,:]?\s*/, "");
}

/** Heading markers and `-#` subtext prefixes. */
export function stripHeading(src: string): string {
  return src.replace(/^\s*(?:#{1,3}|-#)\s+/, "");
}

/**
 * Bot markdown → segments. Bold/italic/underline runs become bold key nouns, emoji stay inline (minus the
 * decorative ones), mentions resolve through `nameOf`.
 */
export function richText(src: string, nameOf?: (userId: string) => string | undefined): Seg[] {
  const out: Seg[] = [];
  const re = /<a?:(\w+):(\d+)>|<@!?(\d+)>|<@&\d+>|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|__([^_]+)__|(?<![\w])_([^_]+)_(?![\w])|(?<![\w*])\*([^*\n]+)\*(?![\w*])|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) pushText(out, src.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      if (!NOISE_EMOJI.test(m[1])) out.push({ t: "emoji", name: m[1], id: m[2] });
      continue;
    }
    if (m[3]) {
      pushText(out, nameOf?.(m[3]) ?? "someone");
      continue;
    }
    const bold = m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8];
    if (bold !== undefined) {
      const inner = richText(bold, nameOf);
      for (const s of inner) out.push(s.t === "text" ? { t: "b", v: s.v } : s);
      continue;
    }
    if (m[9]) pushText(out, m[9]);
  }
  if (last < src.length) pushText(out, src.slice(last));
  return tidy(out);
}

function pushText(out: Seg[], v: string) {
  const clean = v.replace(/⁠|‎|​/g, "");
  if (!clean) return;
  const prev = out[out.length - 1];
  if (prev?.t === "text") prev.v += clean;
  else out.push({ t: "text", v: clean });
}

/** Collapse whitespace and trim the ends. */
export function tidy(segs: Seg[]): Seg[] {
  const out = segs
    .map((s) => (s.t === "text" || s.t === "b" ? { ...s, v: s.v.replace(/\s+/g, " ") } : s))
    .filter((s) => !(s.t === "b" && !s.v.trim()));
  const first = out[0];
  if (first && (first.t === "text" || first.t === "b")) first.v = first.v.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (last && (last.t === "text" || last.t === "b")) last.v = last.v.replace(/\s+$/, "");
  return out.filter((s) => !(s.t === "text" && s.v === ""));
}

export const txt = (v: string): Seg => ({ t: "text", v });
export const b = (v: string): Seg => ({ t: "b", v });
export const emo = (e: EmojiRef | undefined): Seg[] => (e ? [{ t: "emoji", id: e.id, name: e.name }] : []);
export const who = (actor: Actor): Seg => ({ t: "actor", actor });

/** Plain text of segments (actors by name, then faction). */
export function segText(segs: Seg[]): string {
  return segs
    .map((s) => {
      if (s.t === "text" || s.t === "b") return s.v;
      if (s.t === "actor") return actorLabel(s.actor);
      return "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function actorLabel(a: Actor | undefined): string {
  if (!a) return "";
  return a.name ?? (a.faction ? titleCase(a.faction) : a.color ?? "");
}

export function titleCase(s: string): string {
  return s.replace(/(^|[\s-])(\w)/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** `2 fighter` → `2 Fighters`; unit emoji names → words. */
export function unitWord(name: string, count: number): string {
  const map: Record<string, string> = {
    fighter: "Fighter",
    infantry: "Infantry",
    mech: "Mech",
    carrier: "Carrier",
    cruiser: "Cruiser",
    destroyer: "Destroyer",
    dreadnought: "Dreadnought",
    warsun: "War Sun",
    flagship: "Flagship",
    spacedock: "Space Dock",
    pds: "PDS",
  };
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  const word = map[key] ?? titleCase(name);
  if (count === 1 || word === "Infantry" || word === "PDS") return word;
  return `${word}s`;
}
