/// <reference types="node" />
/**
 * Discord-leftover scan over real bot output: `node src/gamelog/__tests__/leftovers.ts [pbd1 ...] [--list]`.
 * Counts log events whose visible text still carries Discord markup (`<:e:id>`, `<@id>`, `<#id>`, `**`, `<t:…>`)
 * or Discord-only wording (slash commands, channels, threads, pings, bothelpers).
 */
import { buildTimeline } from "../parse/timeline.ts";
import { segText } from "../parse/markup.ts";
import { gameMessages, hasState, nameOf } from "./realData.ts";
import { readFileSync } from "node:fs";

export const LEFTOVER: [string, RegExp][] = [
  ["raw markup", /<a?:\w+:\d+>|<@[!&]?\d+>|<#\d+>|<t:\d+(:\w)?>|\*\*|__\w|\|\|/],
  ["slash command", /(^|\s)\/[a-z_]+( [a-z_]+)?\b(?!\w*\.)/i],
  ["discord wording", /\b(channel|thread|ping(ed|s)?|bothelper|discord|server|react(ion)? with|emoji)\b/i],
  ["external site", /asyncti4\.com|discord\.(com|gg)|statically\.io|ti4ultimate/i],
];

const args = process.argv.slice(2);
const list = args.includes("--list");
let games = args.filter((a) => !a.startsWith("--"));
if (!hasState()) throw new Error("no shim state");
if (!games.length) {
  const s = JSON.parse(readFileSync(process.env.SHIM_STATE ?? "/home/user/run/shim-data/state.json", "utf8"));
  const ch = Object.values(s.channels) as { name?: string }[];
  games = [...new Set(ch.map((c) => c.name ?? "").filter((n) => n.endsWith("-actions")).map((n) => n.split("-")[0]))];
}
const counts: Record<string, number> = {};
const samples: Record<string, Set<string>> = {};
let total = 0;
for (const g of games) {
  const { events } = buildTimeline(gameMessages(g), nameOf);
  for (const e of events) {
    total++;
    const texts = [segText(e.summary), ...(e.details ?? []).map((d) => segText(d))];
    for (const t of texts) {
      for (const [k, re] of LEFTOVER) {
        if (!re.test(t)) continue;
        counts[k] = (counts[k] ?? 0) + 1;
        (samples[k] ??= new Set()).add(`${e.kind}: ${t.slice(0, 200)}`);
      }
    }
  }
}
console.log(`${games.length} games, ${total} events`);
console.log(JSON.stringify(counts));
if (list) for (const [k, s] of Object.entries(samples)) { console.log(`\n## ${k} (${s.size} distinct)`); for (const x of s) console.log("  ", x); }
