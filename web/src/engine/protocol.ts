import type { AnswerResult, Decision, EngineEvent, GameState } from "./contract";

/** Server → browser `t:"engine"` frames (shim/src/engine/fanout.ts). */
export type EngineFrame =
  | { t: "engine"; type: "snapshot"; game: string; seq: number; state: GameState; decisions: Decision[] }
  | { t: "engine"; type: "events"; game: string; events: EngineEvent[] }
  | { t: "engine"; type: "event"; game: string; event: EngineEvent }
  | { t: "engine"; type: "state"; game: string; state: GameState }
  | {
      t: "engine";
      type: "answer";
      nonce?: string;
      decisionId?: string;
      result: Pick<AnswerResult, "ok" | "status"> & Partial<AnswerResult>;
    }
  | { t: "engine"; type: "unavailable"; game: string };

/** Browser → server engine ops. */
export type EngineOp =
  | { op: "engine_sub"; game: string; after?: number }
  | { op: "engine_unsub" }
  | {
      op: "answer";
      game: string;
      decisionId: string;
      /** Press this option (alone, or naming the option a payload belongs to). */
      optionId?: string;
      /** Structured answer (agenda ballot, token pools) → AnswerRequest.payload. */
      payload?: unknown;
      /** A kind's direct action route ("move", "land", "combat-plan", …) with its body. */
      action?: string;
      body?: Record<string, unknown>;
      expectedSeq?: number;
      requestId?: string;
    };

/** What the hello frame says about the engine. */
export type EngineHello = { available: boolean; web_default: boolean };
