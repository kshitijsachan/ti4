// Run: cd shim && npx tsx --test src/views.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import { Slicer } from "./lag.js";

function store() {
  const dir = mkdtempSync(join(tmpdir(), "views-"));
  const s = new Store(dir, { verifier: false });
  return { s, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("canView / visibleChannels: cached answers follow invalidateViews, and never thrash with many users x channels", () => {
  const { s, done } = store();
  try {
    const g = s.state.guild_id;
    const users = Array.from({ length: 60 }, (_, i) => s.addUser(`p${i}`).id);
    const role = "900";
    s.state.roles[role] = { id: role, name: "players", permissions: "0" };
    const cat = s.createChannel({ type: 4, name: "game", permission_overwrites: [{ id: g, type: 0, allow: "0", deny: "1024" }, { id: role, type: 0, allow: "1024", deny: "0" }] });
    const chans = Array.from({ length: 4000 }, (_, i) => s.createChannel({ type: 0, name: `pbd${i}-actions`, parent_id: cat.id, permission_overwrites: [{ id: g, type: 0, allow: "0", deny: "1024" }, { id: role, type: 0, allow: "1024", deny: "0" }] }));
    // Nobody has the role yet: nothing visible.
    assert.equal(s.visibleChannels(users[0]).length, 0);
    s.state.members[users[0]].roles.push(role);
    // Still cached until something says permissions changed (REST role routes and Hub do).
    assert.equal(s.canView(users[0], chans[0].id), false);
    s.invalidateViews();
    assert.equal(s.canView(users[0], chans[0].id), true);
    assert.equal(s.visibleChannels(users[0]).length, 4001);
    // 60 users x 4000 channels (240k answers, past the old 200k clear-all): a second pass is all cache hits.
    for (const u of users) for (const c of chans) s.canView(u, c.id);
    const t = performance.now();
    for (const u of users) for (const c of chans) s.canView(u, c.id);
    assert.ok(performance.now() - t < 400, `warm pass took ${Math.round(performance.now() - t)}ms`);
    // A private thread: visible to its members only, and a member change invalidates.
    const th = s.createChannel({ type: 12, name: "Cards Info-pbd1-p1", parent_id: chans[1].id });
    assert.equal(s.canView(users[0], th.id), false);
    s.state.thread_members[th.id].push(users[0]);
    s.invalidateViews();
    assert.ok(s.visibleChannels(users[0]).some((c) => c.id === th.id));
    const gen = s.viewGeneration;
    s.invalidateViews();
    assert.notEqual(s.viewGeneration, gen);
  } finally {
    done();
  }
});

test("Slicer yields to the event loop during a long loop", async () => {
  const slicer = new Slicer("test loop", 10);
  let timerRan = false;
  setTimeout(() => (timerRan = true), 0);
  const t = performance.now();
  // Busy until the timer has run (a loop without yields would never let it), at most 3 s.
  while (!timerRan && performance.now() - t < 3000) {
    for (let i = 0; i < 1e4; i++);
    await slicer.tick();
  }
  slicer.done();
  assert.ok(timerRan, "a timer got to run while the loop was going");
  assert.ok(slicer.busyMs > 0);
});

test("invalidateChannels: only the changed channel (and its threads) is re-checked; answers match a fresh store's", () => {
  const { s, done } = store();
  try {
    const g = s.state.guild_id;
    const users = Array.from({ length: 20 }, (_, i) => s.addUser(`q${i}`).id);
    const role = "901";
    s.state.roles[role] = { id: role, name: "players", permissions: "0" };
    for (const u of users.slice(0, 10)) s.state.members[u].roles.push(role);
    s.invalidateViews();
    const ows = [{ id: g, type: 0, allow: "0", deny: "1024" }, { id: role, type: 0, allow: "1024", deny: "0" }];
    const chans = Array.from({ length: 300 }, (_, i) => s.createChannel({ type: 0, name: `pbd${i}-actions`, permission_overwrites: ows.map((o) => ({ ...o })) }));
    const before = users.map((u) => s.visibleChannels(u));
    assert.equal(before[0].length, 300);
    assert.equal(before[15].length, 0);
    // A public thread under a game channel: in its viewers' lists at once, nobody else's list rebuilt.
    const listOf15 = s.visibleChannels(users[15]);
    const th = s.createChannel({ type: 11, name: "pbd3-round-1-Politics", parent_id: chans[3].id });
    assert.ok(s.visibleChannels(users[0]).some((c) => c.id === th.id));
    assert.equal(s.visibleChannels(users[15]), listOf15, "an unrelated user's list is kept");
    // Overwrites of the parent change (REST PUT /channels/:c/permissions): parent and thread follow for everyone.
    chans[3].permission_overwrites.push({ id: users[15], type: 1, allow: "1024", deny: "0" });
    s.invalidateChannels([chans[3].id]);
    assert.equal(s.canView(users[15], chans[3].id), true);
    assert.equal(s.canView(users[15], th.id), true);
    assert.deepEqual(s.visibleChannels(users[15]).map((c) => c.id), [chans[3].id, th.id]);
    // Private thread members (Hub.addThreadMember) and a deleted channel.
    const priv = s.createChannel({ type: 12, name: "Cards Info-pbd5-q1", parent_id: chans[5].id });
    assert.equal(s.canView(users[1], priv.id), false);
    s.state.thread_members[priv.id].push(users[1]);
    s.invalidateChannels([priv.id]);
    assert.equal(s.canView(users[1], priv.id), true);
    delete s.state.channels[chans[7].id];
    s.invalidateChannels([chans[7].id]);
    assert.ok(!s.visibleChannels(users[0]).some((c) => c.id === chans[7].id));
    // Same answers as recomputing everything.
    const scoped = users.map((u) => s.visibleChannels(u).map((c) => c.id));
    s.invalidateViews();
    assert.deepEqual(users.map((u) => s.visibleChannels(u).map((c) => c.id)), scoped);
    // channelGeneration moves with every channel change (per-game channel indexes), viewGeneration only with full drops.
    const cg = s.channelGeneration;
    const vg = s.viewGeneration;
    s.createChannel({ type: 11, name: "pbd9-combat", parent_id: chans[9].id });
    assert.notEqual(s.channelGeneration, cg);
    assert.equal(s.viewGeneration, vg);
  } finally {
    done();
  }
});

test("Slicer: many loops slicing at once still let the event loop turn every slice (one slice per turn)", async () => {
  let worst = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 1);
  const loops = Array.from({ length: 30 }, async (_, i) => {
    const slicer = new Slicer(`loop ${i}`, 10);
    const end = performance.now() + 400;
    while (performance.now() < end) {
      for (let k = 0; k < 1e3; k++);
      await slicer.tick();
    }
    slicer.done();
  });
  await Promise.all(loops);
  clearInterval(timer);
  // 30 loops x 10 ms slices back to back would hold timers for ~300 ms per turn.
  assert.ok(worst < 120, `a timer waited ${Math.round(worst)}ms`);
});

test("changedSince: the channels whose messages / channel changed after a change number; null when unsure", () => {
  const { s, done } = store();
  try {
    const a = s.createChannel({ type: 0, name: "pbd1-actions" });
    const b = s.createChannel({ type: 0, name: "pbd2-actions" });
    const seq = s.changeSequence;
    const gen = s.globalGeneration;
    assert.deepEqual(s.changedSince(seq, gen), new Set());
    s.insertMessage({ id: "11", channel_id: a.id, content: "x", timestamp: new Date().toISOString() } as never);
    s.insertMessage({ id: "12", channel_id: a.id, content: "y", timestamp: new Date().toISOString() } as never);
    assert.deepEqual(s.changedSince(seq, gen), new Set([a.id]));
    const mid = s.changeSequence;
    s.scheduleSave(b.id, "13"); // an edit
    assert.deepEqual(s.changedSince(seq, gen), new Set([a.id, b.id]));
    assert.deepEqual(s.changedSince(mid, gen), new Set([b.id]));
    // Global state (users, seats, roles): anything may have changed.
    s.addUser("someone");
    assert.equal(s.changedSince(s.changeSequence, gen), null);
    assert.deepEqual(s.changedSince(s.changeSequence, s.globalGeneration), new Set());
    // Without a generation: only the channels, whatever global state changed (Autopilot.syncGameCache).
    assert.deepEqual(s.changedSince(mid), new Set([b.id]));
    s.addUser("someone else");
    s.insertMessage({ id: "14", channel_id: a.id, content: "z", timestamp: new Date().toISOString() } as never);
    assert.deepEqual(s.changedSince(mid), new Set([a.id, b.id]));
  } finally {
    done();
  }
});
