import type { Decision, EngineEvent, GameState } from "./contract";
import type { EngineFrame } from "./protocol";

export type EngineStatus = "off" | "connecting" | "live" | "unavailable";

export type AnswerPending = { nonce: string; optionId: string; at: number };

/**
 * One game's engine view, fed only by the shim's `t:"engine"` frames. `seq` is the last stream position applied:
 * events at or below it are duplicates and ignored, so frames may be replayed freely (idempotent).
 */
export type EngineView = {
  game: string | null;
  status: EngineStatus;
  seq: number;
  state: GameState | null;
  /** Open decisions visible to me, by id. */
  decisions: Record<string, Decision>;
  /** Decision id → my answer in flight. */
  pending: Record<string, AnswerPending>;
  /** Decision id → why my last answer failed. */
  errors: Record<string, string>;
};

export const EMPTY_VIEW: EngineView = { game: null, status: "off", seq: 0, state: null, decisions: {}, pending: {}, errors: {} };

/** Start following a game: drops another game's view, keeps this game's (a resubscribe resumes from `seq`). */
export function subscribeView(view: EngineView, game: string): EngineView {
  if (view.game === game) return { ...view, status: view.status === "live" ? "live" : "connecting" };
  return { ...EMPTY_VIEW, game, status: "connecting" };
}

/** A state snapshot replaces ours unless it is older (fetched before one we already hold). */
function newerState(cur: GameState | null, next: GameState): GameState {
  if (!cur || cur.game !== next.game) return next;
  if (next.seq >= cur.seq || next.stateVersion > cur.stateVersion) return next;
  return cur;
}

function applyEvent(view: EngineView, e: EngineEvent): EngineView {
  if (e.game !== view.game || e.seq <= view.seq) return view;
  if (e.type === "state.changed") return { ...view, seq: e.seq };
  const decisions = { ...view.decisions };
  if (e.type === "decision.closed") delete decisions[e.decision.id];
  else decisions[e.decision.id] = e.decision;
  return { ...view, seq: e.seq, decisions };
}

/** Drops in-flight / error marks of decisions that are gone. */
function prune(view: EngineView): EngineView {
  const open = (rec: Record<string, unknown>) => Object.keys(rec).every((id) => view.decisions[id]);
  if (open(view.pending) && open(view.errors)) return view;
  const keep = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([id]) => view.decisions[id]));
  return { ...view, pending: keep(view.pending), errors: keep(view.errors) };
}

export function reduce(view: EngineView, frame: EngineFrame): EngineView {
  switch (frame.type) {
    case "snapshot":
      if (frame.game !== view.game) return view;
      return prune({
        ...view,
        status: "live",
        seq: frame.seq,
        state: frame.state,
        decisions: Object.fromEntries(frame.decisions.map((d) => [d.id, d])),
      });
    case "events":
      if (frame.game !== view.game) return view;
      return prune(frame.events.reduce(applyEvent, { ...view, status: "live" as const }));
    case "event":
      return prune(applyEvent(view, frame.event));
    case "state":
      if (frame.game !== view.game) return view;
      return { ...view, state: newerState(view.state, frame.state) };
    case "unavailable":
      if (frame.game !== view.game) return view;
      return { ...view, status: "unavailable" };
    case "answer":
      return settleAnswer(view, frame.decisionId, frame.nonce, frame.result.ok ? null : (frame.result.error ?? frame.result.status));
  }
}

export function startAnswer(view: EngineView, decisionId: string, nonce: string, optionId: string, at = Date.now()): EngineView {
  const errors = { ...view.errors };
  delete errors[decisionId];
  return { ...view, pending: { ...view.pending, [decisionId]: { nonce, optionId, at } }, errors };
}

/** An answer finished (error = null on success). Ignores replies to an answer that was superseded. */
export function settleAnswer(view: EngineView, decisionId: string | undefined, nonce: string | undefined, error: string | null): EngineView {
  const id = decisionId ?? Object.keys(view.pending).find((k) => view.pending[k].nonce === nonce);
  if (!id) return view;
  if (nonce && view.pending[id]?.nonce !== nonce) return view;
  const pending = { ...view.pending };
  delete pending[id];
  const errors = { ...view.errors };
  if (error && view.decisions[id]) errors[id] = error;
  else delete errors[id];
  return { ...view, pending, errors };
}

/**
 * Decisions waiting on this user, oldest first: addressed to me, or open to the whole table (each seat answers for
 * itself). Untargeted player-scoped prompts are not "mine": the engine could not tell whose they are.
 */
export function myDecisions(view: EngineView, userId: string | null | undefined): Decision[] {
  if (!userId) return [];
  const seated = !!view.state?.players.some((p) => p.userId === userId);
  return Object.values(view.decisions)
    .filter((d) => d.target?.userId === userId || (d.scope === "table" && seated))
    .sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
}
