/// <reference types="node" />
/** Run: `node --test src/engine/__tests__/reducer.test.ts` from web/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Decision, EngineEvent, GameState, ReactionWindow } from "../contract.ts";
import type { EngineFrame } from "../protocol.ts";
import { EMPTY_VIEW, myDecisions, openToAll, reduce, settleAnswer, startAnswer, subscribeView, type EngineView } from "../reducer.ts";

const G = "pbd1";
const ME = "u1";

const state = (seq: number, stateVersion = seq, extra: Partial<GameState> = {}): GameState => ({
  contract: 1, game: G, stateVersion, seq, phase: "action", ended: false, round: 2, activePlayer: ME, speaker: null,
  players: [
    { userId: ME, userName: "Me", faction: "arborec", color: "red" },
    { userId: "u2", userName: "Two", faction: "sol", color: "blue" },
  ] as GameState["players"],
  strategyCards: [], tiles: [], publicObjectives: {}, laws: [], draft: null, ...extra,
});

const dec = (id: string, seq: number, over: Partial<Decision> = {}): Decision =>
  ({
    id, game: G, kind: "legacy", seq, stateVersion: 1, target: { userId: ME, faction: "arborec", color: "red", resolvedBy: "owner_prefix" },
    scope: "player", visibility: "public", prompt: "p", options: [{ id: `${id}-a`, label: "A", style: "primary", emoji: null, disabled: false, needsInput: false, handler: "a", value: null }],
    source: { channelId: "c", messageId: id, customIdPrefix: null, ephemeral: false }, createdAt: seq, revision: 1, window: null, progress: null,
    ...over,
  }) as Decision;

const opened = (d: Decision, seq = d.seq): EngineEvent => ({ seq, type: "decision.opened", game: G, stateVersion: 1, decision: { ...d, seq }, reason: null });
const updated = (d: Decision, seq: number): EngineEvent => ({ seq, type: "decision.updated", game: G, stateVersion: 1, decision: { ...d, seq }, reason: null });
const closed = (d: Decision, seq: number): EngineEvent => ({ seq, type: "decision.closed", game: G, stateVersion: 1, decision: d, reason: "deleted" });
const changed = (seq: number): EngineEvent => ({ seq, type: "state.changed", game: G, stateVersion: seq, decision: null, reason: null });

const ev = (event: EngineEvent): EngineFrame => ({ t: "engine", type: "event", game: event.game, event });
const snap = (seq: number, decisions: Decision[], s = state(seq)): EngineFrame => ({ t: "engine", type: "snapshot", game: G, seq, state: s, decisions });
const run = (view: EngineView, ...frames: EngineFrame[]) => frames.reduce(reduce, view);
const ids = (v: EngineView) => Object.keys(v.decisions).sort();

void test("snapshot replaces the view and goes live", () => {
  const v = run(subscribeView(EMPTY_VIEW, G), snap(10, [dec("a", 5), dec("b", 9)]));
  assert.equal(v.status, "live");
  assert.equal(v.seq, 10);
  assert.deepEqual(ids(v), ["a", "b"]);
  assert.equal(v.state?.round, 2);
});

void test("frames before subscribing, or for another game, are ignored", () => {
  assert.equal(run(EMPTY_VIEW, snap(10, [dec("a", 5)])), EMPTY_VIEW);
  const v = run(subscribeView(EMPTY_VIEW, G), snap(10, []));
  const other: EngineEvent = { ...opened(dec("x", 11)), game: "other" };
  assert.deepEqual(ids(run(v, ev(other))), []);
});

void test("events apply in seq order; duplicates and older seqs are no-ops (idempotent)", () => {
  const a = dec("a", 11);
  let v = run(subscribeView(EMPTY_VIEW, G), snap(10, []), ev(opened(a)), ev(opened(dec("b", 12))), ev(closed(a, 13)));
  assert.deepEqual(ids(v), ["b"]);
  assert.equal(v.seq, 13);
  const again = run(v, ev(opened(a)), ev(opened(dec("b", 12))), ev(closed(a, 13)));
  assert.deepEqual(again, v);
  v = run(v, ev(changed(14)));
  assert.equal(v.seq, 14);
});

void test("events at or below the snapshot's seq are already in it", () => {
  const v = run(subscribeView(EMPTY_VIEW, G), snap(10, [dec("a", 5)]), ev(closed(dec("a", 5), 9)), ev(opened(dec("z", 10))));
  assert.deepEqual(ids(v), ["a"]);
});

void test("decision.updated keeps the newest revision", () => {
  const a = dec("a", 11);
  let v = run(subscribeView(EMPTY_VIEW, G), snap(10, []), ev(opened(a)), ev(updated({ ...a, revision: 3, prompt: "r3" }, 12)));
  v = run(v, ev(updated({ ...a, revision: 2, prompt: "r2" }, 13)));
  assert.equal(v.decisions.a.prompt, "r3");
  assert.equal(v.decisions.a.revision, 3);
});

void test("state frames: newer replaces, older is dropped", () => {
  let v = run(subscribeView(EMPTY_VIEW, G), snap(10, [], state(10)));
  v = run(v, { t: "engine", type: "state", game: G, state: state(20, 20, { round: 3 }) });
  assert.equal(v.state?.round, 3);
  v = run(v, { t: "engine", type: "state", game: G, state: state(15, 15, { round: 1 }) });
  assert.equal(v.state?.round, 3);
});

void test("reconnect, resumed: the backlog overlaps what we hold and lands exactly once", () => {
  const a = dec("a", 11);
  const b = dec("b", 12);
  let v = run(subscribeView(EMPTY_VIEW, G), snap(10, []), ev(opened(a)), ev(opened(b)));
  v = subscribeView(v, G);
  assert.equal(v.status, "live");
  assert.equal(v.seq, 12);
  v = run(v, { t: "engine", type: "events", game: G, events: [opened(b), closed(a, 13), opened(dec("c", 14))] });
  assert.deepEqual(ids(v), ["b", "c"]);
  assert.equal(v.seq, 14);
});

void test("reconnect, re-snapshotted (bot restart: seq went back): the snapshot wins outright", () => {
  let v = run(subscribeView(EMPTY_VIEW, G), snap(500, [dec("old", 400)]));
  v = startAnswer(v, "old", "n1", "old-a");
  v = run(subscribeView(v, G), snap(3, [dec("new", 2)], state(3, 999)));
  assert.equal(v.seq, 3);
  assert.deepEqual(ids(v), ["new"]);
  assert.deepEqual(v.pending, {});
  v = run(v, ev(opened(dec("next", 4))));
  assert.deepEqual(ids(v), ["new", "next"]);
});

void test("following another game starts from nothing", () => {
  const v = run(subscribeView(EMPTY_VIEW, G), snap(10, [dec("a", 5)]));
  const w = subscribeView(v, "other");
  assert.equal(w.game, "other");
  assert.equal(w.status, "connecting");
  assert.deepEqual(w.decisions, {});
});

void test("answers: pending until the reply; errors stay on the decision; late timeouts are ignored", () => {
  let v = run(subscribeView(EMPTY_VIEW, G), snap(10, [dec("a", 5)]));
  v = startAnswer(v, "a", "n1", "a-a");
  assert.equal(v.pending.a.optionId, "a-a");
  v = run(v, { t: "engine", type: "answer", nonce: "n1", decisionId: "a", result: { ok: false, status: "stale", error: "changed" } });
  assert.deepEqual(v.pending, {});
  assert.equal(v.errors.a, "changed");
  v = startAnswer(v, "a", "n2", "a-a");
  assert.equal(v.errors.a, undefined);
  v = run(v, { t: "engine", type: "answer", nonce: "n2", decisionId: "a", result: { ok: true, status: "done" } });
  assert.deepEqual(v.pending, {});
  v = settleAnswer(v, "a", "n2", "No response from the game server.");
  assert.equal(v.errors.a, undefined);
  v = run(v, ev(closed(dec("a", 5), 11)));
  assert.deepEqual(v.errors, {});
});

void test("affordances (ui.*) are never mine; preferences are background, listed after real prompts", () => {
  const v = run(
    subscribeView(EMPTY_VIEW, G),
    snap(30, [
      dec("undo", 3, { kind: "ui.undo_affordance" } as Partial<Decision>),
      dec("optional", 4, { kind: "ui.optional", scope: "table", target: null } as Partial<Decision>),
      dec("menu", 5, { kind: "ui.info_menu" } as Partial<Decision>),
      dec("pref", 6, { kind: "player.preference" } as Partial<Decision>),
      dec("mine", 9),
    ]),
  );
  assert.deepEqual(myDecisions(v, ME).map((d) => d.id), ["mine", "pref"]);
  assert.ok(openToAll(v.decisions.pref));
});

void test("myDecisions: my prompts, open windows I haven't answered, oldest first; not others' or untargeted", () => {
  const win = (eligible: string[], responded: string[]): ReactionWindow => ({ kind: "follow", subject: {}, eligible, responded, responses: {} });
  const v = run(
    subscribeView(EMPTY_VIEW, G),
    snap(20, [
      dec("mine", 7),
      dec("theirs", 3, { target: { userId: "u2", faction: "sol", color: "blue", resolvedBy: "owner_prefix" } }),
      dec("untargeted", 4, { target: null }),
      dec("follow", 5, { scope: "table", target: null, window: win([ME, "u2"], []) }),
      dec("followed", 6, { scope: "table", target: null, window: win([ME, "u2"], [ME]) }),
      dec("notEligible", 8, { scope: "table", target: null, window: win(["u2"], []) }),
      dec("table", 9, { scope: "table", target: null }),
    ]),
  );
  assert.deepEqual(myDecisions(v, ME).map((d) => d.id), ["follow", "mine", "table"]);
  assert.deepEqual(myDecisions(v, "spectator").map((d) => d.id), []);
  assert.deepEqual(myDecisions(v, null), []);
});

void test("the neutral seat (Dicecord) is not a player in the engine view", () => {
  const players = [...state(10).players, { userId: "n", userName: "Dicecord", faction: "neutral", color: "aberration" }] as GameState["players"];
  const v = run(subscribeView(EMPTY_VIEW, G), snap(10, [], state(10, 10, { players })));
  assert.deepEqual(v.state?.players.map((p) => p.userId), [ME, "u2"]);
  const w = run(v, { t: "engine", type: "state", game: G, state: state(11, 11, { players }) });
  assert.deepEqual(w.state?.players.map((p) => p.userId), [ME, "u2"]);
});
