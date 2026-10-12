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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const opt = (id: string, value: unknown, disabled = false): any => ({ id, label: id, style: "primary", emoji: null, disabled, needsInput: false, handler: id, value });

void test("a secret list left open past the status phase never takes focus, and drops out when nothing scores", () => {
  const unmet = dec("status.score_secret", { options: [opt("a", { secretObjective: "x", met: false, phase: "status" })] });
  const r = orderDecisions([unmet, dec("strategy_card.pick")], 0, undefined, state({ phase: "strategy" as GameState["phase"], activePlayer: ME }));
  assert.deepEqual(kinds(r), ["strategy_card.pick"]);
  assert.ok(!r.offers.some((d) => d.kind === "status.score_secret"));
  const scorable = dec("status.score_secret", { options: [opt("b", { secretObjective: "y", met: true, phase: "action" })] });
  const r2 = orderDecisions([scorable, dec("turn.action")], 0, undefined, state());
  assert.deepEqual(kinds(r2), ["turn.action"]);
  assert.ok(r2.offers.some((d) => d.kind === "status.score_secret"), "still on offer while one can be scored");
});

void test("my played card with nothing left to press waits behind my turn menu", () => {
  const card = { strategyCard: 5, name: "Trade", holder: "arborec", primaryDone: [] };
  const trade = dec("strategy_card.resolve", {
    scope: "table",
    window: { ...win(["u2"]), subject: card } as unknown as Decision["window"],
    options: [opt("ra", { who: "holder", action: "request_all", part: null, primaryParts: [] }), opt("f", { who: "others", action: "follow", part: null, primaryParts: [] })],
  });
  const r = orderDecisions([trade, dec("turn.action")], 0, undefined, state());
  assert.deepEqual(kinds(r), ["turn.action"]);
  assert.ok(r.offers.some((d) => d.id === trade.id), "nothing to press: behind Available now");

  /* pbd273: Politics with every part done must not take the panel (e.g. mid tactical action, no turn menu open). */
  const doneParts = ["speaker", "agendas", "action_cards"];
  const politicsDone = dec("strategy_card.resolve", {
    scope: "table",
    window: { ...win(["u2"]), subject: { strategyCard: 3, name: "Politics", holder: "arborec", primaryDone: doneParts } } as unknown as Decision["window"],
    options: [opt("ac2", { who: "anyone", action: "draw_action_cards", part: "action_cards", primaryParts: doneParts }), opt("ra2", { who: "holder", action: "request_all", part: null, primaryParts: doneParts })],
  });
  const r3 = orderDecisions([politicsDone], 0, undefined, state());
  assert.deepEqual(kinds(r3), []);
  assert.ok(r3.offers.some((d) => d.id === politicsDone.id));

  const pol = { strategyCard: 3, name: "Politics", holder: "arborec", primaryDone: [] };
  const parts = ["speaker", "action_cards", "agendas"];
  const politics = dec("strategy_card.resolve", {
    scope: "table",
    window: { ...win(["u2"]), subject: pol } as unknown as Decision["window"],
    options: [opt("ac", { who: "anyone", action: "draw_action_cards", part: "action_cards", primaryParts: parts })],
  });
  assert.equal(orderDecisions([politics, dec("turn.action")], 0, undefined, state()).queue[0].kind, "strategy_card.resolve");
});

void test("politics: the draw prompt drops once the agendas are drawn; placements are titled apart", () => {
  const draw = dec("strategy_card.politics_agenda", { options: [opt("d", { action: "draw", count: 2 })] });
  const top = dec("strategy_card.politics_agenda", { options: [opt("t", { action: "top", handle: 1, agenda: "mutiny", placedThisRound: 0 })] });
  const r = orderDecisions([draw, top], 0, undefined, state());
  assert.equal(r.queue.filter((d) => d.kind === "strategy_card.politics_agenda").length, 1);
  assert.equal(r.queue[0].id, top.id);
});

void test("a strategy card I owe a follow on heads the queue, before my turn menu and trade offers", () => {
  const followWin = { kind: "strategy_card", eligible: [ME], responded: [], responses: { [ME]: "pending" }, subject: { strategyCard: 1, holder: "sol" } } as unknown as Decision["window"];
  const follow = dec("strategy_card.resolve", { scope: "table", window: followWin });
  const turn = dec("turn.action");
  const trade = dec("trade.offer");
  const r = orderDecisions([turn, trade, follow], 0, undefined, state());
  assert.deepEqual(kinds(r), ["strategy_card.resolve", "turn.action", "trade.offer"]);
  /* Answered (responded): it no longer leads; my turn menu does. */
  const done = dec("strategy_card.resolve", { scope: "table", window: { ...followWin!, responded: [ME] } as Decision["window"] });
  assert.deepEqual(kinds(orderDecisions([turn, done], 0, undefined, state())), ["turn.action", "strategy_card.resolve"]);
  /* My own card's panel (primary already resolved) is not a follow I owe. */
  const own = dec("strategy_card.resolve", { scope: "table", window: { ...followWin!, subject: { strategyCard: 1, holder: "arborec", primaryDone: ["tokens"] } } as Decision["window"] });
  assert.equal(orderDecisions([turn, own], 0, undefined, state()).queue[0].kind, "turn.action");
});

void test("follow helpers: what I owe, and who holds the turn", async () => {
  const { followsOwed, followHolds, followHeader } = await import("../follows");
  const s = state({
    activePlayer: "u2",
    strategyCards: [
      { number: 1, holder: "u2", tradeGoods: 0, played: true, name: "Leadership", card: "pok1leadership", holderFaction: "sol", blocksTurn: true,
        reactions: [{ faction: "sol", status: "holder", canFollow: false, cantFollowReason: null }, { faction: "arborec", status: "pending", canFollow: true, cantFollowReason: null }] },
    ] as unknown as GameState["strategyCards"],
  });
  assert.deepEqual(followsOwed(s, ME).map((o) => o.name), ["Leadership"]);
  assert.deepEqual(followHolds(s)[0].pending.map((p) => p.userName), ["Me"]);
  assert.deepEqual(followHeader(s, ME), { mine: "follow Leadership", others: null });
  assert.deepEqual(followHeader(s, "u2"), { mine: null, others: "Waiting for Me to follow Leadership" });
});

void test("my card's undone primary part (Politics' action-card draw after the agendas) leads, ahead of my turn menu", () => {
  const parts = ["speaker", "action_cards", "agendas"];
  const subject = (done: string[]) => ({ strategyCard: 3, name: "Politics", holder: "arborec", primaryDone: done });
  const card = (done: string[]) =>
    dec("strategy_card.resolve", {
      scope: "table",
      window: { ...win(["u2"]), subject: subject(done) } as unknown as Decision["window"],
      options: [opt("ac", { who: "anyone", action: "draw_action_cards", part: "action_cards", primaryParts: parts }), opt("ra", { who: "holder", action: "request_all", part: null, primaryParts: parts })],
    });
  assert.deepEqual(kinds(orderDecisions([dec("turn.action"), card(["speaker", "agendas"])], 0, undefined, state())), ["strategy_card.resolve", "turn.action"]);
  const done = orderDecisions([dec("turn.action"), card(["speaker", "agendas", "action_cards"])], 0, undefined, state());
  assert.deepEqual(kinds(done), ["turn.action"]);
});

void test("Construction with only the optional second structure left waits behind my turn menu", () => {
  const parts = ["structure", "structure"];
  const c = dec("strategy_card.resolve", {
    scope: "table",
    window: { ...win(["u2"]), subject: { strategyCard: 4, name: "Construction", holder: "arborec", primaryDone: ["structure"] } } as unknown as Decision["window"],
    options: [opt("pds", { who: "anyone", action: "construction_structure", part: "structure", primaryParts: parts })],
  });
  assert.deepEqual(kinds(orderDecisions([dec("turn.action"), c], 0, undefined, state())), ["turn.action", "strategy_card.resolve"]);
});

void test("my starting technology is a required setup step even while the engine still has it as a table prompt (pbd283)", () => {
  const setup = { stage: "player_setup", waitingOn: [ME], players: [{ userId: ME, faction: "firmament", startingTechsNeeded: 1, secretObjectivesToDiscard: 0, keleresFlavorPending: false }] };
  const s = state({ phase: "setup" as GameState["phase"], round: 1, activePlayer: null, setup: setup as unknown as GameState["setup"] });
  const tech = dec("tech.gain", {
    scope: "table",
    options: [{ id: "getTech_nm", label: "Neural Motivator", style: "primary", emoji: null, disabled: false, needsInput: false, handler: "getTech_nm", value: { tech: "nm", free: true, starting: true, flags: [] } }],
  } as Partial<Decision>);
  const deal = dec("setup.deal_secrets", { scope: "table", target: null });
  const r = orderDecisions([tech, deal], null, undefined, s);
  assert.deepEqual(kinds(r), ["tech.gain"]);
  assert.ok(r.offers.some((d) => d.kind === "setup.deal_secrets"));
  /* Once I owe none, a leftover table copy goes back behind "Available now". */
  const done = state({ ...s, setup: { ...setup, players: [{ ...setup.players[0], startingTechsNeeded: 0 }] } as unknown as GameState["setup"] });
  assert.deepEqual(kinds(orderDecisions([tech], null, undefined, done)), []);
});

const optV = (id: string, value: unknown) => ({ id, label: id, style: "primary", emoji: null, disabled: false, needsInput: false, handler: id, value });

void test("Imperial's score list with nothing left to score never takes the head from my turn (it goes on offer)", () => {
  const turn = dec("turn.action");
  const imperial = dec("status.score", {
    options: [
      optV("lead", { action: "score_public", objective: "lead", eligible: [ME] }),
      optV("pop", { action: "score_public", objective: "pop", eligible: [] }),
    ],
  } as Partial<Decision>);
  const r = orderDecisions([turn, imperial], 0, undefined, state({ publicObjectives: { lead: [ME] } } as Partial<GameState>));
  assert.deepEqual(kinds(r), ["turn.action"]);
  assert.ok(r.offers.some((d) => d.kind === "status.score"));
  const open = orderDecisions([turn, imperial], 0, undefined, state());
  assert.deepEqual(kinds(open), ["status.score", "turn.action"]);
});

void test("a pre-decline offer for a strategy card I hold is dropped", () => {
  const pre = dec("strategy_card.pre_decline", { options: [optV("y", { strategyCard: 8, action: "pre_decline" })] } as Partial<Decision>);
  const cards = [{ number: 8, name: "Imperial", holder: ME }] as unknown as GameState["strategyCards"];
  const r = orderDecisions([pre], null, undefined, state({ strategyCards: cards }));
  assert.equal(r.queue.length + r.offers.length, 0);
  const other = orderDecisions([pre], null, undefined, state({ strategyCards: [{ number: 8, name: "Imperial", holder: "u2" }] as unknown as GameState["strategyCards"] }));
  assert.equal(other.queue.length + other.offers.length, 1);
});
