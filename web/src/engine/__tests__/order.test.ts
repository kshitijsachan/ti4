/// <reference types="node" />
/** Run: `../shim/node_modules/.bin/tsx --test src/engine/__tests__/order.test.ts` from web/ (order.ts has runtime imports). */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision, GameState } from "../contract";
import { decisionTitle, orderDecisions } from "../order";

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

void test("Deepwrought: the type picker my 'Get a technology' press opened leads, not the identical second prompt (user report, pbd1410)", () => {
  const setup = { stage: "player_setup", waitingOn: [ME], players: [{ userId: ME, faction: "deepwrought", startingTechsNeeded: 2, secretObjectivesToDiscard: 0, keleresFlavorPending: false }] };
  const s = state({ phase: "setup" as GameState["phase"], round: 1, activePlayer: null, setup: setup as unknown as GameState["setup"] });
  const get = (): Decision =>
    dec("tech.choose_type", {
      options: [
        { id: "acquireAFreeTech", label: "Get a Technology", style: "success", emoji: null, disabled: false, needsInput: false, handler: "acquireAFreeTech", value: { techType: null, free: true, starting: true } },
        { id: "deleteButtons", label: "Done", style: "danger", emoji: null, disabled: false, needsInput: false, handler: "deleteButtons", value: null },
      ],
    } as Partial<Decision>);
  const first = get();
  const second = get();
  const before = orderDecisions([first, second], null, undefined, s);
  assert.deepEqual(before.queue.map((d) => d.id), [first.id, second.id], "both starting prompts are mine, oldest first");
  /* I pressed the first one at stream position second.seq: it closed and opened the type picker. */
  const answeredAt = second.seq;
  const types = dec("tech.choose_type", {
    options: ["propulsion", "biotic", "cybernetic", "warfare", "unitupgrade"].map((t) => optV(`getAllTechOfType_${t}_noPay`, { techType: t, free: true })),
  } as Partial<Decision>);
  const after = orderDecisions([second, types], answeredAt, undefined, s, "tech.choose_type", { answeredId: first.id });
  assert.deepEqual(after.queue.map((d) => d.id), [types.id, second.id], "the picker leads; the second prompt is '1 more after this'");
});

const optV = (id: string, value: unknown) => ({ id, label: id, style: "primary", emoji: null, disabled: false, needsInput: false, handler: id, value });

void test("Imperial's score list with nothing left to score never takes the head from my turn (pt9: and is not on offer)", () => {
  const turn = dec("turn.action");
  const imperial = dec("status.score", {
    options: [
      optV("lead", { action: "score_public", objective: "lead", eligible: [ME] }),
      optV("pop", { action: "score_public", objective: "pop", eligible: [] }),
    ],
  } as Partial<Decision>);
  const r = orderDecisions([turn, imperial], 0, undefined, state({ publicObjectives: { lead: [ME] } } as Partial<GameState>));
  assert.deepEqual(kinds(r), ["turn.action"]);
  assert.ok(!r.offers.some((d) => d.kind === "status.score"), "spent outside the status phase: dropped (pt9 150)");
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

void test("TE Warfare: a redistribute offer left open waits behind the activation step it would block (pbd436)", () => {
  const redistribute = dec("choose.confirm", {
    options: [opt("FFCC_arborec_redistributeCCButtons_deleteThisButton", { source: "warfare", confirm: true, choice: "redistribute" })],
    revision: 2,
  });
  const activate = dec("tactical.activate", { options: [opt("FFCC_arborec_ringTile_000", { step: "system", position: "000", tileId: "112", token: false })] });
  const turn = dec("turn.action");
  const r = orderDecisions([redistribute, activate, turn], 0, undefined, state());
  assert.equal(r.queue[0].kind, "tactical.activate");
  assert.ok(!r.queue.includes(redistribute));
  assert.ok(r.offers.includes(redistribute), "still on offer behind Available now");
  /* No tactical step open (after the Warfare action ends): the offer is mine to answer. */
  const after = orderDecisions([redistribute, turn], 0, undefined, state());
  assert.ok(after.queue.includes(redistribute));
});

void test("choose.* titles name what asks, not the raw kind", () => {
  const offer = dec("choose.confirm", {
    options: [
      opt("r", { source: "warfare", confirm: true, choice: "redistribute" }),
      opt("t", { source: "warfare", confirm: true, choice: "tactical" }),
    ],
  });
  assert.equal(decisionTitle(offer), "Warfare: your primary");
  assert.equal(decisionTitle(dec("choose.confirm", { options: [opt("r", { source: "warfare", confirm: true, choice: "redistribute" })] })), "Warfare: redistribute command tokens?");
  assert.equal(decisionTitle(dec("choose.confirm", { options: [opt("c", { source: "crownofemphidia", confirm: true })] })), "Crown of Emphidia");
  assert.equal(decisionTitle(dec("choose.confirm")), "Choose confirm");
});

void test("pt7: the hand panel reopened by a discard never leads the required token editor or End turn", () => {
  const tokens = dec("command_tokens.adjust");
  const play = dec("action_card.play", {
    options: [{ id: "p1", label: "Play", style: "primary", emoji: null, disabled: false, needsInput: false, handler: "ac_play_from_hand_5", value: { handle: 5, actionCard: "flank_speed", window: null } } as any],
  });
  const r = orderDecisions([tokens, play], 0, undefined, state(), "action_card.discard");
  assert.deepEqual(kinds(r), ["command_tokens.adjust"]);
  assert.ok(r.offers.some((d) => d.kind === "action_card.play"));
});

void test("pt7: a hand panel with every card greyed stays on offer, even right after my turn menu", () => {
  const turn = dec("turn.action");
  const play = dec("action_card.play", {
    options: [{ id: "p1", label: "Play", style: "primary", emoji: null, disabled: false, needsInput: false, handler: "ac_play_from_hand_5", value: { handle: 5, actionCard: "imperial_rider", window: null } } as any],
  });
  const s = state();
  (s.players[0] as unknown as { hand: unknown }).hand = { actionCards: {}, secretObjectives: {}, promissoryNotes: {}, closedActionCards: { imperial_rider: "agenda only" } };
  const r = orderDecisions([turn, play], 0, undefined, s, "turn.action");
  assert.deepEqual(kinds(r), ["turn.action"]);
});

void test("pt7: a pre-decline offer for a card already played is moot", () => {
  const pre = dec("strategy_card.pre_decline", {
    options: [{ id: "x", label: "Pre-decline", style: "primary", emoji: null, disabled: false, needsInput: false, handler: "h", value: { strategyCard: 6 } } as any],
  });
  const s = state({ strategyCards: [{ number: 6, holder: "u2", played: true, name: "Warfare" }] as unknown as GameState["strategyCards"] });
  const r = orderDecisions([pre, dec("turn.action")], null, undefined, s);
  assert.ok(!r.offers.some((d) => d.kind === "strategy_card.pre_decline") && !kinds(r).includes("strategy_card.pre_decline"));
});

/* ---- playtest 8 */

void test("pt8: the follow-up of the decision I just answered leads, not that decision re-sent (Warfare → token editor; Imperial list → Pay)", () => {
  const warfare = dec("choose.confirm", { options: [opt("t", { source: "warfare", confirm: true, choice: "tactical" })] });
  const tokens = dec("command_tokens.adjust");
  /* I answered the Warfare panel at seq 0; the engine re-sent it (revision 2) and opened the token editor. */
  const resent = { ...warfare, seq: 50, revision: 2 } as Decision;
  const opened = { ...tokens, seq: 51 } as Decision;
  const r = orderDecisions([resent, opened, dec("turn.action")], 0, undefined, state(), "choose.confirm", { answeredId: warfare.id });
  assert.equal(r.queue[0].kind, "command_tokens.adjust");
  const list = dec("status.score", { options: [optV("sway", { action: "score_public", objective: "sway_council", eligible: [ME] })] } as Partial<Decision>);
  const pay = dec("payment.spend");
  const r2 = orderDecisions([{ ...list, seq: 60, revision: 2 } as Decision, { ...pay, seq: 61 } as Decision], 0, undefined, state(), "status.score", { answeredId: list.id });
  assert.equal(r2.queue[0].kind, "payment.spend");
});

void test("pt8: a token editor never pops up over a step of my tactical action", () => {
  const tokens = dec("command_tokens.adjust");
  const land = dec("tactical.land");
  const r = orderDecisions([tokens, land], 0, undefined, state());
  assert.ok(!r.queue.includes(tokens));
  assert.ok(r.offers.includes(tokens));
  assert.ok(orderDecisions([tokens], 0, undefined, state()).queue.includes(tokens), "no action under way: mine to answer");
});

void test("pt8: Construction's second structure leads right after the first, until set aside", () => {
  const parts = ["structure", "structure"];
  const c = dec("strategy_card.resolve", {
    scope: "table",
    window: { ...win(["u2"]), subject: { strategyCard: 4, name: "Construction", holder: "arborec", primaryDone: ["structure"] } } as unknown as Decision["window"],
    options: [opt("pds", { who: "anyone", action: "construction_structure", part: "structure", primaryParts: parts })],
  });
  const turn = dec("turn.action");
  assert.deepEqual(kinds(orderDecisions([turn, c], 0, undefined, state(), "strategy_card.construction_place")), ["strategy_card.resolve", "turn.action"]);
  const aside = orderDecisions([turn, c], 0, undefined, state(), "strategy_card.construction_place", { deferred: new Set([c.id]) });
  assert.deepEqual(kinds(aside), ["turn.action"]);
  assert.ok(aside.offers.includes(c));
});

void test("pt8: Technology's second research (6) stays offered after the free one, on my turn", () => {
  const parts = ["research"];
  const t = dec("strategy_card.resolve", {
    scope: "table",
    window: { ...win(["u2"]), responded: ["u2"], subject: { strategyCard: 7, name: "Technology", holder: "arborec", primaryDone: ["research"] } } as unknown as Decision["window"],
    options: [opt("tech", { who: "anyone", action: "research", part: "research", primaryParts: parts })],
  });
  const turn = dec("turn.action");
  assert.deepEqual(kinds(orderDecisions([turn, t], 0, undefined, state(), "payment.spend")), ["strategy_card.resolve", "turn.action"]);
  const twice = { ...t, window: { ...t.window!, subject: { ...t.window!.subject, primaryDone: ["research", "research"] } } } as Decision;
  const r = orderDecisions([turn, twice], 0, undefined, state(), "payment.spend");
  assert.deepEqual(kinds(r), ["turn.action"]);
});

void test("pt8: a card the game declined for me (no strategy token) is on offer with its follow greyed, never in front", () => {
  const s = state({
    activePlayer: "u2",
    strategyCards: [
      { number: 7, holder: "u2", played: true, name: "Technology", card: "pok7technology", holderFaction: "sol", blocksTurn: false,
        reactions: [{ faction: "sol", status: "holder", canFollow: false, cantFollowReason: null }, { faction: "arborec", status: "declined", canFollow: false, cantFollowReason: "no_strategy_token" }] },
    ] as unknown as GameState["strategyCards"],
  });
  const card = dec("strategy_card.resolve", { scope: "table", window: { ...win([ME]), responded: [ME], subject: { strategyCard: 7, holder: "sol" } } as unknown as Decision["window"] });
  const r = orderDecisions([card], 0, undefined, s);
  assert.equal(r.queue.length, 0);
  assert.ok(r.offers.includes(card));
});

void test("pt8: stacked Pillage offers collapse to the newest per neighbour; answered ones' older copies are superseded", () => {
  const pill = (target: string) => dec("faction.ability", { options: [opt(`p${target}`, { id: "pillage", target, action: "use", step: "use" }), opt(`d${target}`, { id: "pillage", target, action: "skip", step: "skip" })] });
  const a1 = pill("purple"), a2 = pill("purple"), b1 = pill("emerald");
  const r = orderDecisions([a1, a2, b1], null, undefined, state());
  assert.deepEqual(r.queue.map((d) => d.id), [a2.id, b1.id]);
  const after = orderDecisions([a1, b1], null, undefined, state(), null, { superseded: new Set([a1.id]) });
  assert.deepEqual(after.queue.map((d) => d.id), [b1.id]);
});

void test("pt9: my post-action turn menu waits behind a step of my tactical action (Thunder's Edge Warfare)", () => {
  const menu = dec("turn.action", { options: [optV("end", { action: "end_turn", abilities: false, waitingFor: [], overLimits: [] })] } as Partial<Decision>);
  const move = dec("tactical.move");
  const r = orderDecisions([menu, move], null, undefined, state());
  assert.deepEqual(kinds(r), ["tactical.move"]);
  assert.ok(r.offers.some((d) => d.kind === "turn.action"));
  const after = orderDecisions([menu], null, undefined, state());
  assert.deepEqual(kinds(after), ["turn.action"]);
});

void test("pt9: a start-of-turn menu is not moved aside by an open tactical step", () => {
  const menu = dec("turn.action", { options: [optV("tac", { action: "tactical", tacticTokens: 3 }), optV("pass", { action: "pass", abilities: false })] } as Partial<Decision>);
  const activate = dec("tactical.activate");
  const r = orderDecisions([menu, activate], null, undefined, state());
  assert.ok(kinds(r).includes("turn.action"));
});

void test("pt9: a payment I opened keeps the panel when a follow prompt opens meanwhile", () => {
  const pay = dec("payment.spend");
  const follow = dec("strategy_card.resolve", {
    window: { kind: "strategy_card.resolve", eligible: [ME], responded: [], responses: {}, subject: { strategyCard: 5, holder: "sol" } },
    options: [optV("f", { action: "follow", who: "others", strategyCard: 5 })],
  } as unknown as Partial<Decision>);
  const s = state({ strategyCards: [{ number: 5, name: "Trade", holder: "u2", played: true, reactions: [{ faction: "arborec", status: "pending", canFollow: true }] }] } as unknown as Partial<GameState>);
  const r = orderDecisions([follow, pay], null, undefined, s);
  assert.equal(r.queue[0].kind, "payment.spend");
});
