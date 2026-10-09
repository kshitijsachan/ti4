import type { PlayState } from "@/discord";

/** Emoji whose meaning matters in prose: replaced by a word instead of dropped. */
const EMOJI_WORDS: Record<string, string> = {
  tg: "TG",
  comm: "commodity",
  influence: "influence",
  resources: "resources",
  NoSabo: "",
  SpeakerToken: "(speaker)",
};

type Names = {
  user: (id: string) => string | undefined;
  channel: (id: string) => string | undefined;
  scName: (initiative: number) => string | undefined;
};

export function namesFrom(state: Pick<PlayState, "users" | "channels">, scName: Names["scName"]): Names {
  return {
    user: (id) => {
      const u = state.users[id];
      return u ? (u.global_name ?? u.username) : undefined;
    },
    channel: (id) => state.channels[id]?.name,
    scName,
  };
}

/**
 * Turns bot prose into calm plain-language markdown: player representations ("<:Keleres:…><@123>
 * <:purple:…>**Purple**") become the player's name, strategy-card emoji runs become the card's name,
 * other emoji and Discord jump links are dropped, headings become bold lines.
 */
export function cleanText(content: string, names: Names): string {
  let s = content.replace(/⁠/g, "");
  s = s.replace(/<a?:\w+:\d+>\s?(<@!?\d+>|[^<>\n*]{1,40}?) <a?:\w+:\d+>\*\*[\w' -]{1,30}\*\*/g, "$1");
  s = s.replace(/(<:sc_(\d+)_1:\d+>)(<:sc_\d+_\d+:\d+>)*/g, (_m, _a, n: string) => {
    const name = names.scName(Number(n));
    return name ? `**${name}**` : `strategy card ${n}`;
  });
  s = s.replace(/(?:<:(tg|comm):\d+>){2,}/g, (run, name: string) => {
    const n = run.match(/<:/g)?.length ?? 0;
    return ` ${n} ${name === "tg" ? "TG" : "commodities"} `;
  });
  s = s.replace(/<a?:(\w+):\d+>/g, (_m, name: string) => {
    const word = EMOJI_WORDS[name];
    return word === undefined ? "" : word ? ` ${word} ` : "";
  });
  s = s.replace(/<@!?(\d+)>/g, (_m, id: string) => names.user(id) ?? "a player");
  s = s.replace(/<@&\d+>/g, "everyone");
  s = s.replace(/<#(\d+)>/g, (_m, id: string) => names.channel(id) ?? "a channel");
  s = s.replace(/(message link is:\s*)?https:\/\/discord\.com\/channels\/[\d/]+\.?/gi, "");
  s = s.replace(/^#{1,3} +(.+)$/gm, "**$1**");
  s = s.replace(/^-# +/gm, "");
  s = s.replace(/\*\*\s*\*\*/g, "");
  s = s.replace(/[ \t]{2,}/g, " ").replace(/ +([.,:;!?)])/g, "$1");
  s = s.replace(/^[ \t]+|[ \t]+$/gm, "");
  s = s.replace(/^>\s*$/gm, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** The first sentence-ish chunk of cleaned text, without markdown, for one-line summaries. */
export function firstLine(text: string, max = 140): string {
  const line = text
    .split("\n")
    .map((l) => l.replace(/[*_`>]/g, "").trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
