// Run: cd shim && npx tsx --test src/retention.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import { Hub } from "./hub.js";
import { planRetention, applyRemovals, renderKind } from "./retention.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "retention-"));
  process.env.SHIM_FREED_LOG = join(dir, "freed.log");
  const store = new Store(join(dir, "data"), { verifier: false });
  const hub = new Hub(store, { dispatch() {} } as any, () => "");
  const bot = store.state.bot_id;
  const file = (name: string, fill = name) => ({ field: "files[0]", filename: name, contentType: "image/webp", data: Buffer.from(fill.repeat(50)) });
  const post = (channelId: string, name?: string, fill?: string) => {
    const atts = name ? [hub.saveAttachment(file(name, fill) as any)] : [];
    const msg = hub.buildMessage(channelId, bot, { content: name ?? "text" }, atts);
    hub.postMessage(msg);
    return msg;
  };
  const exists = (att: any) => existsSync(join(store.dataDir, "files", att.id, att.filename));
  return { dir, store, hub, post, exists, file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("renderKind: maps and milty renders, not banners or other files", () => {
  assert.equal(renderKind("pbd233_2026.10.12_-_17.05.22.webp"), "map");
  assert.equal(renderKind("pbd1_miltydraft_2026.10.09_-_16.45.39.webp"), "milty");
  assert.equal(renderKind("strategy1banner_2026.10.12_-_17.05.22.webp"), null);
  assert.equal(renderKind("colors_2026.10.12_-_17.05.22.webp"), null);
  assert.equal(renderKind("homedefense.mp3"), null);
});

test("a new map render removes renders beyond the newest 3 in its channel; other files and channels stay", () => {
  const t = setup();
  try {
    const thread = t.store.createChannel({ type: 11, name: "pbd7-bot-map-updates" });
    const other = t.store.createChannel({ type: 0, name: "pbd7-actions" });
    const banner = t.post(thread.id, "strategy1banner_2026.10.12_-_10.00.00.webp");
    const maps = [1, 2, 3, 4, 5].map((i) => t.post(thread.id, `pbd7_2026.10.12_-_10.00.0${i}.webp`).attachments[0]);
    const elsewhere = t.post(other.id, "pbd7_2026.10.12_-_09.00.00.webp").attachments[0];
    assert.deepEqual(maps.map(t.exists), [false, false, true, true, true]);
    assert.ok(t.exists(banner.attachments[0]) && t.exists(elsewhere));
    const log = readFileSync(process.env.SHIM_FREED_LOG!, "utf8").trim().split("\n");
    assert.equal(log.length, 2);
    assert.match(log[0], /superseded-map\tpbd7\t\d+\t.*pbd7_2026\.10\.12_-_10\.00\.01\.webp$/);
  } finally {
    t.done();
  }
});

test("an edit that replaces a milty render deletes the old file", () => {
  const t = setup();
  try {
    const ch = t.store.createChannel({ type: 0, name: "pbd8-actions" });
    const msg = t.post(ch.id, "pbd8_miltydraft_2026.10.12_-_10.00.00.webp");
    const old = msg.attachments[0];
    t.hub.editMessage(msg, { attachments: [{ id: "0" }] }, [{ ...t.file("pbd8_miltydraft_2026.10.12_-_10.00.09.webp"), field: "files[0]" } as any]);
    assert.equal(t.exists(old), false);
    assert.equal(t.exists(msg.attachments[0]), true);
    // Keeping the attachment (by id) keeps the file.
    t.hub.editMessage(msg, { content: "x", attachments: [{ id: msg.attachments[0].id }] }, []);
    assert.equal(t.exists(msg.attachments[0]), true);
  } finally {
    t.done();
  }
});

test("sweep: ended games keep only their final map; live games lose only superseded / unreferenced renders", async () => {
  const t = setup();
  try {
    const endedActions = t.store.createChannel({ type: 0, name: "pbd9-actions" });
    const endedMaps = t.store.createChannel({ type: 11, name: "pbd9-bot-map-updates", parent_id: endedActions.id });
    const liveActions = t.store.createChannel({ type: 0, name: "pbd10-actions" });
    const e1 = t.post(endedMaps.id, "pbd9_2026.10.12_-_10.00.01.webp").attachments[0];
    const e2 = t.post(endedMaps.id, "pbd9_2026.10.12_-_10.00.02.webp").attachments[0];
    const eBanner = t.post(endedActions.id, "action1banner_2026.10.12_-_10.00.03.webp").attachments[0];
    const lBanner = t.post(liveActions.id, "action1banner_2026.10.12_-_10.00.03.webp", "other bytes").attachments[0];
    const lMap = t.post(liveActions.id, "pbd10_2026.10.12_-_10.00.04.webp").attachments[0];
    // An upload no message has (an edit replaced it) and an older one: only the old one goes.
    const orphanNew = t.hub.saveAttachment(t.file("pbd10_miltydraft_2026.10.12_-_10.00.05.webp") as any);
    const orphanOld = t.hub.saveAttachment(t.file("pbd10_miltydraft_2026.10.12_-_10.00.06.webp") as any);
    const old = Date.now() / 1000 - 7200;
    utimesSync(join(t.store.dataDir, "files", orphanOld.id, orphanOld.filename), old, old);
    endedActions._archived = true;
    const files = join(t.store.dataDir, "files");
    const plan = await planRetention(t.store.state, files);
    const reasons = Object.fromEntries(plan.removals.map((r) => [r.id, r.reason]));
    assert.deepEqual(reasons, { [e1.id]: "ended-game", [eBanner.id]: "ended-game", [orphanOld.id]: "unreferenced-milty" });
    applyRemovals(files, plan.removals, process.env.SHIM_FREED_LOG);
    assert.deepEqual([e1, e2, eBanner, lBanner, lMap, orphanNew, orphanOld].map(t.exists), [false, true, false, true, true, true, false]);
  } finally {
    t.done();
  }
});

test("identical uploads are stored once (hard link), and removing one copy keeps the other", () => {
  const t = setup();
  try {
    const a = t.hub.saveAttachment(t.file("colors_x.webp", "same") as any);
    const b = t.hub.saveAttachment(t.file("colors_y.webp", "same") as any);
    const pa = join(t.store.dataDir, "files", a.id, a.filename);
    const pb = join(t.store.dataDir, "files", b.id, b.filename);
    assert.equal(statSync(pa).ino, statSync(pb).ino);
    rmSync(join(t.store.dataDir, "files", a.id), { recursive: true });
    assert.equal(readFileSync(pb, "utf8"), "same".repeat(50));
  } finally {
    t.done();
  }
});
