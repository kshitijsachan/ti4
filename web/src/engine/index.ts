/**
 * The typed engine stream in the browser (docs/ENGINE.md §7 W-INFRA-2).
 *
 * - `useEngineLink(game)` — mount once per game screen: follows the game's `t:"engine"` frames on the play socket.
 * - `useEngine(selector)` / `engineStore` — state + open decisions from that one stream (seq-ordered, idempotent).
 * - `useMyDecisions()` — decisions waiting on me; `useEngineState(game)` — GameState once the stream is live.
 * - `useEngineMode(game)` — "engine" | "waiting": stream live, or (re)connecting (the page shows a status chip).
 * - `useLegacyRequested()` — `?engine=0` was asked for; the legacy UI is gone, the page says so.
 * - `<EngineDecisionHost/>` — the popup; renderers per kind live in `renderers/<area>/index.ts` (auto-registered).
 */
export type * from "./contract";
export { useEngineLink, useEngineAnswer } from "./link";
export type { AnswerPayload } from "./link";
export { engineStore, useEngine, useEngineMode, useLegacyRequested, useEngineState, useMyDecisions } from "./store";
export { EngineDecisionHost, decisionTitle } from "./EngineDecisionHost";
export { openToAll } from "./reducer";
export { orderDecisions, useMyQueue } from "./queue";
export { engineTurn } from "./board";
export { useEngineDraftPick } from "./draftPick";
export { GenericDecision } from "./GenericDecision";
export { RENDERERS, rendererFor } from "./registry";
export type { EngineRenderer, EngineRendererProps } from "./registry";
