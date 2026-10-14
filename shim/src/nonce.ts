import type { Json } from "./store.js";

/**
 * Discord's `enforce_nonce` for message creates: a repeat of (channel, nonce) within the window answers with the
 * message the first request created instead of posting again. The bot retries a post that got no answer (the shim
 * froze under load: soak pbd1204) with the same nonce (ShimRetryInterceptor), so a post that did land is not doubled.
 * In memory: a shim restart forgets it, but a request the shim never answered before restarting was never stored.
 */
export class NonceCache {
  private seen = new Map<string, { at: number; id: string; json: Json }>();

  constructor(private windowMs = 10 * 60_000, private max = 5000, private now = () => Date.now()) {}

  /** The nonce a message-create body asks to enforce, or null (no nonce, enforce_nonce not set, engine ephemerals). */
  static enforced(body: Json | undefined): string | null {
    if (!body || body.enforce_nonce !== true) return null;
    const n = body.nonce;
    if ((typeof n !== "string" && typeof n !== "number") || String(n) === "" || String(n).startsWith("eph:")) return null;
    return String(n);
  }

  get(channelId: string, nonce: string): { id: string; json: Json } | undefined {
    const k = `${channelId}:${nonce}`;
    const e = this.seen.get(k);
    if (!e) return undefined;
    if (this.now() - e.at > this.windowMs) {
      this.seen.delete(k);
      return undefined;
    }
    return e;
  }

  set(channelId: string, nonce: string, id: string, json: Json) {
    this.seen.set(`${channelId}:${nonce}`, { at: this.now(), id, json });
    if (this.seen.size > this.max) {
      const cutoff = this.now() - this.windowMs;
      for (const [k, e] of this.seen) if (e.at < cutoff || this.seen.size > this.max) this.seen.delete(k);
    }
  }
}
