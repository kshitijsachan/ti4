/// <reference types="node" />
/** Run: `../shim/node_modules/.bin/tsx --test src/engine/__tests__/order.test.ts` from web/ (order.ts has runtime imports). */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision, GameState } from "../contract";
import { orderDecisions } from "../order";

const G = "pbd1";
const ME = "u1";

const state = (extra: Partial<GameState> = {}): GameState =>
  ({
    contract: 1, game: G, stateVersion: 1, seq: 1, phase: "action", round: 2, activePlayer: ME, speaker: null,
    players: [
      { userId: ME, userName: "Me", faction: "arborec", color: "red", self: true },
      { userId: "u2", userName: "Two", faction: "sol", color: "blue", self: false },
    ],
    strategyCards: [], tiles: [], publicObjectives: {}, laws: [], draft: null, setup: null, agenda: null, status: null,
    ...extra,
  }) as unknown as GameState;

let n = 0;
const dec = (kind: string, over: Partial<Decision> = {}): Decision =>
  ({
    id: `${kind}#${++n}`, game: G, kind, seq: n, stateVersion: 1, target: { userId: ME, faction: "arborec", color: "red", resolvedBy: "owner_prefix" },
    scope: "player", visibility: "public", prompt: "p",
    options: [{ id: `o${n}`, label: "A", style: "primary", emoji: null, disabled: false, needsInput: false, handler: "a", value: null }],
    source: { channelId: "c", messageId: `m${n}`, customIdPrefix: null, ephemeral: false }, createdAt: n, revision: 1, window: null, progress: null,
    ...over,
  }) as Decision;

const win = (eligible = [ME]) => ({ kind: "w", eligible, responded: [], responses: {}, subject: {} }) as unknown as Decision["window"];
const kinds = (r: { queue: Decision[] }) => r.queue.map((d) => d.kind);

void test("stale agenda prompts leave the queue once the agenda phase is over", () => {
  const plan = dec("agenda.preassign");
  const when = dec("agenda.when", { window: win() });
  const turn = dec("turn.action");
  const r = orderDecisions([plan, when, turn], null, undefined, state());
  assert.deepEqual(kinds(r), ["turn.action"]);
  assert.ok(r.offers.some((d) => d.kind === "agenda.preassign"), "in-advance agenda plan is on offer, not at the head");
});

void test("finished when/after windows drop out; the vote heads the queue in the agenda phase", () => {
  const agenda = { whensResolved: true, aftersResolved: true } as unknown as GameState["agenda"];
  const s = state({ phase: "agendaVoting" as GameState["phase"], agenda, activePlayer: null });
  const r = orderDecisions([dec("agenda.when", { window: win() }), dec("agenda.after", { window: win() }), dec("trade.offer"), dec("agenda.vote", { window: win() })], null, undefined, s);
  assert.deepEqual(kinds(r), ["agenda.vote", "trade.offer"]);
});

void test("my turn and combat outrank trade offers, even a trade offer opened after my last answer", () => {
  const turn = dec("turn.action");
  const trade = dec("trade.offer");
  const combat = dec("combat.round", { window: win() });
  const r = orderDecisions([trade, turn, combat], 0, undefined, state());
  assert.deepEqual(kinds(r), ["combat.round", "turn.action", "trade.offer"]);
});

void test("a landing step leads only while it is my turn; otherwise it is a leftover on offer", () => {
  const land = dec("tactical.land");
  const turn = dec("turn.action");
  const mine = orderDecisions([turn, land], 0, undefined, state());
  assert.equal(mine.queue[0].kind, "tactical.land");
  const theirs = orderDecisions([land, dec("strategy_card.resolve", { window: win() })], 0, undefined, state({ activePlayer: "u2" }));
  assert.ok(!theirs.queue.some((d) => d.kind === "tactical.land"));
  assert.ok(theirs.offers.some((d) => d.kind === "tactical.land"));
});

void test("in-advance prompts never head the queue", () => {
  const r = orderDecisions([dec("strategy_card.pre_decline"), dec("action_card.preassign"), dec("planet.ready")], null, undefined, state());
  assert.deepEqual(kinds(r), ["planet.ready"]);
  assert.equal(r.offers.length, 2);
});
