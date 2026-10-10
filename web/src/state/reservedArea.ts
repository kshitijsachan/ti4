import { useEffect, useState } from "react";
import { create } from "zustand";

/** A box on screen, in viewport pixels. */
export type ScreenRect = { left: number; top: number; right: number; bottom: number };

type ReservedAreaState = {
  rects: Record<string, ScreenRect>;
  set: (name: string, rect: ScreenRect | null) => void;
};

/**
 * Screen areas the table must keep clear: floating surfaces that sit over the board (the decision popup and its
 * "Available now" pill). The board fits itself around them, and map overlays (hover cards, the move bar and
 * picker, the hand tray) avoid them.
 */
export const useReservedArea = create<ReservedAreaState>((set) => ({
  rects: {},
  set: (name, rect) =>
    set((s) => {
      const prev = s.rects[name];
      if (!rect) {
        if (!prev) return s;
        const rest = { ...s.rects };
        delete rest[name];
        return { rects: rest };
      }
      if (prev && sameRect(prev, rect)) return s;
      return { rects: { ...s.rects, [name]: rect } };
    }),
}));

export function sameRect(a: ScreenRect | null, b: ScreenRect | null, tolerance = 0.5) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.right - b.right) <= tolerance &&
    Math.abs(a.bottom - b.bottom) <= tolerance
  );
}

/** The bounding box of every reserved area, or null when nothing is reserved. */
export function reservedUnion(rects: Record<string, ScreenRect>): ScreenRect | null {
  const all = Object.values(rects);
  if (!all.length) return null;
  return {
    left: Math.min(...all.map((r) => r.left)),
    top: Math.min(...all.map((r) => r.top)),
    right: Math.max(...all.map((r) => r.right)),
    bottom: Math.max(...all.map((r) => r.bottom)),
  };
}

/** The reserved areas right now, for code that measures outside React (positioning on hover). */
export function reservedRects(): ScreenRect[] {
  return Object.values(useReservedArea.getState().rects);
}

/** How often a reserved element's position is re-checked (it can move without resizing, e.g. when a drawer opens). */
const POLL_MS = 300;

/**
 * Reserves the screen area of an element for as long as it is mounted and visible: returns a callback ref to put on it.
 */
export function useReserveRect(name: string) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const store = useReservedArea.getState();
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      store.set(name, r.width && r.height ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    const timer = window.setInterval(measure, POLL_MS);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.clearInterval(timer);
      store.set(name, null);
    };
  }, [el, name]);
  return setEl;
}
