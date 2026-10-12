import { create } from "zustand";

export type LogFocusTarget = {
  /** Map position of the system (`201`, `000` for Mecatol Rex). */
  position: string;
  /** The log event that asked for it. */
  eventId: string;
  /** `Date.now()` of the request, so clicking the same event again re-triggers a highlight. */
  at: number;
};

type LogFocus = {
  focus: LogFocusTarget | null;
  focusSystem: (position: string, eventId: string) => void;
  clear: () => void;
};

/**
 * Hand-off from the game log to the map: the log sets `focus` when an event with a system is clicked;
 * the map highlights / pans to `focus.position` and may `clear()` once shown.
 */
export const useLogFocus = create<LogFocus>((set) => ({
  focus: null,
  focusSystem: (position, eventId) => set({ focus: { position, eventId, at: Date.now() } }),
  clear: () => set({ focus: null }),
}));
