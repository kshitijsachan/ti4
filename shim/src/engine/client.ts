/**
 * Typed client for the bot's engine API (trusted routes, `Authorization: Bot <bot token>`), plus a live mirror of
 * every game's open decisions fed by the SSE stream. One instance per shim process (see index.ts).
 *
 * Availability: `available` is false until the first successful call; callers fall back to legacy behaviour
 * (reading Discord messages) whenever a method returns null / the mirror is not live.
 */
import { log } from "../log.js";
import { awaits } from "./types.js";
import type { AnswerRequest, AnswerResult, Decision, DecisionsSnapshot, EngineEvent, GameState } from "./types.js";

export class EngineClient {
  /** game → decision id → decision (only while the stream is live). */
  readonly decisions = new Map<string, Map<string, Decision>>();
  private seq = 0;
  private live = false;
  private stopped = false;
  private stateCache = new Map<string, { at: number; state: GameState }>();
  private listeners = new Set<(e: EngineEvent) => void>();
  private primed = new Set<string>();
  available = false;

  constructor(
    private botApi: string,
    private botToken: () => string,
  ) {}

  private headers(json = false): Record<string, string> {
    return { authorization: `Bot ${this.botToken()}`, accept: "application/json", ...(json ? { "content-type": "application/json" } : {}) };
  }

  private url(path: string) {
    return `${this.botApi}/api/public/selfhost/engine${path}`;
  }

  /** Structured state. viewer = user id whose hand to include. Cached for maxAgeMs (0 = always fetch). */
  async state(game: string, viewer?: string, maxAgeMs = 1000): Promise<GameState | null> {
    const key = `${game}|${viewer ?? ""}`;
    const hit = this.stateCache.get(key);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.state;
    try {
      const q = viewer ? `?viewer=${encodeURIComponent(viewer)}` : "";
      const res = await fetch(this.url(`/${encodeURIComponent(game)}/state${q}`), { headers: this.headers(), signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const state = (await res.json()) as GameState;
      this.available = true;
      this.stateCache.set(key, { at: Date.now(), state });
      return state;
    } catch {
      return null;
    }
  }

  /** Authoritative faction of a seat (null while undrafted or when the engine API is unavailable). */
  async factionOf(game: string, userId: string): Promise<string | null> {
    const s = await this.state(game, undefined, 5000);
    let p = s?.players.find((x) => x.userId === userId);
    if (s && !p?.faction) p = (await this.state(game, undefined, 0))?.players.find((x) => x.userId === userId);
    return p?.faction ?? null;
  }

  async openDecisions(game: string): Promise<Decision[] | null> {
    if (this.live && this.primed.has(game)) return [...(this.decisions.get(game)?.values() ?? [])].sort((a, b) => a.seq - b.seq);
    try {
      const res = await fetch(this.url(`/${encodeURIComponent(game)}/decisions`), { headers: this.headers(), signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const snap = (await res.json()) as DecisionsSnapshot;
      this.available = true;
      if (this.live) {
        this.decisions.set(game, new Map(snap.decisions.map((d) => [d.id, d])));
        this.primed.add(game);
      }
      return snap.decisions;
    } catch {
      return null;
    }
  }

  /** Open decisions waiting on this seat (its own prompts, and reaction windows it has not answered). */
  async decisionsFor(game: string, userId: string): Promise<Decision[] | null> {
    const all = await this.openDecisions(game);
    return all?.filter((d) => (d.scope === "player" ? d.target?.userId === userId : !!d.window && awaits(d, userId))) ?? null;
  }

  async answer(game: string, decisionId: string, req: AnswerRequest & { userId: string }): Promise<AnswerResult | null> {
    try {
      const res = await fetch(this.url(`/${encodeURIComponent(game)}/decisions/${encodeURIComponent(decisionId)}/answer`), {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(60000),
      });
      if (res.status === 404 && !res.headers.get("content-type")?.includes("json")) return null;
      return (await res.json()) as AnswerResult;
    } catch {
      return null;
    }
  }

  /**
   * A kind-specific direct action on a decision (POST …/decisions/{id}/{verb}, e.g. "move" / "land" for tactical
   * decisions; body per kind, userId included). Same AnswerResult shape as answer().
   */
  async act(game: string, decisionId: string, verb: string, body: Record<string, unknown> & { userId: string }): Promise<AnswerResult | null> {
    try {
      const res = await fetch(this.url(`/${encodeURIComponent(game)}/decisions/${encodeURIComponent(decisionId)}/${verb}`), {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.headers.get("content-type")?.includes("json")) return null;
      return (await res.json()) as AnswerResult;
    } catch {
      return null;
    }
  }

  onEvent(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Follows the SSE firehose forever (reconnecting with Last-Event-ID), keeping `decisions` current. */
  start() {
    void this.loop();
  }

  stop() {
    this.stopped = true;
  }

  private async loop() {
    let backoff = 1000;
    while (!this.stopped) {
      try {
        const res = await fetch(this.url(`/stream?after=${this.seq}`), { headers: { ...this.headers(), accept: "text/event-stream" } });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        this.available = true;
        this.live = true;
        backoff = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            this.handleBlock(block);
          }
        }
      } catch (e) {
        if (this.live) log.warn(`engine stream lost: ${(e as Error).message}`);
      }
      this.live = false;
      this.primed.clear();
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 15000);
    }
  }

  private handleBlock(block: string) {
    let name = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trimStart();
    }
    if (!data) return;
    const json = JSON.parse(data);
    if (name === "reset") {
      this.seq = json.seq;
      this.decisions.clear();
      this.primed.clear();
      return;
    }
    const e = json as EngineEvent;
    if (e.seq <= this.seq) return;
    this.seq = e.seq;
    const map = this.decisions.get(e.game) ?? new Map<string, Decision>();
    this.decisions.set(e.game, map);
    if (e.type === "decision.opened" || e.type === "decision.updated") map.set(e.decision.id, e.decision);
    else if (e.type === "decision.closed") map.delete(e.decision.id);
    else if (e.type === "state.changed") for (const k of this.stateCache.keys()) if (k.startsWith(`${e.game}|`)) this.stateCache.delete(k);
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* listener bug must not kill the stream */
      }
    }
  }
}
