import { create } from "zustand";

type BoardFocus = {
  /** Ring position of the system to bring into view, e.g. "305"; null clears the highlight. */
  position: string | null;
  /** Keep the highlight until cleared (an open decision), rather than flashing it (a log click). */
  persist: boolean;
  /** Bumps on every request so focusing the same system twice still pans. */
  key: number;
  focus: (position: string | null | undefined, persist?: boolean) => void;
};

/** The one place anything on the game screen asks the table to look at a system. */
export const useBoardFocus = create<BoardFocus>((set) => ({
  position: null,
  persist: false,
  key: 0,
  focus: (position, persist = false) =>
    set((s) => ({ position: position ?? null, persist, key: s.key + 1 })),
}));
