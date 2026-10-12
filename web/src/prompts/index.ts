/**
 * Reading the bot's Discord-shaped prompts (custom ids, labels, message text) for the views that still need it now
 * that the decision popup runs on the engine's typed decisions: the map's tactical actions (`mapactions`), the
 * setup screen's "waiting on" line, rewind phrasing and ended-combat reports. Goes when those read engine data.
 */
export { baseId, choicesOf, idFaction, type Choice } from "./controls";
export { findGame, type GameChannels } from "./games";
export { usePendingPrompts, selectPending, type PendingPrompt, type PendingReason } from "./pending";
export { useSetupWaiting, setupWaiting, type SetupWaiting } from "./waiting";
export { riftRolled } from "./rift";
