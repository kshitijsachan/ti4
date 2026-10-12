/*
 * Engine helpers for the harness: find the open decision carrying a button, answer it as a seat.
 * Decision ids are "d" + the prompt's message id (DecisionCapture), so a carrier message names its decision.
 */
import { engineApi, sleep, type Json } from "./env.ts";

export type EngineDecision = Json & { id: string; kind: string; seq: number; options: Json[]; target?: Json | null; scope?: string };

export async function openDecisions(game: string): Promise<EngineDecision[]> {
  const r = await engineApi(`/${encodeURIComponent(game)}/decisions`);
  if (r.status !== 200) throw new Error(`decisions ${game} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.decisions ?? [];
}

const unprefixed = (id: string) => id.replace(/^FFCC_[^_]+_/, "");

/** The option of `d` that is this custom id (exact id, handler, owner-prefix-insensitive, or a select option "menu#value"). */
export function optionFor(d: EngineDecision, customId: string): Json | undefined {
  return (
    d.options.find((o) => o.id === customId) ??
    d.options.find((o) => o.handler === customId) ??
    d.options.find((o) => unprefixed(String(o.id)) === unprefixed(customId) || String(o.id).endsWith(`#${customId}`))
  );
}

/**
 * Waits for the engine to capture a decision with this button: the one on `messageId` if given, else any open
 * decision of the game with an option for `customId` (newest first). null after `timeoutMs`.
 */
export async function findDecision(game: string, customId: string, messageId?: string, timeoutMs = 8000): Promise<{ d: EngineDecision; option: Json } | null> {
  const end = Date.now() + timeoutMs;
  while (true) {
    const all = await openDecisions(game).catch(() => [] as EngineDecision[]);
    const cands = messageId ? all.filter((d) => d.id === `d${messageId}` || d.source?.messageId === messageId) : [...all].sort((a, b) => b.seq - a.seq);
    for (const d of cands) {
      const option = optionFor(d, customId);
      if (option) return { d, option };
    }
    if (Date.now() >= end) return null;
    await sleep(300);
  }
}

/** Open decisions of a kind (regex or exact), newest first, optionally only those `userId` may answer. */
export async function decisionsOfKind(game: string, kind: string | RegExp, userId?: string): Promise<EngineDecision[]> {
  const all = await openDecisions(game);
  return all
    .filter((d) => (typeof kind === "string" ? d.kind === kind : kind.test(d.kind)))
    .filter((d) => !userId || d.scope === "table" || !d.target?.userId || d.target.userId === userId)
    .sort((a, b) => b.seq - a.seq);
}

export type AnswerOutcome = { ok: boolean; httpStatus: number; status?: string; error?: string | null; path?: string | null; opened?: EngineDecision[] };

function outcome(r: { status: number; body: any }): AnswerOutcome {
  const b = typeof r.body === "object" && r.body ? r.body : { error: String(r.body) };
  return {
    ok: r.status < 300 && b.ok !== false,
    httpStatus: r.status,
    status: b.status,
    error: b.error ?? (r.status >= 300 ? String(b.message ?? JSON.stringify(b)).slice(0, 300) : null),
    path: b.path,
    opened: b.opened,
  };
}

/** POST …/decisions/{id}/answer as `userId` (Bot token). `body`: {optionId} | {optionId, values} | {payload} | {optionId:"submit", inputs}. */
export async function answer(game: string, decisionId: string, userId: string, body: Json): Promise<AnswerOutcome> {
  const r = await engineApi(`/${encodeURIComponent(game)}/decisions/${encodeURIComponent(decisionId)}/answer`, {
    userId,
    requestId: `bt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...body,
  });
  return outcome(r);
}

/** Direct action on a decision (tactical.move → "move", tactical.land → "land", combat.hits → "combat-plan"). */
export async function act(game: string, decisionId: string, action: string, userId: string, body: Json): Promise<AnswerOutcome> {
  const r = await engineApi(`/${encodeURIComponent(game)}/decisions/${encodeURIComponent(decisionId)}/${action}`, {
    userId,
    requestId: `bt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...body,
  });
  return outcome(r);
}

export async function engineState(game: string, viewer?: string): Promise<Json | null> {
  const r = await engineApi(`/${encodeURIComponent(game)}/state${viewer ? `?viewer=${viewer}` : ""}`);
  return r.status === 200 ? r.body : null;
}
