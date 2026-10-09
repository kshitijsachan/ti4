/**
 * Discord-flavoured markdown → small AST. Pure and synchronous so it can be memoised per message and unit
 * tested without React.
 */

export type Inline =
  | { k: "text"; v: string }
  | { k: "strong" | "em" | "u" | "s" | "spoiler"; c: Inline[] }
  | { k: "code"; v: string }
  | { k: "link"; href: string; c: Inline[] }
  | { k: "user"; id: string }
  | { k: "role"; id: string }
  | { k: "channel"; id: string }
  | { k: "everyone"; v: string }
  | { k: "slash"; name: string }
  | { k: "emoji"; id: string; name: string; animated: boolean }
  | { k: "time"; unix: number; fmt: string }
  | { k: "br" };

export type Block =
  | { k: "p"; c: Inline[] }
  | { k: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { k: "sub"; c: Inline[] }
  | { k: "quote"; c: Block[] }
  | { k: "codeblock"; lang: string; v: string }
  | { k: "list"; ordered: boolean; start: number; items: Block[][] };

type Rule = { re: RegExp; make: (m: RegExpExecArray, inQuote: boolean) => Inline };

const parseInner = (s: string) => parseInline(s);

const INLINE_RULES: Rule[] = [
  { re: /^\\([^0-9A-Za-z\s])/, make: (m) => ({ k: "text", v: m[1] }) },
  { re: /^(`+)([\s\S]*?[^`])\1(?!`)/, make: (m) => ({ k: "code", v: m[2].replace(/^ (.*) $/s, "$1") }) },
  { re: /^<(a?):(\w+):(\d+)>/, make: (m) => ({ k: "emoji", animated: m[1] === "a", name: m[2], id: m[3] }) },
  { re: /^<@!?(\d+)>/, make: (m) => ({ k: "user", id: m[1] }) },
  { re: /^<@&(\d+)>/, make: (m) => ({ k: "role", id: m[1] }) },
  { re: /^<#(\d+)>/, make: (m) => ({ k: "channel", id: m[1] }) },
  { re: /^<\/([\w\- ]+):\d+>/, make: (m) => ({ k: "slash", name: m[1] }) },
  { re: /^<t:(-?\d+)(?::([tTdDfFR]))?>/, make: (m) => ({ k: "time", unix: Number(m[1]), fmt: m[2] ?? "f" }) },
  { re: /^@(everyone|here)\b/, make: (m) => ({ k: "everyone", v: `@${m[1]}` }) },
  {
    re: /^\[((?:\[[^\]]*\]|[^[\]])+)\]\(\s*<?((?:\([^)\s]*\)|[^\s)>])+)>?(?:\s+"[^"]*")?\s*\)/,
    make: (m) => ({ k: "link", href: m[2], c: parseInner(m[1]) }),
  },
  { re: /^<(https?:\/\/[^\s>]+)>/, make: (m) => ({ k: "link", href: m[1], c: [{ k: "text", v: m[1] }] }) },
  {
    re: /^https?:\/\/[^\s<]+[^<.,:;"')\]\s]/,
    make: (m) => ({ k: "link", href: m[0], c: [{ k: "text", v: m[0] }] }),
  },
  { re: /^\*\*([\s\S]+?)\*\*(?!\*)/, make: (m) => ({ k: "strong", c: parseInner(m[1]) }) },
  { re: /^__([\s\S]+?)__(?!_)/, make: (m) => ({ k: "u", c: parseInner(m[1]) }) },
  { re: /^\*(?=\S)((?:\*\*[\s\S]+?\*\*|[\s\S])+?)\*(?!\*)/, make: (m) => ({ k: "em", c: parseInner(m[1]) }) },
  { re: /^_((?:__[\s\S]+?__|[^_])+?)_(?![_\w])/, make: (m) => ({ k: "em", c: parseInner(m[1]) }) },
  { re: /^~~([\s\S]+?)~~/, make: (m) => ({ k: "s", c: parseInner(m[1]) }) },
  { re: /^\|\|([\s\S]+?)\|\|/, make: (m) => ({ k: "spoiler", c: parseInner(m[1]) }) },
  { re: /^\n/, make: () => ({ k: "br" }) },
];

const TEXT_RE = /^[\s\S]+?(?=[\\`*_~|[<@\n]|https?:\/\/|$)/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  const pushText = (v: string) => {
    const last = out[out.length - 1];
    if (last && last.k === "text") last.v += v;
    else out.push({ k: "text", v });
  };
  outer: while (rest.length) {
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (!m) continue;
      const node = rule.make(m, false);
      if (node.k === "text") pushText(node.v);
      else out.push(node);
      rest = rest.slice(m[0].length);
      continue outer;
    }
    const t = TEXT_RE.exec(rest);
    const v = t && t[0].length ? t[0] : rest[0];
    pushText(v);
    rest = rest.slice(v.length);
  }
  return out;
}

const FENCE_RE = /```(?:([\w+#.-]*)\n)?([\s\S]*?)```/g;
const HEADER_RE = /^(#{1,3}) +(\S.*)$/;
const SUB_RE = /^-# +(\S.*)$/;
const LIST_RE = /^( *)([-*]|\d{1,9}\.) +(.*)$/;

/** Parse a whole message body into blocks. */
export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let last = 0;
  FENCE_RE.lastIndex = 0;
  for (let m = FENCE_RE.exec(src); m; m = FENCE_RE.exec(src)) {
    blocks.push(...parseLines(src.slice(last, m.index)));
    const body = m[2].replace(/\n$/, "");
    blocks.push({ k: "codeblock", lang: m[1] ?? "", v: body });
    last = m.index + m[0].length;
    if (src[last] === "\n") last++;
  }
  blocks.push(...parseLines(src.slice(last)));
  return blocks;
}

function parseLines(src: string): Block[] {
  if (!src) return [];
  const lines = src.replace(/\n$/, "").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    blocks.push({ k: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith(">>> ")) {
      flush();
      const rest = [line.slice(4), ...lines.slice(i + 1)].join("\n");
      blocks.push({ k: "quote", c: parseLines(rest) });
      return blocks;
    }
    if (line === ">" || line.startsWith("> ")) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] === ">" || lines[i].startsWith("> "))) {
        quoted.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ k: "quote", c: parseLines(quoted.join("\n")) });
      continue;
    }
    const h = HEADER_RE.exec(line);
    if (h) {
      flush();
      blocks.push({ k: "h", level: h[1].length as 1 | 2 | 3, c: parseInline(h[2]) });
      i++;
      continue;
    }
    const sub = SUB_RE.exec(line);
    if (sub) {
      flush();
      blocks.push({ k: "sub", c: parseInline(sub[1]) });
      i++;
      continue;
    }
    if (LIST_RE.test(line)) {
      flush();
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return blocks;
}

/** A run of list lines; deeper indentation nests a list inside the previous item. */
function parseList(lines: string[], start: number): [Block, number] {
  const first = LIST_RE.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = first[2] !== "-" && first[2] !== "*";
  const items: Block[][] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m || m[1].length < indent) break;
    const sameKind = (m[2] !== "-" && m[2] !== "*") === ordered;
    if (m[1].length === indent && !sameKind) break;
    if (m[1].length > indent && items.length) {
      const [nested, next] = parseList(lines, i);
      items[items.length - 1].push(nested);
      i = next;
      continue;
    }
    items.push([{ k: "p", c: parseInline(m[3]) }]);
    i++;
  }
  const startNum = ordered ? parseInt(first[2], 10) || 1 : 1;
  return [{ k: "list", ordered, start: startNum, items }, i];
}

/** Plain-text rendering used for reply previews and notifications. */
export function toPlainText(src: string): string {
  return src
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/[*_~|`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
