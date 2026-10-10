/**
 * Map actions: answer the bot's system questions by clicking the map.
 *
 * - `<MapActionsLayer gameName containerRef docked />` — mount once inside the board table (BoardTable does).
 * - `activateSystem(position)` — asks the board to activate a system with a tactical action (the player confirms
 *   on the map; the bot's own Tactical Action → ring → system buttons are pressed in order).
 * - `useMovementUI()` — `{ active, step: "move" | "land" | null, promptId }`: while `active`, the map answers the
 *   bot prompt `promptId` (moving ships in / landing ground forces), so the decision popup should not show it.
 * - `useMapActions` — the zustand store behind it (`handBack(promptId)` returns a prompt to the popup).
 */
export { MapActionsLayer } from "./MapActionsLayer";
export { activateSystem, useMovementUI, useMapActions } from "./store";
export { newestFactionPrompt } from "./context";
