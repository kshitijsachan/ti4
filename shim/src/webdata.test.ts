// Run: cd shim && npx tsx --test src/webdata.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebDataCache } from "./webdata.js";

/** A fake bot: one game whose payload has a revision; honours If-None-Match; counts requests. */
function bot() {
  const b = {
    rev: 1,
    calls: [] as { inm: string | null }[],
    down: false,
    fetch: (async (_url: string, init?: { headers?: Record<string, string> }) => {
      const inm = init?.headers?.["if-none-match"] ?? null;
      b.calls.push({ inm });
      await new Promise((r) => setTimeout(r, 5));
      if (b.down) throw new Error("ECONNREFUSED");
      const etag = `"r${b.rev}"`;
      if (inm === etag) return new Response(null, { status: 304, headers: { etag } });
      return new Response(JSON.stringify({ gameState: { phase: `p${b.rev}` } }), { status: 200, headers: { etag } });
    }) as unknown as typeof fetch,
  };
  return b;
}

const phase = (d: any) => String(d.gameState.phase);

test("one read for concurrent callers; 304 keeps derived values; a new revision is read in full", async () => {
  const b = bot();
  const c = new WebDataCache("http://bot", b.fetch);
  let derives = 0;
  const d = (x: any) => (derives++, phase(x));
  const got = await Promise.all(Array.from({ length: 20 }, () => c.get("g", "state", 3000, d)));
  assert.deepEqual(new Set(got), new Set(["p1"]));
  assert.equal(b.calls.length, 1);
  assert.equal(derives, 1);
  // Within maxAge: no request.
  assert.equal(await c.get("g", "state", 3000, d), "p1");
  assert.equal(b.calls.length, 1);
  // Expired, unchanged: revalidated (304), not derived again.
  assert.equal(await c.get("g", "state", 0, d), "p1");
  assert.equal(b.calls.at(-1)!.inm, '"r1"');
  assert.equal(derives, 1);
  // Saved: the new payload, derived again.
  b.rev = 2;
  assert.equal(await c.get("g", "state", 0, d), "p2");
  assert.equal(derives, 2);
});

test("a kind never derived from the confirmed payload is read in full after a 304", async () => {
  const b = bot();
  const c = new WebDataCache("http://bot", b.fetch);
  assert.equal(await c.get("g", "state", 3000, phase), "p1");
  // Own read (maxAge 0): straight to a full read, no point revalidating a payload we kept nothing from.
  assert.equal(await c.get("g", "board", 0, (x) => `board:${phase(x)}`), "board:p1");
  assert.deepEqual(b.calls.map((x) => x.inm), [null, null]);
  // Shared read (maxAge > 0, expired): revalidated (304), then a full read for the kind it lacks.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await c.get("g", "factions", 10, (x) => `f:${phase(x)}`), "f:p1");
  assert.deepEqual(b.calls.map((x) => x.inm), [null, null, '"r1"', null]);
  // Every kind survived those full reads of the same revision: the next revalidation serves all from a 304.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await c.get("g", "state", 10, phase), "p1");
  assert.equal(await c.get("g", "board", 0, () => "x"), "board:p1");
  assert.deepEqual(b.calls.slice(4).map((x) => x.inm), ['"r1"', '"r1"']);
});

test("failures are null, not cached past maxAge, and never served as data; forget forces a full read", async () => {
  const b = bot();
  const c = new WebDataCache("http://bot", b.fetch);
  assert.equal(await c.get("g", "state", 3000, phase), "p1");
  b.down = true;
  assert.equal(await c.get("g", "state", 0, phase), null);
  assert.equal(await c.get("g", "state", 3000, phase), null); // remembered for maxAge
  const n = b.calls.length;
  b.down = false;
  b.rev = 3;
  assert.equal(await c.get("g", "state", 0, phase), "p3");
  assert.equal(b.calls.length, n + 1);
  assert.equal(b.calls.at(-1)!.inm, null); // after a failure: full read
  c.forget("g");
  assert.equal(await c.get("g", "state", 3000, phase), "p3");
  assert.equal(b.calls.at(-1)!.inm, null);
});
