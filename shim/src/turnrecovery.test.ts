// Run: cd shim && npx tsx --test src/turnrecovery.test.ts
// Soak pbd1204: a frozen shim made the bot's turn-start post time out; the bot now retries posts with an enforced
// nonce (shim answers the repeat with the first message) and the shim asks the bot to recover prompts on reconnect.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import { Hub } from "./hub.js";
import { Rest } from "./rest.js";
import { NonceCache } from "./nonce.js";
import { ReconnectRecovery } from "./reconnect.js";

test("NonceCache: only enforced, non-ephemeral nonces; window expiry", () => {
  assert.equal(NonceCache.enforced({ nonce: "a" }), null);
  assert.equal(NonceCache.enforced({ nonce: "eph:123", enforce_nonce: true }), null);
  assert.equal(NonceCache.enforced({ enforce_nonce: true }), null);
  assert.equal(NonceCache.enforced({ nonce: "rtabc", enforce_nonce: true }), "rtabc");
  let now = 1000;
  const c = new NonceCache(60_000, 10, () => now);
  c.set("1", "n", "m1", { id: "m1" });
  assert.equal(c.get("1", "n")?.id, "m1");
  assert.equal(c.get("2", "n"), undefined, "per channel");
  now += 61_000;
  assert.equal(c.get("1", "n"), undefined, "expired");
});

test("message create: a repeat of an enforced nonce returns the first message, posts nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turnrec-"));
  const store = new Store(join(dir, "data"), { verifier: false });
  const dispatched: string[] = [];
  const hub = new Hub(store, { dispatch(t: string) { dispatched.push(t); } } as any, () => "");
  const rest = new Rest(hub, () => "", () => "");
  (hub as any).rest = rest;
  const ch = store.createChannel({ type: 0, name: "pbd1-actions" });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    void rest.handle(req, res, url.pathname.replace(/^\/api\/v\d+/, ""), url.searchParams);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const post = async (body: object) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v10/channels/${ch.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 200);
    return (await res.json()) as any;
  };
  try {
    const body = { content: "it is now your turn", nonce: "rt1", enforce_nonce: true };
    const a = await post(body);
    const b = await post(body);
    assert.equal(b.id, a.id, "same message");
    assert.equal(store.messages(ch.id).length, 1, "posted once");
    assert.equal(dispatched.filter((t) => t === "MESSAGE_CREATE").length, 1);
    // Without enforce_nonce (or another nonce) it is a new message, as on Discord.
    await post({ content: "x", nonce: "rt1" });
    await post({ content: "y", nonce: "rt2", enforce_nonce: true });
    assert.equal(store.messages(ch.id).length, 3);
    // The first message deleted meanwhile: the repeat still answers with it (not re-posted).
    hub.removeMessage(ch.id, a.id);
    const c = await post(body);
    assert.equal(c.id, a.id);
    assert.equal(store.messages(ch.id).length, 2);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ReconnectRecovery: calls recover-all once per (re)connect, retries while the bot answers 503", async () => {
  const calls: string[] = [];
  const answers = [503, 503, 200];
  const fakeFetch = (async (url: string, init: any) => {
    calls.push(`${init.method} ${url} ${init.headers.authorization}`);
    const status = answers.shift() ?? 200;
    return { ok: status === 200, status, json: async () => ({ recovered: { pbd1: "turn_prompt" } }) } as any;
  }) as unknown as typeof fetch;
  const r = new ReconnectRecovery("http://bot", () => "tok", { delayMs: 5, retryMs: 5, attempts: 5, fetch: fakeFetch });
  r.onStatus(true);
  r.onStatus(true); // still ready: no second run
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(calls.length, 3);
  assert.match(calls[0], /^POST http:\/\/bot\/api\/public\/selfhost\/engine\/recover-all\?reason=gateway-reconnect Bot tok$/);
  // Disconnect, then reconnect: one more run.
  r.onStatus(false);
  r.onStatus(true);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(calls.length, 4);
  // A disconnect before the delay elapses cancels the pending run.
  r.onStatus(false);
  r.onStatus(true);
  r.onStatus(false);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(calls.length, 4);
});
