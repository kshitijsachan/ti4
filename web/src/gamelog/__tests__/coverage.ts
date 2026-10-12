/// <reference types="node" />
/**
 * Coverage report over real bot output: `node src/gamelog/__tests__/coverage.ts [pbd1 pbd8 ...] [--other] [--events]`
 * (Node ≥ 22.18 runs TypeScript directly.)
 */
import { buildTimeline } from "../parse/timeline.ts";
import { segText, actorLabel } from "../parse/markup.ts";
import { fixtureMessages, gameMessages, hasState, nameOf } from "./realData.ts";

const args = process.argv.slice(2);
const games = args.filter((a) => !a.startsWith("--"));
const showOther = args.includes("--other");
const showEvents = args.includes("--events");

const sources: [string, ReturnType<typeof fixtureMessages>][] = [["fixtures", fixtureMessages()]];
if (hasState()) for (const g of games.length ? games : ["pbd1", "pbd8", "pbd9"]) sources.push([g, gameMessages(g)]);

const totals = { total: 0, events: 0, noise: 0, other: 0, duplicates: 0 };
const kinds: Record<string, number> = {};
for (const [name, msgs] of sources) {
  const { events, stats } = buildTimeline(msgs, hasState() ? nameOf : undefined);
  const ev = Object.values(stats.events).reduce((a, n) => a + (n ?? 0), 0);
  const nz = Object.values(stats.noise).reduce((a, n) => a + n, 0);
  totals.total += stats.total;
  totals.events += ev;
  totals.noise += nz;
  totals.other += stats.other;
  totals.duplicates += stats.duplicates;
  for (const [k, n] of Object.entries(stats.events)) kinds[k] = (kinds[k] ?? 0) + (n ?? 0);
  const pct = (n: number) => `${((100 * n) / Math.max(1, stats.total)).toFixed(1)}%`;
  console.log(`\n## ${name}: ${stats.total} messages → ${ev} event messages (${pct(ev)}), ${nz} dropped (${pct(nz)}), ${stats.other} unrecognised (${pct(stats.other)}); ${events.length} events`);
  console.log("  kinds:", JSON.stringify(stats.events));
  console.log("  dropped:", JSON.stringify(stats.noise));
  if (showOther) for (const s of stats.otherSamples) console.log("  ? ", s);
  if (showEvents) {
    for (const e of events) {
      console.log(`  R${e.round} ${e.phase.padEnd(8)} ${e.kind.padEnd(11)} ${"*".repeat(e.importance)} ${actorLabel(e.actor)} ${segText(e.summary)}${e.systemPosition ? ` @${e.systemPosition}` : ""}`);
    }
  }
}
const pct = (n: number) => `${((100 * n) / Math.max(1, totals.total)).toFixed(1)}%`;
console.log(`\n## total: ${totals.total} messages → events ${totals.events} (${pct(totals.events)}), dropped ${totals.noise} (${pct(totals.noise)}), unrecognised ${totals.other} (${pct(totals.other)})`);
console.log("  kinds:", JSON.stringify(kinds));
