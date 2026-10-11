/**
 * Typed client for the bot's engine API (trusted routes, `Authorization: Bot <bot token>`), plus a live mirror of
 * every game's open decisions fed by the SSE stream. One instance per shim process (see index.ts).
 *
 * Availability: `available` is false until the first successful call; callers fall back to legacy behaviour
 * (reading Discord messages) whenever a method returns null / the mirror is not live.
 */
import { log } from "../log.js";
import { awaits } from "./types.js";
import type { AnswerRequest, AnswerResult, Decision, DecisionsSnapshot, EngineEvent, GameState, TradeProposal, TradeProposeResult } from "./types.js";

export class EngineClient {
  /** game → decision id → decision (only while the stream is live). */
  readonly decisions = new Map<string, Map<string, Decision>>();
  private seq = 0;
  private live = false;
  private stopped = false;
  private stateCache = new Map<string, { at: number; state: GameState }>();
  private listeners = new Set<(e: EngineEvent) => void>();
  private resetListeners = new Set<() => void>();
  private primed = new Set<string>();
  /** Recent events (all games), oldest first; complete for every seq > ringFloor. Lets a browser resume by seq. */
  private ring: EngineEvent[] = [];
  private ringFloor = 0;
  private everLive = false;
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
    return (await this.decisionsSnapshot(game))?.decisions ?? null;
  }

  /**
   * Every open decision of a game and the stream position they are current as of: events with a higher seq apply on
   * top. From the live mirror when primed, else fetched (and the mirror primed, replaying events that raced the fetch).
   */
  async decisionsSnapshot(game: string): Promise<DecisionsSnapshot | null> {
    if (this.live && this.primed.has(game)) return this.mirrorSnapshot(game);
    try {
      const res = await fetch(this.url(`/${encodeURIComponent(game)}/decisions`), { headers: this.headers(), signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const snap = (await res.json()) as DecisionsSnapshot;
      this.available = true;
      if (!this.live || snap.seq > this.seq) return snap;
      const map = new Map(snap.decisions.map((d) => [d.id, d]));
      for (const e of this.ring) if (e.game === game && e.seq > snap.seq) applyTo(map, e);
      this.decisions.set(game, map);
      this.primed.add(game);
      return this.mirrorSnapshot(game);
    } catch {
      return null;
    }
  }

  private mirrorSnapshot(game: string): DecisionsSnapshot {
    return { seq: this.seq, decisions: [...(this.decisions.get(game)?.values() ?? [])].sort((a, b) => a.seq - b.seq) };
  }

  /** Last stream seq applied. */
  get currentSeq() {
    return this.seq;
  }

  get isLive() {
    return this.live;
  }

  /** One game's events with seq > after, or null when this process can't vouch for all of them (re-snapshot). */
  since(after: number, game: string): EngineEvent[] | null {
    if (!this.live || after < this.ringFloor || after > this.seq) return null;
    return this.ring.filter((e) => e.seq > after && e.game === game);
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
   * A kind's direct action (`POST …/decisions/{id}/{action}`, e.g. tactical `move` / `land`): the body's fields plus
   * userId / expectedSeq / requestId, answered with the same AnswerResult shape.
   */
  async act(game: string, decisionId: string, action: string, body: Record<string, unknown>): Promise<AnswerResult | null> {
    if (!/^[a-z][a-z_-]*$/.test(action) || action === "answer") return null;
    try {
      const res = await fetch(this.url(`/${encodeURIComponent(game)}/decisions/${encodeURIComponent(decisionId)}/${action}`), {
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

  /** Typed action trade.propose as `userId` (the receiver gets a trade.offer decision). */
  async proposeTrade(game: string, proposal: TradeProposal & { userId: string }): Promise<TradeProposeResult | null> {
    try {
      const res = await fetch(this.url(`/${encodeURIComponent(game)}/actions/trade.propose`), {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify(proposal),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.headers.get("content-type")?.includes("json")) return null;
      return (await res.json()) as TradeProposeResult;
    } catch {
      return null;
    }
  }

  onEvent(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The stream restarted from a new position (buffer overrun, bot restart): mirrors are gone, re-snapshot. */
  onReset(fn: () => void): () => void {
    this.resetListeners.add(fn);
    return () => this.resetListeners.delete(fn);
  }

  private resetTo(seq: number) {
    this.seq = seq;
    this.ring = [];
    this.ringFloor = seq;
    this.decisions.clear();
    this.primed.clear();
    this.stateCache.clear();
    for (const l of this.resetListeners) {
      try {
        l();
      } catch {
        /* listener bug must not kill the stream */
      }
    }
  }

  /** After a bot restart its seq starts over: resuming from ours would skip everything until it catches up. */
  private async checkRestart() {
    try {
      const res = await fetch(this.url(`/_/decisions`), { headers: this.headers(), signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const { seq } = (await res.json()) as DecisionsSnapshot;
      if (typeof seq === "number" && seq < this.seq) {
        log.warn(`engine seq went back (${this.seq} -> ${seq}): bot restarted, re-snapshotting`);
        this.resetTo(seq);
      }
    } catch {
      /* the stream attempt below reports it */
    }
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
        if (this.everLive) await this.checkRestart();
        const res = await fetch(this.url(`/stream?after=${this.seq}`), { headers: { ...this.headers(), accept: "text/event-stream" } });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        this.available = true;
        this.live = true;
        this.everLive = true;
        backoff = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          // Linear in the chunk: a burst (e.g. thousands of decision.opened after a bot restart rebuild) arrives as
          // one multi-MB chunk; re-slicing the remaining buffer per event was quadratic and froze the event loop.
          let start = 0;
          let i: number;
          while ((i = buf.indexOf("\n\n", start)) >= 0) {
            this.handleBlock(buf.slice(start, i));
            start = i + 2;
          }
          buf = start ? buf.slice(start) : buf;
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
    if (name === "reset") return this.resetTo(json.seq);
    const e = json as EngineEvent;
    if (e.seq <= this.seq) return;
    this.seq = e.seq;
    this.ring.push(e);
    if (this.ring.length > RING_SIZE) this.ringFloor = this.ring.shift()!.seq;
    const map = this.decisions.get(e.game) ?? new Map<string, Decision>();
    this.decisions.set(e.game, map);
    applyTo(map, e);
    if (e.type === "state.changed") for (const k of this.stateCache.keys()) if (k.startsWith(`${e.game}|`)) this.stateCache.delete(k);
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* listener bug must not kill the stream */
      }
    }
  }
}

const RING_SIZE = 3000;

function applyTo(map: Map<string, Decision>, e: EngineEvent) {
  if (e.type === "decision.opened" || e.type === "decision.updated") map.set(e.decision.id, e.decision);
  else if (e.type === "decision.closed") map.delete(e.decision.id);
}
