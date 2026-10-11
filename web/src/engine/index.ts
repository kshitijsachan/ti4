/**
 * The typed engine stream in the browser (docs/ENGINE.md §7 W-INFRA-2).
 *
 * - `useEngineLink(game)` — mount once per game screen: follows the game's `t:"engine"` frames on the play socket.
 * - `useEngine(selector)` / `engineStore` — state + open decisions from that one stream (seq-ordered, idempotent).
 * - `useMyDecisions()` — decisions waiting on me; `useEngineState(game)` — GameState when the engine drives the UI.
 * - `useEngineMode(game)` — "engine" | "legacy" | "waiting": which UI path to render (flag + stream health).
 * - `<EngineDecisionHost/>` — the popup; renderers per kind live in `renderers/<area>/index.ts` (auto-registered).
 */
export type * from "./contract";
export { useEngineLink, useEngineAnswer } from "./link";
export type { AnswerPayload } from "./link";
export { engineStore, useEngine, useEngineEnabled, useEngineMode, useEngineState, useMyDecisions } from "./store";
export { EngineDecisionHost, decisionTitle } from "./EngineDecisionHost";
export { GenericDecision } from "./GenericDecision";
export { RENDERERS, rendererFor } from "./registry";
export type { EngineRenderer, EngineRendererProps } from "./registry";
