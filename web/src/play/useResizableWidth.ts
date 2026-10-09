import { useState, type PointerEvent } from "react";

const STORAGE_KEY = "ti4online.sidebarWidth";
const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 460;

function clamp(width: number) {
  const max = Math.max(MIN_WIDTH, window.innerWidth * 0.6);
  return Math.round(Math.min(max, Math.max(MIN_WIDTH, width)));
}

function readWidth() {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return stored ? clamp(stored) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** Width of a right-docked panel, dragged from its left edge and remembered. */
export function useResizableWidth() {
  const [width, setWidth] = useState(readWidth);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    let latest = width;

    const move = (e: globalThis.PointerEvent) => {
      latest = clamp(window.innerWidth - e.clientX);
      setWidth(latest);
    };
    const up = () => {
      setDragging(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      try {
        localStorage.setItem(STORAGE_KEY, String(latest));
      } catch {
        /* width just isn't remembered */
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const onDoubleClick = () => setWidth(DEFAULT_WIDTH);

  return { width, dragging, handleProps: { onPointerDown, onDoubleClick } };
}
