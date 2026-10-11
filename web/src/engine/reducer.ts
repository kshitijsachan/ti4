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
  const held = decisions[e.decision.id];
  if (e.type === "decision.closed") delete decisions[e.decision.id];
  else if (!held || (e.decision.revision ?? 0) >= (held.revision ?? 0)) decisions[e.decision.id] = e.decision;
  return { ...view, seq: e.seq, decisions };
}

/**
 * Is this decision waiting on `userId`? Same rule as the contract's `awaits` (shim/src/engine/types.ts; the web only
 * imports the contract's types): a reaction window while I'm eligible and haven't responded, else my own prompt.
 */
export function awaits(d: Decision, userId: string): boolean {
  if (d.window) return d.window.eligible.includes(userId) && !d.window.responded.includes(userId);
  if (d.scope === "player") return d.target?.userId === userId;
  return true;
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

/** An answer finished (error = null on success). Ignores replies to an answer that was superseded or already settled. */
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
 * Decisions waiting on this user, oldest first (`awaits`): my prompts, reaction windows I still have to answer, and
 * window-less table prompts if I'm seated. Untargeted player-scoped prompts are not "mine": the engine couldn't tell.
 */
export function myDecisions(view: EngineView, userId: string | null | undefined): Decision[] {
  if (!userId) return [];
  const seated = !!view.state?.players.some((p) => p.userId === userId);
  const myFaction = view.state?.players.find((p) => p.userId === userId)?.faction;
  // The strategy card I played: its window lists followers only; I resolve the primary on it (answersOutsideWindow).
  const holding = (d: Decision) => d.kind === "strategy_card.resolve" && !!myFaction && d.window?.subject?.holder === myFaction;
  return Object.values(view.decisions)
    .filter((d) => (awaits(d, userId) || holding(d)) && (d.scope === "player" || !!d.window || seated || holding(d)))
    .sort((a, b) => Number(openToAll(a)) - Number(openToAll(b)) || a.createdAt - b.createdAt || a.seq - b.seq);
}

/**
 * A background prompt — window-less table prompt (anyone may press it; usually an untyped menu) or an optional
 * decide-in-advance prompt: never "waiting on me" for the header, never pops up on its own, listed after the prompts
 * that are really mine.
 */
export function openToAll(d: Decision): boolean {
  return (d.scope === "table" && !d.window) || IN_ADVANCE.has(d.kind);
}

/**
 * Optional "decide in advance" prompts that sit in a player's cards thread all round (pre-decline a strategy card,
 * pre-play an action card, queue a draft or strategy-card pick): background, like window-less table prompts (live:
 * hundreds open per game).
 */
const IN_ADVANCE = new Set<string>(["strategy_card.pre_decline", "action_card.preassign", "draft.milty.queue", "strategy_card.queue_pick"]);
