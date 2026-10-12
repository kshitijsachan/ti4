/**
 * Decisions: the bot's prompts that wait on me, shown one at a time as a popup over the board.
 *
 * - `<DecisionHost gameName />` — mount once inside `PlayProvider` + a react-query provider (keep `<ModalHost/>`
 *   mounted too: bot modals opened from the popup render there).
 * - `useDecisionFocus` — zustand store; `position` is the system the open decision is about (or the system
 *   choice being hovered), for the map to highlight. `null` = nothing.
 * - `useDecisionRequests` / `OPEN_TRADE_EVENT` — "Counter" on a trade offer asks the page to open its trade
 *   drawer (`openTrade` bumps; the window event carries the same `TradeRequest`).
 * - `usePendingPrompts` / `selectPending` / `classify` — the detection and shaping, for other views.
 */
import "./renderers/strategy";
import "./renderers/counters";
import "./renderers/payment";
export { DecisionHost } from "./ui/DecisionHost";
export type { DecisionHostProps } from "./ui/DecisionHost";
export { useDecisionFocus, useDecisionRequests, useWaitingOnMe, OPEN_TRADE_EVENT } from "../engine/focus";
export type { DecisionFocusState, TradeRequest } from "../engine/focus";
export { usePendingPrompts, selectPending } from "../prompts/pending";
export type { PendingPrompt, PendingReason } from "../prompts/pending";
export { classify } from "./model/classify";
export type { Decision, DecisionKind } from "./model/classify";
export { useSetupWaiting, setupWaiting } from "../prompts/waiting";
export type { SetupWaiting } from "../prompts/waiting";
