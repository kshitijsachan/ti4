import { create } from "zustand";

export type LogRevealTarget = {
  eventId: string;
  /** `Date.now()` of the request, so asking for the same event again re-triggers it. */
  at: number;
};

type LogReveal = {
  target: LogRevealTarget | null;
  reveal: (eventId: string) => void;
  clear: () => void;
};

/**
 * Hand-off from the ticker to the full log: the ticker asks for an event, the full log (open now or opening)
 * scrolls to it, expands it (or the strategy card play it belongs to), briefly highlights it and clears the ask.
 */
export const useLogReveal = create<LogReveal>((set) => ({
  target: null,
  reveal: (eventId) => set({ target: { eventId, at: Date.now() } }),
  clear: () => set({ target: null }),
}));
