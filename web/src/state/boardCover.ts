import { useEffect } from "react";
import { create } from "zustand";

type BoardCoverState = {
  /** Full-screen overlays open now (the Players view, a player's sheet, an image lightbox). */
  open: number;
  change: (delta: number) => void;
};

/**
 * Overlays that cover the whole table. The decision popup normally floats above drawers and modals' backdrops; while
 * one of these is open it drops beneath it, so it never hides the overlay's header or a player's board.
 */
export const useBoardCover = create<BoardCoverState>((set) => ({
  open: 0,
  change: (delta) => set((s) => ({ open: Math.max(0, s.open + delta) })),
}));

/** Marks a full-screen overlay as open while `opened` is true. */
export function useCoversBoard(opened: boolean) {
  useEffect(() => {
    if (!opened) return;
    useBoardCover.getState().change(1);
    return () => useBoardCover.getState().change(-1);
  }, [opened]);
}
