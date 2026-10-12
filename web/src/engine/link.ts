import { useEffect } from "react";
import { usePlayConnection } from "@/discord";
import type { Decision } from "./contract";
import { engineStore, useEngineEnabled } from "./store";

/** No snapshot after this long: treat the engine as unavailable for now and let the legacy UI run. */
const SUBSCRIBE_TIMEOUT_MS = 15000;
/** While the engine is unavailable (bot restarting, or without the engine), ask again this often. */
const RETRY_MS = 30000;
const ANSWER_TIMEOUT_MS = 60000;

/**
 * Follows one game's engine stream over the play socket while the engine flag is on. Every (re)connect
 * resubscribes, resuming from the last seq applied (the shim answers with the missed events, or a full snapshot
 * when it can't vouch for them), so reload and reconnect land on the server's view exactly.
 */
export function useEngineLink(gameName: string) {
  const conn = usePlayConnection();
  const enabled = useEngineEnabled();

  useEffect(() => {
    const sync = () => engineStore.getState().setServer(conn.engineInfo);
    sync();
    return conn.onHelloFrame(sync);
  }, [conn]);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const subscribe = () => {
      const { view } = engineStore.getState();
      const resume = view.game === gameName && view.status === "live" && view.seq > 0;
      engineStore.getState().follow(gameName);
      conn.send({ op: "engine_sub", game: gameName, after: resume ? view.seq : undefined });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const v = engineStore.getState().view;
        if (v.game === gameName && v.status === "connecting") engineStore.getState().apply({ t: "engine", type: "unavailable", game: gameName });
      }, SUBSCRIBE_TIMEOUT_MS);
    };
    const offFrames = conn.onEngineFrame((frame) => {
      /* A reaction window's decision is re-issued whenever someone else answers it: an answer sent against the
         previous revision comes back "stale". Re-send it once against the current one if the option is still there. */
      if (frame.type === "answer" && !frame.result.ok && frame.result.status === "stale" && frame.nonce && retryStale(conn, frame.nonce)) return;
      if (frame.type === "answer" && frame.nonce) sent.delete(frame.nonce);
      engineStore.getState().apply(frame);
    });
    const offHello = conn.onHelloFrame(subscribe);
    const retry = window.setInterval(() => {
      const v = engineStore.getState().view;
      if (v.game === gameName && v.status === "unavailable") subscribe();
    }, RETRY_MS);
    subscribe();
    return () => {
      window.clearTimeout(timer);
      offFrames();
      offHello();
      window.clearInterval(retry);
      conn.send({ op: "engine_unsub" });
      engineStore.getState().unfollow();
    };
  }, [conn, gameName, enabled]);
}

/**
 * A renderer's structured answer: `{optionId}`; `{optionId?, payload}` (agenda ballot, token pools); or
 * `{action, body}` for any kind's direct action route (`move`, `land`, `combat-plan`, …).
 */
export type AnswerPayload = {
  optionId?: string;
  payload?: unknown;
  action?: string;
  body?: Record<string, unknown>;
  /** Select menu values (optionId = the menu's InputSchema id). */
  values?: string[];
  /** Form field values (input.form decisions, optionId "submit"). */
  inputs?: Record<string, string>;
};

/**
 * Answers a decision as me. Plain options go to the engine (`op:"answer"`, checked against the decision's seq so a
 * changed prompt is never answered blind). Options the engine can't run yet — select values (`customId#value`) and
 * buttons that open a form (`needsInput`) — take the legacy press path, so their modal still opens.
 */
export function useEngineAnswer() {
  const conn = usePlayConnection();
  return (decision: Decision, choice: string | AnswerPayload) => {
    const a: AnswerPayload = typeof choice === "string" ? { optionId: choice } : choice;
    const option = a.optionId ? decision.options.find((o) => o.id === a.optionId) : undefined;
    const typedInput = !!a.optionId && (a.values !== undefined || a.inputs !== undefined || decision.kind === "input.form");
    if (a.optionId && !typedInput && (!option || option.disabled)) return;
    if (!a.optionId && a.payload === undefined && !a.action) return;
    const plain = option && a.payload === undefined && !a.action && !typedInput;
    const { channelId, messageId } = decision.source;
    engineStore.getState().noteAnswer({ at: Date.now(), seq: engineStore.getState().view.seq, decision, optionId: a.optionId ?? null, values: a.values });
    const hash = option?.id.indexOf("#") ?? -1;
    if (plain && hash > 0) return void conn.select(channelId, messageId, option.id.slice(0, hash), [option.id.slice(hash + 1)], 3);
    if (plain && option.needsInput) return void conn.click(channelId, messageId, option.id);
    const store = engineStore.getState();
    if (store.view.pending[decision.id]) return;
    const key = a.action ?? a.optionId ?? "payload";
    const nonce = conn.send({
      op: "answer",
      game: decision.game,
      decisionId: decision.id,
      ...a,
      expectedSeq: decision.seq,
      requestId: `${decision.id}:${decision.revision ?? decision.seq}:${key}:${a.payload === undefined && !a.body && !a.values && !a.inputs ? "" : hashOf(a)}`,
    });
    if (!nonce) return store.answerFailed(decision.id, "", "Not connected to the game server — reconnecting.");
    store.answerStarted(decision.id, nonce, key);
    sent.set(nonce, { decisionId: decision.id, answer: a, retried: false });
    window.setTimeout(() => engineStore.getState().answerFailed(decision.id, nonce, "No response from the game server."), ANSWER_TIMEOUT_MS);
  };
}

type Sent = { decisionId: string; answer: AnswerPayload; retried: boolean };
/** Answers in flight from this page, by nonce (for the one stale retry). */
const sent = new Map<string, Sent>();

function retryStale(conn: ReturnType<typeof usePlayConnection>, nonce: string): boolean {
  const req = sent.get(nonce);
  sent.delete(nonce);
  if (!req || req.retried) return false;
  const view = engineStore.getState().view;
  const fresh = view.decisions[req.decisionId];
  const a = req.answer;
  if (!fresh || (a.optionId && !fresh.options.some((o) => o.id === a.optionId && !o.disabled))) return false;
  const again = conn.send({
    op: "answer",
    game: fresh.game,
    decisionId: fresh.id,
    ...a,
    expectedSeq: fresh.seq,
    requestId: `${fresh.id}:${fresh.revision ?? fresh.seq}:${a.action ?? a.optionId ?? "payload"}:${hashOf(a)}:retry`,
  });
  if (!again) return false;
  engineStore.getState().answerStarted(fresh.id, again, a.action ?? a.optionId ?? "payload");
  sent.set(again, { ...req, retried: true });
  window.setTimeout(() => engineStore.getState().answerFailed(fresh.id, again, "No response from the game server."), ANSWER_TIMEOUT_MS);
  return true;
}

/** Short stable hash of a structured answer, so a retry is idempotent but a different ballot is a new request. */
function hashOf(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
