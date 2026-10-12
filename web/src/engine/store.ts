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
  /** The server default remembered from an earlier hello (until this page gets its own). */
  rememberedDefault: boolean | null;
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
  /** Untyped prompts I put away ("not for me"), by decision id; remembered in this browser. */
  hidden: ReadonlySet<string>;
  hide(decisionId: string): void;
  unhideAll(): void;
};

const HIDDEN_KEY = "ti4online.engine.hidden";
/** The server's engine default from its last hello, so a reload before the socket says hello picks the same UI. */
const SERVER_DEFAULT_KEY = "ti4online.engine.serverDefault";

function readServerDefault(): boolean | null {
  try {
    const raw = window.localStorage.getItem(SERVER_DEFAULT_KEY);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}

function writeServerDefault(info: EngineHello) {
  try {
    window.localStorage.setItem(SERVER_DEFAULT_KEY, info.available && info.web_default ? "1" : "0");
  } catch {
    /* storage unavailable: the next reload waits for the hello again */
  }
}

function readHidden(): Set<string> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeHidden(ids: Set<string>) {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids].slice(-300)));
  } catch {
    /* storage unavailable: hidden for this page only */
  }
}

/** `seq`: the stream position when I answered (decisions opened after it are the answer's next steps). */
export type LastAnswer = { at: number; seq: number; decision: Decision; optionId: string | null; values?: string[] };

/** One engine view per page (the game on screen), fed by the play socket's `t:"engine"` frames (see link.ts). */
export const engineStore = createStore<EngineStore>((set) => ({
  view: EMPTY_VIEW,
  override: engineOverride(),
  server: null,
  rememberedDefault: readServerDefault(),
  apply: (frame) => set((s) => ({ view: reduce(s.view, frame) })),
  follow: (game) => set((s) => ({ view: subscribeView(s.view, game) })),
  unfollow: () => set({ view: EMPTY_VIEW }),
  setServer: (server) => {
    if (server) writeServerDefault(server);
    set({ server });
  },
  setOverride: (override) => {
    setEngineOverride(override);
    set({ override });
  },
  answerStarted: (id, nonce, optionId) => set((s) => ({ view: startAnswer(s.view, id, nonce, optionId) })),
  answerFailed: (id, nonce, error) => set((s) => ({ view: settleAnswer(s.view, id, nonce, error) })),
  dismissError: (id) => set((s) => ({ view: settleAnswer(s.view, id, undefined, null) })),
  lastAnswer: null,
  noteAnswer: (lastAnswer) => set({ lastAnswer }),
  hidden: readHidden(),
  hide: (id) =>
    set((s) => {
      const hidden = new Set(s.hidden).add(id);
      writeHidden(hidden);
      return { hidden };
    }),
  unhideAll: () => {
    writeHidden(new Set());
    set({ hidden: new Set() });
  },
}));

if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __engine?: unknown }).__engine = engineStore;

export function useEngine<T>(selector: (s: EngineStore) => T): T {
  return useStore(engineStore, selector);
}

/** The engine flag: this browser's choice, else the server default. Off when the shim has no engine. */
export function useEngineEnabled(): boolean {
  return useEngineChoice() === true;
}

/** The engine flag, or null while it is not known yet (no hello on this page and none remembered). */
function useEngineChoice(): boolean | null {
  const override = useEngine((s) => s.override);
  const server = useEngine((s) => s.server);
  const remembered = useEngine((s) => s.rememberedDefault);
  if (server && !server.available) return false;
  if (override !== null) return override;
  if (server) return server.web_default;
  return remembered;
}

/**
 * Whether engine data drives the UI right now: flag on and the stream live for this game. While it connects the
 * legacy path is not shown either (no flash of the old popup). While the server has an engine that does not answer
 * for this game yet (bot restarting: it re-reads every game first), this keeps waiting too: the legacy popup's
 * options lead nowhere then (playtest 5: a "Tactical action (3)" panel, then "the engine has not offered your
 * options yet"). Legacy runs only on a server without the engine, or when this browser chose it.
 */
export function useEngineMode(gameName: string): "engine" | "legacy" | "waiting" {
  const choice = useEngineChoice();
  const game = useEngine((s) => s.view.game);
  const status = useEngine((s) => s.view.status);
  const server = useEngine((s) => s.server);
  /* Not known until the socket's hello (first visit, server offline): neither popup, so the legacy one never flashes. */
  if (choice === null) return "waiting";
  if (!choice) return "legacy";
  if (game !== gameName) return "waiting";
  if (status === "live") return "engine";
  return status === "unavailable" && server && !server.available ? "legacy" : "waiting";
}

/** The engine stream for this game is down while the server has an engine (it is restarting / catching up). */
export function useEngineRestarting(gameName: string): boolean {
  const game = useEngine((s) => s.view.game);
  const status = useEngine((s) => s.view.status);
  return game === gameName && status === "unavailable";
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
