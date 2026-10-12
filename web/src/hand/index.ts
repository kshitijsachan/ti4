/**
 * The player's hand as a board-game tray. Render `<HandTray gameName />` inside
 * `<PlayProvider>` (bot buttons, cards thread) and a react-query
 * `QueryClientProvider`; it reads web-data through `usePlayerData(gameName)`,
 * which the page keeps live with `usePlayerDataSocket`. Keep `<ModalHost/>`
 * mounted for any modal a card opens. Dev harness: `dev/vite.config.mjs`.
 */
export { HandTray } from "./HandTray";
export { useHand, handQueryKey } from "./useHand";
export type { HandState } from "./useHand";
export type { HandCard, CardGroup, CardKind } from "./model";
