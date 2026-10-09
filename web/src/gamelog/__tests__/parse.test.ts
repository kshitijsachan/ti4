/// <reference types="node" />
/**
 * Parser tests over real bot output. Run: `node --test src/gamelog/__tests__/parse.test.ts` from web/
 * (Node ≥ 22.18 strips TypeScript types natively; no test runner dependency).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Message } from "../../discord/types.ts";
import { classify, type LogMessage } from "../parse/classify.ts";
import { buildTimeline, toLogMessage } from "../parse/timeline.ts";
import { segText, actorLabel } from "../parse/markup.ts";
import { FIXTURE_DIR, fixtureMessages, gameMessages, hasState, nameOf } from "./realData.ts";

function fixture(name: string, channelName = ""): LogMessage {
  const f = JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), "utf8")) as { message: Message };
  return toLogMessage(f.message, channelName);
}

const ctx = () => ({ nameOf: () => undefined });

function bot(content: string, extra: Partial<LogMessage> = {}): LogMessage {
  return { id: "1", channelId: "c", channelName: "pbd1-actions", content, embeds: [], attachments: [], hasComponents: false, bot: true, ephemeral: false, time: "2026-10-09T16:00:00Z", ...extra };
}

const one = (m: LogMessage) => {
  const r = classify(m, ctx());
  assert.equal(r.cls.type, "event", `expected an event for: ${m.content.slice(0, 80)}`);
  const d = r.drafts[0];
  return { ...d, line: `${actorLabel(d.actor)} ${segText(d.summary)}`.trim() };
};

const SOL = "<:Sol:1558154703500607488><@1558155013916852224> <:vapourwave:1558154672991240192>**Vapourwave**";
const SOL_NOPING = "<:Sol:1558154703500607488>Alice <:vapourwave:1558154672991240192>**Vapourwave**";
const MENTAK = "<:Mentak:1558154745624002560><@1558155013921046528> <:gold:1558154785268563968>**Gold**";

test("player representation: ping, no-ping and bare forms", () => {
  const a = one(bot(`${SOL_NOPING} has passed.`));
  assert.equal(a.kind, "pass");
  assert.equal(a.actor?.faction, "sol");
  assert.equal(a.actor?.name, "Alice");
  assert.equal(a.actor?.color, "Vapourwave");
  const b = one(bot(`${SOL} picked <:sc_7_1:1558154653902962688>⁠<:sc_7_2:1558154655614238720>.`));
  assert.equal(b.kind, "sc_pick");
  assert.equal(b.actor?.userId, "1558155013916852224");
  assert.match(b.line, /picked 7 · Technology/);
  const c = one(bot("<:Mentak:1558154745624002560> landed 1 Infantry on Lazul Rex."));
  assert.equal(c.kind, "land");
  assert.equal(c.actor?.faction, "mentak");
  assert.match(c.line, /landed 1 Infantry on Lazul Rex/);
});

test("strategy card played (fixture) and following", () => {
  const p = one(fixture("strategy-card-played-with-reactions"));
  assert.equal(p.kind, "sc_play");
  assert.ok(p.actor?.faction);
  const f = one(bot(`${SOL_NOPING} following to perform the secondary ability of **Trade**. 1 command token has been spent from strategy pool.`));
  assert.equal(f.kind, "sc_follow");
  assert.equal(f.importance ?? 2, 2);
  const n = one(bot(`${SOL_NOPING} is not following **Leadership**.`));
  assert.equal(n.importance, 1);
});

test("tactical action: activation, movement attributed to the activator, explore", () => {
  const msgs = [
    bot(`<:Mentak:1558154745624002560>Bob <:gold:1558154785268563968>**Gold** activated 201 (Cresius/Lazul Rex).`, { id: "10" }),
    bot("## Tactical Action in system 201 (Cresius/Lazul Rex):\n\nFrom system 301 (Moll Primus - Mentak) (1 tile away)\n>  moved 2 <:fighter:1558154773298020352>\n>  moved 1 <:carrier:1558154791207698432>\n>  moved 2 <:infantry:1558154644117651456> from the planet Moll Primus (4/1)", { id: "11" }),
  ];
  const { events } = buildTimeline(msgs);
  assert.equal(events[0].kind, "activate");
  assert.equal(events[0].systemPosition, "201");
  assert.equal(events[1].kind, "move");
  assert.equal(events[1].actor?.faction, "mentak");
  assert.match(segText(events[1].summary), /moved 2 Fighters, 1 Carrier, 2 Infantry into Cresius\/Lazul Rex/);
  const x = one(fixture("explore-card-embed"));
  assert.equal(x.kind, "explore");
  assert.equal(x.systemPosition, "201");
  assert.match(x.line, /explored Lazul Rex — Cybernetic Research Facility/);
});

test("combat: dice roll fixture, hits assigned, thread gives the system", () => {
  const roll = one(fixture("combat-dice-roll", "pbd1-round-1-system-201-turn-2-yssaril-vs-mentak"));
  assert.equal(roll.kind, "combat");
  assert.match(roll.line, /rolled 2 hits \(round 1\)/);
  assert.equal(roll.actor?.faction, "yssaril");
  const hits = one(bot("<:Yssaril:1558154714279968768> assigned hits in the following way:\n> Destroyed 2 <:destroyer:1>\n> Destroyed 1 <:cruiser:2>"));
  assert.match(hits.line, /lost 2 Destroyers, 1 Cruiser/);
});

test("objectives: reveal embeds, scoring with VP", () => {
  const r = classify(fixture("public-objectives-embeds"), ctx());
  assert.equal(r.cls.type, "event");
  assert.ok(r.drafts.length >= 1);
  assert.match(segText(r.drafts[0].summary), /Stage I objective revealed: /);
  const s = one(bot("<:Keleres:1>Bot Beta <:plum:2>**Plum** scored <:Public1alt:3> _Erect a Monument_."));
  assert.equal(s.vp, 1);
  assert.equal(s.importance, 3);
  const so = one(bot("<:Ghost:1>Bot Alpha <:glacier:2>**Glacier** scored <:SecretObjectiveAlt:3>_Destroy Heretical Works_ (Status Phase): Purge 2 of your relic fragments of any type. (0/2)"));
  assert.match(so.line, /scored Destroy Heretical Works \(\+1 VP · secret objective\)/);
});

test("agenda: reveal fixture, votes, outcome uses the revealed agenda name", () => {
  const msgs = [
    { ...fixture("agenda-revealed"), id: "20" },
    bot("<:Mentak:1> used the following: \n> Cresius (0/1) for 1 vote.\n> Lazul Rex (2/2) for 2 votes.\nFor a total of **4** votes on the outcome \"Mentak\".", { id: "21" }),
    bot('Resolving vote for "Mentak".', { id: "22" }),
  ];
  const { events } = buildTimeline(msgs);
  const kinds = events.filter((e) => e.kind !== "phase").map((e) => `${e.kind}:${segText(e.summary)}`);
  assert.match(kinds[0], /^agenda:Agenda revealed: /);
  assert.match(kinds[1], /voted 4 for Mentak/);
  assert.match(kinds[2], /resolved: Mentak/);
  assert.equal(events.find((e) => e.kind === "phase")?.phase, "agenda");
});

test("action card, transaction", () => {
  const ac = one(fixture("action-card-played-sabotage-window"));
  assert.equal(ac.kind, "action_card");
  const tx = one(bot("A transaction has been ratified:\n> <:Yssaril:1>Carol gives:\n> - <:tg:2><:tg:2>\n\n> <:Mentak:3>Bob gives:\n> - The Front Half Of Our Pantomime Horse"));
  assert.equal(tx.kind, "transaction");
  assert.equal(tx.actor?.faction, "yssaril");
  assert.equal(tx.target?.faction, "mentak");
  assert.match(segText(tx.details![0]), /gave: 2 TG/);
});

test("prompts, banners, ephemerals and chatter are dropped", () => {
  for (const name of ["strategy-card-pick-buttons", "status-homework-buttons", "strategy-phase-banner-image", "ephemeral-with-buttons", "turn-order", "image-url-only-content"]) {
    const r = classify(fixture(name), ctx());
    assert.equal(r.cls.type, "noise", `${name} should be dropped, got ${JSON.stringify(r.cls)}`);
  }
  assert.equal(classify(bot("gg", { bot: false }), ctx()).cls.type, "noise");
});

test("phase tracking from banners and round starts", () => {
  const msgs = [
    bot("Started Round 1", { id: "1" }),
    bot("", { id: "2", attachments: ["action1banner_2026.webp"] }),
    bot(`${SOL_NOPING} has passed.`, { id: "3" }),
    bot("", { id: "4", attachments: ["status1banner_2026.webp"] }),
    bot("", { id: "5", attachments: ["agenda2banner_2026.webp"] }),
    bot("Started Round 2", { id: "6" }),
    bot("Started Round 1", { id: "7" }),
  ];
  const { events } = buildTimeline(msgs);
  const phases = events.filter((e) => e.kind === "phase").map((e) => `${e.round}:${e.phase}`);
  assert.deepEqual(phases, ["1:strategy", "1:action", "1:status", "1:agenda", "2:strategy"]);
  assert.equal(events.find((e) => e.kind === "pass")?.phase, "action");
});

test("captured fixtures: nothing in the log scope is unrecognised", () => {
  const { stats } = buildTimeline(fixtureMessages());
  assert.equal(stats.other, 0, stats.otherSamples.join("\n"));
});

test("live games: at most 5% of bot messages unrecognised", { skip: !hasState() && "no shim state" }, () => {
  for (const g of ["pbd1", "pbd8", "pbd9"]) {
    const msgs = gameMessages(g);
    if (!msgs.length) continue;
    const { stats, events } = buildTimeline(msgs, nameOf);
    assert.ok(stats.other / stats.total <= 0.05, `${g}: ${stats.other}/${stats.total} unrecognised\n${stats.otherSamples.join("\n")}`);
    assert.ok(events.some((e) => e.kind === "sc_pick"), `${g} has strategy picks`);
    for (const e of events) assert.ok(e.text.length > 0, `${e.id} has text`);
  }
});

test("MENTAK constant parses (guards the representation regex)", () => {
  assert.equal(one(bot(`${MENTAK} has passed.`)).actor?.color, "Gold");
});
