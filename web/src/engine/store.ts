import { useMemo } from "react";
import { createStore, useStore } from "zustand";
import { usePlay } from "@/discord";
import type { Decision } from "./contract";
import { engineOverride, setEngineOverride } from "./flag";
import type { EngineFrame, EngineHello } from "./protocol";
import { EMPTY_VIEW, myDecisions, reduce, settleAnswer, startAnswer, subscribeView, type EngineView } from "./reducer";

export type EngineStore = {
  view: EngineView;
  /** This browser's explicit flag (null = follow the server). */
  override: boolean | null;
  /** What the shim said in its hello frame. */
  server: EngineHello | null;
  apply(frame: EngineFrame): void;
  follow(game: string): void;
  unfollow(): void;
  setServer(info: EngineHello | null): void;
  setOverride(on: boolean | null): void;
  answerStarted(decisionId: string, nonce: string, optionId: string): void;
  answerFailed(decisionId: string, nonce: string, error: string): void;
  dismissError(decisionId: string): void;
  /** My last answer from this page, for the outcome note and the queue's "next step first". */
  lastAnswer: LastAnswer | null;
  noteAnswer(answer: LastAnswer): void;
};

/** `seq`: the stream position when I answered (decisions opened after it are the answer's next steps). */
export type LastAnswer = { at: number; seq: number; decision: Decision; optionId: string | null; values?: string[] };

/** One engine view per page (the game on screen), fed by the play socket's `t:"engine"` frames (see link.ts). */
export const engineStore = createStore<EngineStore>((set) => ({
  view: EMPTY_VIEW,
  override: engineOverride(),
  server: null,
  apply: (frame) => set((s) => ({ view: reduce(s.view, frame) })),
  follow: (game) => set((s) => ({ view: subscribeView(s.view, game) })),
  unfollow: () => set({ view: EMPTY_VIEW }),
  setServer: (server) => set({ server }),
  setOverride: (override) => {
    setEngineOverride(override);
    set({ override });
  },
  answerStarted: (id, nonce, optionId) => set((s) => ({ view: startAnswer(s.view, id, nonce, optionId) })),
  answerFailed: (id, nonce, error) => set((s) => ({ view: settleAnswer(s.view, id, nonce, error) })),
  dismissError: (id) => set((s) => ({ view: settleAnswer(s.view, id, undefined, null) })),
  lastAnswer: null,
  noteAnswer: (lastAnswer) => set({ lastAnswer }),
}));

if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __engine?: unknown }).__engine = engineStore;

export function useEngine<T>(selector: (s: EngineStore) => T): T {
  return useStore(engineStore, selector);
}

/** The engine flag: this browser's choice, else the server default. Off when the shim has no engine. */
export function useEngineEnabled(): boolean {
  const override = useEngine((s) => s.override);
  const server = useEngine((s) => s.server);
  if (server && !server.available) return false;
  return override ?? server?.web_default ?? false;
}

/**
 * Whether engine data drives the UI right now: flag on and the stream live for this game. While it connects the
 * legacy path is not shown either (no flash of the old popup); if the engine turns out unavailable, legacy runs.
 */
export function useEngineMode(gameName: string): "engine" | "legacy" | "waiting" {
  const enabled = useEngineEnabled();
  const game = useEngine((s) => s.view.game);
  const status = useEngine((s) => s.view.status);
  if (!enabled) return "legacy";
  if (game !== gameName) return "waiting";
  if (status === "live") return "engine";
  return status === "unavailable" ? "legacy" : "waiting";
}

/** Engine state of the game on screen, or null (flag off, not live yet, or another game). */
export function useEngineState(gameName: string) {
  const mode = useEngineMode(gameName);
  const state = useEngine((s) => s.view.state);
  return mode === "engine" && state?.game === gameName ? state : null;
}

/** Open decisions waiting on me, oldest first. */
export function useMyDecisions(): Decision[] {
  const me = usePlay((s) => s.me?.id);
  const decisions = useEngine((s) => s.view.decisions);
  const state = useEngine((s) => s.view.state);
  return useMemo(() => myDecisions({ ...EMPTY_VIEW, decisions, state }, me), [decisions, state, me]);
}
