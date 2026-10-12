import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { sameRect, useReservedArea, type ScreenRect } from "@/state/reservedArea";

/** Reserved areas are snapped to this grid, so a card growing by a line does not re-fit the board. */
const SNAP = 16;
/** A popup appearing is made room for quickly (once it has settled into place)... */
const APPEAR_MS = 120;
/** ...and its room is given back only after a pause, since the next decision often follows right away. */
const LEAVE_MS = 700;

function snap(r: ScreenRect | null): ScreenRect | null {
  if (!r) return null;
  return {
    left: Math.floor(r.left / SNAP) * SNAP,
    top: Math.floor(r.top / SNAP) * SNAP,
    right: Math.ceil(r.right / SNAP) * SNAP,
    bottom: Math.ceil(r.bottom / SNAP) * SNAP,
  };
}

/** The board fits around the decision card; smaller reserved bits (its pill) are only avoided by overlays. */
const FIT_AROUND = "decision-card";

let pointerHeld = false;
let listeners = 0;
const onDown = () => (pointerHeld = true);
const onUp = () => (pointerHeld = false);

/** Tracks whether a pointer is held anywhere, so the board never moves under a drag or a press. */
function usePointerTracking() {
  useEffect(() => {
    if (listeners++ === 0) {
      window.addEventListener("pointerdown", onDown, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
    }
    return () => {
      if (--listeners > 0) return;
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, []);
}

/** The reserved screen area once it has stopped changing: debounced, and held while a pointer is down. */
function useSettledRect(live: ScreenRect | null) {
  const [settled, setSettled] = useState<ScreenRect | null>(live);
  usePointerTracking();
  const key = live ? `${live.left},${live.top},${live.right},${live.bottom}` : "";
  useEffect(() => {
    if (sameRect(live, settled)) return;
    let timer = 0;
    const apply = () => {
      if (pointerHeld) {
        timer = window.setTimeout(apply, APPEAR_MS);
        return;
      }
      setSettled(live);
    };
    timer = window.setTimeout(apply, live ? APPEAR_MS : LEAVE_MS);
    return () => window.clearTimeout(timer);
    // `key` stands for `live`, which is a new object on every store change.
  }, [key, settled]);
  return settled;
}

/**
 * The part of `frame` covered by floating surfaces (the decision popup), in the frame's own pixels, or null when
 * nothing covers it. Settled: it changes only once the popup has stopped moving and no pointer is held.
 */
export function useBoardReserve(frameRef: RefObject<HTMLElement | null>, size: { w: number; h: number }) {
  const card = useReservedArea((s) => s.rects[FIT_AROUND]);
  const live = useMemo(() => snap(card ?? null), [card]);
  const settled = useSettledRect(live);
  return useMemo(() => {
    const frame = frameRef.current;
    if (!settled || !frame || !size.w || !size.h) return null;
    const box = frame.getBoundingClientRect();
    const r = {
      left: Math.max(0, settled.left - box.left),
      top: Math.max(0, settled.top - box.top),
      right: Math.min(size.w, settled.right - box.left),
      bottom: Math.min(size.h, settled.bottom - box.top),
    };
    return r.right > r.left && r.bottom > r.top ? r : null;
  }, [settled, frameRef, size.w, size.h]);
}

/** The element's client size, kept current. */
export function useAreaSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
