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
