import type { Json } from "./store.js";

/**
 * The bot's web data (GET /api/public/game/{g}/web-data), read once per game for every seat and reader, and
 * revalidated with its ETag: an unchanged game answers 304 for the price of one stat on the bot (it used to parse
 * the save and rebuild the payload for each of ~30 reads/s, live soak 02:43). Callers keep what they derive from it
 * (phase, factions, board), never the payload itself (~50 KB of JSON per game x ~700 games), keyed by kind: a 304
 * keeps those, a new payload drops them.
 *
 * - At most one read per game at a time; callers that miss together share it (maxAgeMs > 0).
 * - maxAgeMs <= 0: a read of its own that starts now (a read already under way may predate what the caller did).
 * - A failed read (bot down, timeout, 404) is remembered as null for the caller's maxAgeMs, so a dead bot is not
 *   hammered; the read after it is a full one.
 */
export class WebDataCache {
  private entries = new Map<string, Entry>();
  private reads = new Map<string, Promise<Read>>();

  constructor(
    private botApi: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async get<T>(game: string, kind: string, maxAgeMs: number, derive: (data: Json) => T, timeoutMs = 8000): Promise<T | null> {
    const e = this.entries.get(game);
    if (e && maxAgeMs > 0 && Date.now() - e.at < maxAgeMs) {
      if (e.failed) return null;
      if (e.derived.has(kind)) return e.derived.get(kind) as T;
    }
    let r = await this.read(game, maxAgeMs, timeoutMs, !!e?.derived.has(kind));
    // 304, but this kind was never derived from the payload it confirms (another reader's): read it in full.
    if (r.kind === "unchanged" && !r.entry.derived.has(kind)) r = await this.read(game, 0, timeoutMs, false);
    if (r.kind === "failed") return null;
    const entry = r.entry;
    if (!entry.derived.has(kind)) {
      if (r.kind !== "fresh") return null;
      entry.derived.set(kind, derive(r.data));
    }
    return entry.derived.get(kind) as T;
  }

  /** Forget a game (rewound, ended and swept): the next read is a full one. */
  forget(game: string) {
    this.entries.delete(game);
    this.reads.delete(game);
  }

  get size() {
    return this.entries.size;
  }

  private read(game: string, maxAgeMs: number, timeoutMs: number, revalidate: boolean): Promise<Read> {
    if (maxAgeMs <= 0) return this.fetchOnce(game, timeoutMs, revalidate);
    let p = this.reads.get(game);
    if (!p) {
      p = this.fetchOnce(game, timeoutMs, true).finally(() => {
        if (this.reads.get(game) === p) this.reads.delete(game);
      });
      this.reads.set(game, p);
    }
    return p;
  }

  private async fetchOnce(game: string, timeoutMs: number, revalidate: boolean): Promise<Read> {
    const prev = this.entries.get(game);
    const etag = revalidate && prev && !prev.failed ? prev.etag : null;
    try {
      const res = await this.fetchImpl(`${this.botApi}/api/public/game/${encodeURIComponent(game)}/web-data`, {
        headers: etag ? { "if-none-match": etag } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 304) {
        if (!prev || !etag || this.entries.get(game) !== prev) return this.fetchOnce(game, timeoutMs, false); // forgotten meanwhile
        prev.at = Date.now();
        return { kind: "unchanged", entry: prev };
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as Json;
      const tag = res.headers.get("etag");
      // Same tag as what we hold (a full read for a kind we lacked): same payload, keep the other kinds.
      const keep = prev && !prev.failed && tag && prev.etag === tag ? prev.derived : new Map<string, unknown>();
      const entry: Entry = { at: Date.now(), etag: tag, failed: false, derived: keep };
      this.entries.set(game, entry);
      return { kind: "fresh", entry, data };
    } catch {
      this.entries.set(game, { at: Date.now(), etag: null, failed: true, derived: new Map() });
      return { kind: "failed" };
    }
  }
}

type Entry = { at: number; etag: string | null; failed: boolean; derived: Map<string, unknown> };
type Read = { kind: "fresh"; entry: Entry; data: Json } | { kind: "unchanged"; entry: Entry } | { kind: "failed" };
