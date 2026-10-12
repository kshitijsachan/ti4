// Run: cd shim && npx tsx --test src/shards.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, type StoredMessage } from "./store.js";
import { CHUNK, shardKeyOf, TAIL_MAX } from "./shards.js";
import { readShimState } from "../tools/read-state.mjs";

/** Equal JSON, reported by the first difference (the whole state is too long to print). */
function same(actual: string, expected: string) {
  if (actual === expected) return;
  let i = 0;
  while (actual[i] === expected[i]) i++;
  assert.fail(`differ at ${i}: ...${actual.slice(Math.max(0, i - 80), i + 80)}... vs ...${expected.slice(Math.max(0, i - 80), i + 80)}...`);
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "shim-store-test-"));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

let n = 0;
function msg(store: Store, channelId: string, content: string): StoredMessage {
  const m: StoredMessage = { id: String(1_000_000_000_000_000n + BigInt(++n)), channel_id: channelId, content, author: { id: store.state.bot_id }, components: [] };
  store.insertMessage(m);
  return m;
}

/** A small server: two game categories with channels and threads, a root log channel with a thread, a DM. */
function populate(store: Store) {
  const cat1 = store.createChannel({ type: 4, name: "PBD #0-9" });
  const cat2 = store.createChannel({ type: 4, name: "PBD #10-19" });
  const a1 = store.createChannel({ type: 0, name: "pbd1-actions", parent_id: cat1.id });
  const b1 = store.createChannel({ type: 0, name: "pbd12-actions", parent_id: cat2.id });
  const a2 = store.createChannel({ type: 0, name: "pbd1-table-talk", parent_id: cat1.id });
  const t1 = store.createChannel({ type: 12, name: "Cards Info-pbd1-x", parent_id: a1.id });
  store.state.thread_members[t1.id].push(store.state.bot_id);
  const log = store.createChannel({ type: 0, name: "bot-log" });
  const logThread = store.createChannel({ type: 11, name: "trace", parent_id: log.id });
  const dm = store.createChannel({ type: 1, name: "dm" });
  for (const ch of [a1, b1, a2, t1, log, logThread, dm, a1, b1]) msg(store, ch.id, `hello ${ch.name}`);
  store.saveNow(true);
  return { cat1, cat2, a1, b1, a2, t1, log, logThread, dm };
}

const shardFiles = (dir: string) => readdirSync(join(dir, "store", "shards")).sort();
/** Shard / global files among written or removed names (segment names contain dots). */
const shardsIn = (names: string[]) => names.filter((n) => !n.includes(".")).sort();
const isChunk = (n: string) => /^\d+\.\d+\.\d+$/.test(n);
const isTail = (n: string) => /^\d+\.\d+\.\d+t$/.test(n);

test("shardKeyOf: games by name prefix, threads with their parent, roots / DMs / categories apart", () => {
  const chans: Record<string, any> = {
    c: { id: "c", type: 4, name: "PBD #0-9" },
    a: { id: "a", type: 0, name: "pbd95-actions", parent_id: "c" },
    t: { id: "t", type: 12, name: "Cards Info-pbd95-x", parent_id: "a" },
    l: { id: "l", type: 0, name: "lobby" },
    lt: { id: "lt", type: 11, name: "x", parent_id: "l" },
    d: { id: "d", type: 1 },
    n: { id: "n", type: 0, name: "general", parent_id: "c" },
    r: { id: "r", type: 0, name: "pbd3-actions" },
    o: { id: "o", type: 11, name: "lost", parent_id: "gone" },
  };
  assert.equal(shardKeyOf(chans, "a"), "game-pbd95");
  assert.equal(shardKeyOf(chans, "t"), "game-pbd95");
  assert.equal(shardKeyOf(chans, "c"), "categories");
  assert.equal(shardKeyOf(chans, "l"), "chan-l");
  assert.equal(shardKeyOf(chans, "lt"), "chan-l");
  assert.equal(shardKeyOf(chans, "d"), "dm-d");
  assert.equal(shardKeyOf(chans, "n"), "chan-n");
  assert.equal(shardKeyOf(chans, "r"), "chan-r"); // game channels live in a category
  assert.equal(shardKeyOf(chans, "o"), "chan-gone");
  assert.equal(shardKeyOf(chans, "missing"), "orphans");
});

test("migration from state.json: identical state (incl. key order), backup kept, reload identical", () => {
  const a = tmp();
  const src = new Store(a, { verifier: false });
  populate(src);
  // A message list whose channel is gone (kept as is) and private fields.
  src.state.messages["999"] = [{ id: "5", channel_id: "999", _presses: { u: { at: "x", controls: "" } } } as StoredMessage];
  const legacy = JSON.stringify(src.state);

  const b = tmp();
  writeFileSync(join(b, "state.json"), legacy);
  const migrated = new Store(b, { verifier: false });
  same(JSON.stringify(migrated.state), legacy);
  assert.ok(!existsSync(join(b, "state.json")));
  assert.equal(readFileSync(join(b, "state.json.pre-shards"), "utf8"), legacy);
  assert.deepEqual(shardFiles(b), ["categories.json", `chan-${Object.values(src.state.channels).find((c) => c.name === "bot-log")!.id}.json`, `dm-${Object.values(src.state.channels).find((c) => c.type === 1)!.id}.json`, "game-pbd1.json", "game-pbd12.json", "orphans.json"].sort());
  assert.ok(!readdirSync(join(b, "store")).some((f) => f.endsWith(".tmp")));

  const reloaded = new Store(b, { verifier: false });
  same(JSON.stringify(reloaded.state), legacy);
  // Nothing changed: a save (even a full check) writes nothing.
  assert.deepEqual(reloaded.saveNow(true).written, []);
});

test("a message in one game rewrites only that game's shard", () => {
  const d = tmp();
  const s = new Store(d, { verifier: false });
  const { a1, b1, t1 } = populate(s);
  msg(s, a1.id, "new");
  let w = s.saveNow().written;
  assert.deepEqual(shardsIn(w), ["game-pbd1"]);
  assert.equal(w.filter(isTail).length, 1);
  msg(s, t1.id, "in thread");
  msg(s, b1.id, "other game");
  w = s.saveNow().written;
  assert.deepEqual(shardsIn(w), ["game-pbd1", "game-pbd12"]);
  assert.equal(w.filter(isTail).length, 2);
  assert.deepEqual(s.saveNow().written, []);
  // Global changes write only the global file.
  s.addUser("Alice");
  assert.deepEqual(s.saveNow().written, ["global"]);
  const again = new Store(d, { verifier: false });
  same(JSON.stringify(again.state), JSON.stringify(s.state));
});

test("edits, deletes, thread members and channel updates are persisted", () => {
  const d = tmp();
  const s = new Store(d, { verifier: false });
  const { a1, b1, t1 } = populate(s);
  const m = s.messages(a1.id)[0];
  m.content = "edited";
  s.scheduleSave(m.channel_id);
  s.deleteMessage(b1.id, s.messages(b1.id)[0].id);
  s.state.thread_members[t1.id].push("42");
  s.scheduleSave(t1.id);
  s.channel(b1.id)!.topic = "new topic";
  s.scheduleSave(b1.id);
  assert.deepEqual(shardsIn(s.saveNow().written), ["game-pbd1", "game-pbd12"]);
  const again = new Store(d, { verifier: false });
  same(JSON.stringify(again.state), JSON.stringify(s.state));
});

test("unmarked changes: missed by a normal save, caught by the full check and the verifier", () => {
  const d = tmp();
  const s = new Store(d, { verifier: false });
  const { a1, b1 } = populate(s);
  s.messages(a1.id)[0].content = "sneaky"; // no scheduleSave
  assert.deepEqual(s.saveNow().written, []);
  assert.deepEqual(shardsIn(s.saveNow(true).written), ["game-pbd1"]);
  s.messages(b1.id)[0].content = "sneaky 2";
  const found: string[] = [];
  for (let i = 0; i < 20 && !found.length; i++) found.push(...s.disk.verifySome(s.state, 1).written);
  assert.deepEqual(shardsIn(found), ["game-pbd12"]);
  assert.ok(s.disk.unmarked.some((u) => u.startsWith("tail:")));
  same(JSON.stringify(new Store(d, { verifier: false }).state), JSON.stringify(s.state));
});

test("channel moved between games / deleted: both shards rewritten, emptied shard removed, order kept", () => {
  const d = tmp();
  const s = new Store(d, { verifier: false });
  const { a2, b1 } = populate(s);
  s.channel(a2.id)!.name = "pbd12-table-talk";
  s.scheduleSave(a2.id);
  assert.deepEqual(shardsIn(s.saveNow().written), ["game-pbd1", "game-pbd12"]);
  let again = new Store(d, { verifier: false });
  same(JSON.stringify(again.state), JSON.stringify(s.state));
  for (const id of [b1.id, a2.id]) {
    delete s.state.channels[id];
    delete s.state.messages[id];
    delete s.state.thread_members[id];
    s.scheduleSave(id);
  }
  const stats = s.saveNow();
  assert.deepEqual(shardsIn(stats.removed), ["game-pbd12"]);
  assert.ok(!shardFiles(d).includes("game-pbd12.json"));
  again = new Store(d, { verifier: false });
  same(JSON.stringify(again.state), JSON.stringify(s.state));
});

test("crash between writing a moved channel's new shard and its old one: load keeps one copy, next save cleans up", () => {
  const d = tmp();
  const s = new Store(d, { verifier: false });
  const { a2 } = populate(s);
  const before = JSON.parse(readFileSync(join(d, "store", "shards", "game-pbd1.json"), "utf8"));
  s.channel(a2.id)!.name = "pbd12-table-talk";
  s.scheduleSave(a2.id);
  s.saveNow();
  // Simulate the crash: the old shard still holds the channel (its old name).
  writeFileSync(join(d, "store", "shards", "game-pbd1.json"), JSON.stringify(before));
  const again = new Store(d, { verifier: false });
  same(JSON.stringify(again.state), JSON.stringify(s.state));
  assert.deepEqual(shardsIn(again.saveNow().written), ["game-pbd1"]);
  const pbd1 = JSON.parse(readFileSync(join(d, "store", "shards", "game-pbd1.json"), "utf8"));
  assert.ok(!(a2.id in pbd1.channels));
});

test("long channels: old messages sealed into chunks; an old edit rewrites one chunk, appends only the shard", () => {
  const d = tmp();
  const s = new Store(d, { verifier: false });
  const { a1, log } = populate(s);
  for (let i = 0; i < 3 * CHUNK + 20; i++) msg(s, a1.id, `m${i}`);
  s.saveNow();
  const chunks = s.disk.chunkCount;
  assert.ok(chunks >= 2);
  assert.ok(s.messages(a1.id).length - chunks * CHUNK < TAIL_MAX); // the tail stays below TAIL_MAX
  assert.ok(s.messages(a1.id).length - chunks * CHUNK >= TAIL_MAX - CHUNK);
  same(JSON.stringify(new Store(d, { verifier: false }).state), JSON.stringify(s.state));

  msg(s, a1.id, "new");
  let w = s.saveNow().written;
  assert.deepEqual(shardsIn(w), ["game-pbd1"]);
  assert.equal(w.filter(isChunk).length, 0);
  const old = s.messages(a1.id)[5];
  old.content = "edited long ago";
  s.scheduleSave(old.channel_id, old.id);
  w = s.saveNow().written;
  assert.deepEqual(shardsIn(w), ["game-pbd1"]);
  assert.equal(w.filter(isChunk).length, 1);
  assert.equal(w.filter(isTail).length, 0);
  same(JSON.stringify(new Store(d, { verifier: false }).state), JSON.stringify(s.state));

  // Deleting every message of the first chunk removes its file; trimming the front works the same way.
  for (const m of s.messages(a1.id).slice(0, CHUNK + 1)) s.deleteMessage(a1.id, m.id);
  let st = s.saveNow();
  assert.equal(st.removed.filter(isChunk).length, 2); // the emptied chunk, and the old copy of the trimmed one
  assert.equal(s.disk.chunkCount, chunks - 1);
  same(JSON.stringify(new Store(d, { verifier: false }).state), JSON.stringify(s.state));
  for (let i = 0; i < 400; i++) msg(s, log.id, `log${i}`);
  s.saveNow();
  s.trimMessages(log.id, TAIL_MAX + CHUNK);
  st = s.saveNow();
  assert.ok(st.removed.some((r) => r.startsWith(`${log.id}.`) && isChunk(r)));
  same(JSON.stringify(new Store(d, { verifier: false }).state), JSON.stringify(s.state));
  assert.deepEqual(new Store(d, { verifier: false }).saveNow(true).written, []);
  // The tools' reader sees the same state (sharded or legacy file).
  same(JSON.stringify(readShimState(d)), JSON.stringify(s.state));
  same(JSON.stringify(readShimState(join(d, "state.json"))), JSON.stringify(s.state));
});

test("a thread embedded in a sealed message: updating the thread rewrites that chunk", () => {
  const d = tmp();
  const s = new Store(d, { verifier: false });
  const { a1 } = populate(s);
  const first = msg(s, a1.id, "starts a thread");
  for (let i = 0; i < TAIL_MAX; i++) msg(s, a1.id, `m${i}`);
  const th = s.createChannel({ id: first.id, type: 11, name: "thread", parent_id: a1.id });
  first.thread = th;
  s.scheduleSave(a1.id, first.id);
  s.saveNow();
  assert.ok(s.disk.chunkCount >= 1);
  th.thread_metadata.archived = true;
  s.scheduleSave(th.id);
  assert.ok(s.saveNow().written.some(isChunk));
  same(JSON.stringify(new Store(d, { verifier: false }).state), JSON.stringify(s.state));
});

test("a save that dies after writing segments but before its shard: the store loads as before that save", () => {
  const d = tmp();
  const s = new Store(d, { verifier: false });
  const { a1 } = populate(s);
  for (let i = 0; i < TAIL_MAX; i++) msg(s, a1.id, `m${i}`);
  s.saveNow();
  const before = JSON.stringify(s.state);
  const crashed = tmp();
  cpSync(join(d, "store"), join(crashed, "store"), { recursive: true });
  // This save seals a chunk, rewrites the tail and an old chunk; copy only its new segment files (no shard).
  for (let i = 0; i < TAIL_MAX; i++) msg(s, a1.id, `n${i}`);
  const old = s.messages(a1.id)[3];
  old.content = "edited";
  s.scheduleSave(a1.id, old.id);
  const w = s.saveNow().written;
  assert.ok(w.some(isChunk) && w.some(isTail));
  for (const n of w.filter((x) => x.includes("."))) cpSync(join(d, "store", "segments", `${n}.json`), join(crashed, "store", "segments", `${n}.json`));
  const again = new Store(crashed, { verifier: false });
  same(JSON.stringify(again.state), before);
  assert.deepEqual(readdirSync(join(crashed, "store", "segments")).sort(), readdirSync(join(crashed, "store", "segments")).filter((f) => !w.some((n) => f === `${n}.json`)).sort());
  same(JSON.stringify(new Store(d, { verifier: false }).state), JSON.stringify(s.state));
});
