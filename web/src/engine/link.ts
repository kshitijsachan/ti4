import { useEffect } from "react";
import { usePlayConnection } from "@/discord";
import type { Decision } from "./contract";
import { engineStore, useEngineEnabled } from "./store";

/** No snapshot after this long: treat the engine as unavailable for now and let the legacy UI run. */
const SUBSCRIBE_TIMEOUT_MS = 15000;
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
      const { view, follow } = engineStore.getState();
      const resume = view.game === gameName && view.status === "live" && view.seq > 0;
      follow(gameName);
      conn.send({ op: "engine_sub", game: gameName, after: resume ? view.seq : undefined });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const v = engineStore.getState().view;
        if (v.game === gameName && v.status === "connecting") engineStore.getState().apply({ t: "engine", type: "unavailable", game: gameName });
      }, SUBSCRIBE_TIMEOUT_MS);
    };
    const offFrames = conn.onEngineFrame((frame) => engineStore.getState().apply(frame));
    const offHello = conn.onHelloFrame(subscribe);
    subscribe();
    return () => {
      window.clearTimeout(timer);
      offFrames();
      offHello();
      conn.send({ op: "engine_unsub" });
      engineStore.getState().unfollow();
    };
  }, [conn, gameName, enabled]);
}

/** A renderer's answer: an option id, or a payload naming one (extra fields are for future typed actions). */
export type AnswerPayload = { optionId: string } & Record<string, unknown>;

/**
 * Answers a decision as me. Plain options go to the engine (`op:"answer"`, checked against the decision's seq so a
 * changed prompt is never answered blind). Options the engine can't run yet — select values (`customId#value`) and
 * buttons that open a form (`needsInput`) — take the legacy press path, so their modal still opens.
 */
export function useEngineAnswer() {
  const conn = usePlayConnection();
  return (decision: Decision, choice: string | AnswerPayload) => {
    const optionId = typeof choice === "string" ? choice : choice.optionId;
    const option = decision.options.find((o) => o.id === optionId);
    if (!option || option.disabled) return;
    const { channelId, messageId } = decision.source;
    const hash = option.id.indexOf("#");
    if (hash > 0) return void conn.select(channelId, messageId, option.id.slice(0, hash), [option.id.slice(hash + 1)], 3);
    if (option.needsInput) return void conn.click(channelId, messageId, option.id);
    const store = engineStore.getState();
    if (store.view.pending[decision.id]) return;
    const nonce = conn.send({
      op: "answer",
      game: decision.game,
      decisionId: decision.id,
      optionId,
      expectedSeq: decision.seq,
      requestId: `${decision.id}:${decision.seq}:${optionId}`,
    });
    if (!nonce) return store.answerFailed(decision.id, "", "Not connected to the game server — reconnecting.");
    store.answerStarted(decision.id, nonce, optionId);
    window.setTimeout(() => engineStore.getState().answerFailed(decision.id, nonce, "No response from the game server."), ANSWER_TIMEOUT_MS);
  };
}
