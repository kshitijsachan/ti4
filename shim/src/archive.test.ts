// Run: cd shim && npx tsx --test src/archive.test.ts
// Ended games' channels in the archive category, and back out of it when a rewind un-ends the game.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import { Hub } from "./hub.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "archive-"));
  const store = new Store(join(dir, "data"), { verifier: false });
  const sent: [string, any][] = [];
  const hub = new Hub(store, { dispatch: (t: string, d: any) => sent.push([t, d]) } as any, () => "");
  const cat = store.createChannel({ type: 4, name: "PBD #340-349" });
  const tt = store.createChannel({ type: 0, name: "pbd346-Some-Name", parent_id: cat.id });
  const act = store.createChannel({ type: 0, name: "pbd346-actions", parent_id: cat.id });
  const thread = store.createChannel({ type: 11, name: "pbd346-bot-map-updates", parent_id: act.id });
  return { dir, store, hub, sent, cat, tt, act, thread, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const calls: string[] = [];
const phaseFetch = (phase: string) => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (u: string) => (calls.push(String(u)), new Response(JSON.stringify({ gameState: { phase } })))) as any;
  return () => (globalThis.fetch = orig);
};

test("a channel moved into the archive is archived; moved back out, it is restored for the bot", () => {
  const { hub, sent, cat, act, thread, done } = setup();
  const limbo = hub.ensureArchiveCategory();
  const prev = act.parent_id;
  act.parent_id = limbo.id;
  hub.archiveIfMoved(act, prev);
  assert.equal(act._archived, true);
  assert.equal(act._archive_parent, cat.id);
  assert.ok(sent.some(([t, d]) => t === "CHANNEL_DELETE" && d.id === act.id));
  sent.length = 0;
  act.parent_id = cat.id;
  hub.restoreIfMovedOut(act);
  assert.equal(act._archived, undefined);
  assert.ok(sent.some(([t, d]) => t === "CHANNEL_CREATE" && d.id === act.id));
  assert.ok(sent.some(([t, d]) => t === "THREAD_CREATE" && d.id === thread.id));
  done();
});

test("sweep: a not-finished game's archived channels go back to its PBD category and are not re-archived", async () => {
  const { hub, store, sent, cat, tt, act, done } = setup();
  const limbo = hub.ensureArchiveCategory();
  for (const ch of [tt, act]) {
    ch.parent_id = limbo.id;
    hub.archiveChannel(ch); // archived before the fix: no _archive_parent
  }
  const restore = phaseFetch("action");
  try {
    sent.length = 0;
    assert.deepEqual(await hub.sweepEndedGames("http://bot"), { archived: 0, restored: 2, unreachable: 0 });
    for (const ch of [tt, act]) {
      assert.equal(ch._archived, undefined);
      assert.equal(ch.parent_id, cat.id);
    }
    assert.match(String(store.messages(act.id).at(-1)?.content), /on again/);
    assert.ok(calls.some((u) => u.endsWith("/engine/pbd346/recover")));
    assert.equal(sent.filter(([t]) => t === "CHANNEL_CREATE").length, 2);
    sent.length = 0;
    assert.deepEqual(await hub.sweepEndedGames("http://bot"), { archived: 0, restored: 0, unreachable: 0 });
    assert.ok(!sent.some(([t]) => t === "CHANNEL_DELETE"));
  } finally {
    restore();
  }
  done();
});

test("sweep: a finished game's channels are archived (and stay so)", async () => {
  const { hub, tt, act, cat, done } = setup();
  const restore = phaseFetch("finished");
  try {
    assert.deepEqual(await hub.sweepEndedGames("http://bot"), { archived: 2, restored: 0, unreachable: 0 });
    for (const ch of [tt, act]) {
      assert.equal(ch._archived, true);
      assert.equal(ch._archive_parent, cat.id);
    }
    assert.deepEqual(await hub.sweepEndedGames("http://bot"), { archived: 0, restored: 0, unreachable: 0 });
  } finally {
    restore();
  }
  done();
});

test("an unknown game (web-data fails) is left alone", async () => {
  const { hub, act, done } = setup();
  const limbo = hub.ensureArchiveCategory();
  act.parent_id = limbo.id;
  hub.archiveChannel(act);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response("no", { status: 404 })) as any;
  try {
    assert.equal((await hub.sweepEndedGames("http://bot")).unreachable, 0); // 404: answered, nothing to retry
    assert.equal(act._archived, true);
  } finally {
    globalThis.fetch = orig;
  }
  done();
});

test("the bot down: every game counts as unreachable, nothing changes", async () => {
  const { hub, act, done } = setup();
  const limbo = hub.ensureArchiveCategory();
  act.parent_id = limbo.id;
  hub.archiveChannel(act);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as any;
  try {
    assert.deepEqual(await hub.sweepEndedGames("http://bot"), { archived: 0, restored: 0, unreachable: 1 });
    assert.equal(act._archived, true);
  } finally {
    globalThis.fetch = orig;
  }
  done();
});
