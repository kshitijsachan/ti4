/**
 * Engine stream → browsers (docs/ENGINE.md §7 W-INFRA-2). A browser socket subscribes to one game with
 * `{op:"engine_sub", game, after?}` and receives `t:"engine"` frames:
 *
 *   snapshot  {game, seq, state, decisions}  full replacement; sent on every (re)subscribe unless `after` resumes
 *   events    {game, events}                  resume backlog (seq > after), only when this process holds all of it
 *   event     {game, event}                   one EngineEvent, live, in seq order
 *   state     {game, state}                   the viewer's GameState after a state.changed (hand only for the viewer)
 *   answer    {nonce, decisionId, result}     outcome of `{op:"answer"}`
 *   unavailable {game}                        no engine (TI4_ENGINE=off, or the bot doesn't serve it): use legacy
 *
 * Visibility mirrors the bot's EngineController.visibleTo: public decisions go to everyone subscribed, private ones only
 * to their target. Events that arrive while a snapshot is being fetched are queued and flushed after it (those at or
 * below the snapshot's seq are dropped), so a client's view is exact by construction.
 */
import { log } from "../log.js";
import type { EngineClient } from "./client.js";
import { awaits, type AnswerResult, type Decision, type EngineEvent, type GameState } from "./types.js";

export type EngineSeat = { userId: string; send(frame: Record<string, unknown>): void };

type Sub = { game: string; ready: boolean; queue: EngineEvent[] };

export type AnswerOp = { nonce?: string; game?: string; decisionId?: string; optionId?: string; expectedSeq?: number; requestId?: string };

export function visibleTo(d: Decision, userId: string) {
  return d.visibility !== "private" || d.target?.userId === userId;
}

/** Why this seat may not answer the decision, or null when it may (the engine re-checks under the game lock). */
export function answerRefusal(d: Decision, userId: string, state: GameState | null): string | null {
  if (!visibleTo(d, userId)) return "not_found";
  const seated = !!state?.players.some((p) => p.userId === userId);
  if (state && !seated) return "forbidden";
  if (d.scope === "player" && d.target?.userId !== userId) return "forbidden";
  if (d.window && !awaits(d, userId)) return d.window.responded.includes(userId) ? "answered" : "forbidden";
  return null;
}

export class EngineFanout {
  private subs = new Map<EngineSeat, Sub>();
  /** game|viewer → a state fetch is running; `again` = another state.changed arrived meanwhile. */
  private stateFlight = new Map<string, { again: boolean }>();

  constructor(
    private engine: EngineClient | undefined,
    /** Server default for the web's engine flag (TI4_ENGINE_WEB=1). */
    readonly webDefault: boolean,
  ) {
    engine?.onEvent((e) => this.onEvent(e));
    engine?.onReset(() => {
      for (const [seat, sub] of this.subs) void this.subscribe(seat, sub.game);
    });
  }

  /** For the hello frame. */
  info() {
    return { available: !!this.engine, web_default: this.webDefault };
  }

  async subscribe(seat: EngineSeat, game: string, after?: number) {
    const sub: Sub = { game, ready: false, queue: [] };
    this.subs.set(seat, sub);
    const engine = this.engine;
    if (!engine) return seat.send({ t: "engine", type: "unavailable", game });
    const backlog = typeof after === "number" ? engine.since(after, game) : null;
    if (backlog) {
      sub.ready = true;
      seat.send({ t: "engine", type: "events", game, events: backlog.filter((e) => this.visible(e, seat.userId)) });
      return this.pushState(game, [seat]);
    }
    const [state, snap] = await Promise.all([engine.state(game, seat.userId, 0), engine.decisionsSnapshot(game)]);
    if (this.subs.get(seat) !== sub) return;
    if (!state || !snap) {
      sub.ready = true;
      return seat.send({ t: "engine", type: "unavailable", game });
    }
    seat.send({
      t: "engine",
      type: "snapshot",
      game,
      seq: snap.seq,
      state,
      decisions: snap.decisions.filter((d) => visibleTo(d, seat.userId)),
    });
    sub.ready = true;
    const missed = sub.queue.filter((e) => e.seq > snap.seq);
    sub.queue = [];
    for (const e of missed) this.deliver(seat, e);
    if (missed.some((e) => e.type === "state.changed")) void this.pushState(game, [seat]);
  }

  unsubscribe(seat: EngineSeat) {
    this.subs.delete(seat);
  }

  async answer(seat: EngineSeat, op: AnswerOp) {
    const reply = (result: Partial<AnswerResult> & Pick<AnswerResult, "ok" | "status">) =>
      seat.send({ t: "engine", type: "answer", nonce: op.nonce, decisionId: op.decisionId, result });
    const engine = this.engine;
    if (!engine) return reply({ ok: false, status: "unsupported", error: "The engine is off on this server." });
    const game = String(op.game ?? this.subs.get(seat)?.game ?? "");
    if (!game || !op.decisionId || !op.optionId) return reply({ ok: false, status: "bad_option", error: "game, decisionId and optionId are required" });
    const snap = await engine.decisionsSnapshot(game);
    const d = snap?.decisions.find((x) => x.id === op.decisionId);
    if (!d) return reply({ ok: false, status: "not_found", error: "That prompt is no longer open." });
    const refusal = answerRefusal(d, seat.userId, await engine.state(game, undefined, 5000));
    if (refusal === "not_found") return reply({ ok: false, status: refusal, error: "That prompt is no longer open." });
    if (refusal === "answered") return reply({ ok: false, status: "refused", error: "You already answered this." });
    if (refusal) return reply({ ok: false, status: "forbidden", error: "That prompt is for another player." });
    const result = await engine.answer(game, d.id, {
      optionId: op.optionId,
      expectedSeq: op.expectedSeq,
      requestId: op.requestId,
      userId: seat.userId,
    });
    if (!result) return reply({ ok: false, status: "error", error: "The game server did not answer." });
    log.info(`engine answer ${seat.userId} ${game} ${d.kind} ${op.optionId} -> ${result.status}${result.error ? `: ${result.error}` : ""}`);
    reply(result);
  }

  private visible(e: EngineEvent, userId: string) {
    return e.type === "state.changed" || visibleTo(e.decision, userId);
  }

  private deliver(seat: EngineSeat, e: EngineEvent) {
    if (this.visible(e, seat.userId)) seat.send({ t: "engine", type: "event", game: e.game, event: e });
  }

  private onEvent(e: EngineEvent) {
    const watchers: EngineSeat[] = [];
    for (const [seat, sub] of this.subs) {
      if (sub.game !== e.game) continue;
      if (!sub.ready) {
        sub.queue.push(e);
        continue;
      }
      this.deliver(seat, e);
      watchers.push(seat);
    }
    if (e.type === "state.changed" && watchers.length) void this.pushState(e.game, watchers);
  }

  /** Fetches each viewer's state once (coalescing bursts of state.changed) and sends it to that viewer's sockets. */
  private async pushState(game: string, seats: EngineSeat[]) {
    const viewers = new Set(seats.map((s) => s.userId));
    await Promise.all([...viewers].map((viewer) => this.pushViewerState(game, viewer)));
  }

  private async pushViewerState(game: string, viewer: string) {
    const key = `${game}|${viewer}`;
    const flight = this.stateFlight.get(key);
    if (flight) {
      flight.again = true;
      return;
    }
    const mine = { again: false };
    this.stateFlight.set(key, mine);
    try {
      do {
        mine.again = false;
        const state = await this.engine?.state(game, viewer, 0);
        if (!state) return;
        for (const [seat, sub] of this.subs) {
          if (sub.game === game && sub.ready && seat.userId === viewer) seat.send({ t: "engine", type: "state", game, state });
        }
      } while (mine.again);
    } finally {
      this.stateFlight.delete(key);
    }
  }
}
