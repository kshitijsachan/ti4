/**
 * Map actions: answer the engine's tactical steps by clicking the map.
 *
 * - `<MapActionsLayer gameName containerRef docked />` — mount once inside the board table (BoardTable does).
 * - `activateSystem(position)` — asks the board to activate a system with a tactical action (the player confirms
 *   on the map; the engine's turn.action → tactical.activate steps are answered in order).
 * - `useMovementUI()` — `{ active, step: "move" | "land" | null, promptId }`: while `active`, the map answers the
 *   tactical.move / tactical.land decision `promptId`, so the decision popup should not show it.
 * - `useMapActions` — the zustand store behind it (`handBack(decisionId)` returns a decision to the popup).
 */
export { MapActionsLayer } from "./MapActionsLayer";
export { activateSystem, useMovementUI, useMapActions } from "./store";
