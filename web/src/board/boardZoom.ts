import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The +/− buttons and keys step along this ladder; the wheel and pinch zoom smoothly between its ends. */
const LADDER = [0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.85, 1, 1.2, 1.4, 1.6, 1.8, 2];
export const MAX_ZOOM = 2;
/** Within this of the fitted zoom counts as back at the fit. */
const FIT_SNAP = 1.02;
/** Per wheel-delta pixel: a mouse notch (~100px) is ~14%, a pinch (ctrl+wheel, small deltas) tracks the fingers. */
const WHEEL_RATE = 0.0015;
const PINCH_RATE = 0.01;

type Anchor = { tile: HTMLElement; relX: number; relY: number; clientX: number; clientY: number };

/**
 * Zoom for the table. `null` means fitted: the board follows the window size. Any manual zoom keeps the map
 * point under the cursor (or the centre, for buttons and keys) where it was; zooming back down to the fit
 * returns to the fitted view.
 */
export function useBoardZoom(containerRef: RefObject<HTMLDivElement | null>, fitZoom: number, resetKey: string) {
  const [manual, setManual] = useState<number | null>(null);
  const zoom = manual ?? fitZoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const fitRef = useRef(fitZoom);
  fitRef.current = fitZoom;
  const anchor = useRef<Anchor | null>(null);

  useEffect(() => setManual(null), [resetKey]);

  /** Zooms to `next`, holding the map point at (clientX, clientY) still; defaults to the table's centre. */
  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const el = containerRef.current;
      const fit = fitRef.current;
      const target = Math.min(MAX_ZOOM, next);
      if (!el || !fit || target <= fit * FIT_SNAP) {
        anchor.current = null;
        setManual(null);
        return;
      }
      const tile = el.querySelector<HTMLElement>('[id^="tile-"]');
      if (tile) {
        const box = el.getBoundingClientRect();
        const x = clientX ?? box.left + box.width / 2;
        const y = clientY ?? box.top + box.height / 2;
        const rect = tile.getBoundingClientRect();
        const current = zoomRef.current;
        anchor.current = { tile, relX: (x - rect.left) / current, relY: (y - rect.top) / current, clientX: x, clientY: y };
      }
      setManual(target);
    },
    [containerRef],
  );

  // After the new zoom is laid out, scroll so the anchored map point is back under the cursor.
  useLayoutEffect(() => {
    const el = containerRef.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a || manual === null || !a.tile.isConnected) return;
    const rect = a.tile.getBoundingClientRect();
    el.scrollLeft += rect.left + a.relX * manual - a.clientX;
    el.scrollTop += rect.top + a.relY * manual - a.clientY;
  }, [containerRef, manual]);

  const zoomIn = useCallback(() => {
    const current = zoomRef.current;
    zoomTo(LADDER.find((step) => step > current * 1.01) ?? MAX_ZOOM);
  }, [zoomTo]);

  const zoomOut = useCallback(() => {
    const current = zoomRef.current;
    zoomTo([...LADDER].reverse().find((step) => step < current * 0.99) ?? 0);
  }, [zoomTo]);

  const fit = useCallback(() => zoomTo(0), [zoomTo]);

  useWheelZoom(containerRef, zoomRef, zoomTo);

  return { zoom, fitted: manual === null, zoomIn, zoomOut, fit };
}

/**
 * Wheel and trackpad pinch (a ctrl+wheel on macOS) zoom around the cursor, batched to one zoom per frame.
 * Bound to the table's scroller only, so popups, drawers and the hand tray keep their own scrolling; a
 * mostly sideways wheel is a two-finger pan and is left to scroll the map.
 */
function useWheelZoom(
  containerRef: RefObject<HTMLDivElement | null>,
  zoomRef: RefObject<number>,
  zoomTo: (next: number, clientX?: number, clientY?: number) => void,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let factor = 1;
    let at = { x: 0, y: 0 };
    let frame = 0;

    const apply = () => {
      frame = 0;
      zoomTo(zoomRef.current * factor, at.x, at.y);
      factor = 1;
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
      factor *= Math.exp(-pixels * (event.ctrlKey ? PINCH_RATE : WHEEL_RATE));
      at = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(apply);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, [containerRef, zoomRef, zoomTo]);
}
