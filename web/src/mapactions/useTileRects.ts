import { useEffect, useState, type RefObject } from "react";

export type Rect = { x: number; y: number; w: number; h: number };

export function tileVisual(position: string) {
  return (
    document
      .getElementById(`tile-${position}`)
      ?.querySelector<HTMLElement>('[data-map-tile-visual="true"]') ?? null
  );
}

/** The tile (ring position) under a DOM node of the map, if any. */
export function tileAt(target: EventTarget | null): string | null {
  const el =
    target instanceof Element
      ? target.closest<HTMLElement>('[id^="tile-"]')
      : null;
  return el ? el.id.slice("tile-".length) : null;
}

function same(a: Record<string, Rect>, b: Record<string, Rect>) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => {
    const p = a[k];
    const q = b[k];
    return (
      !!q &&
      Math.abs(p.x - q.x) < 0.5 &&
      Math.abs(p.y - q.y) < 0.5 &&
      Math.abs(p.w - q.w) < 0.5
    );
  });
}

/**
 * Where some tiles are on screen, relative to `frame` (the table), kept current through pans, zooms and resizes
 * with a frame loop that only runs while there is something to place.
 */
export function useTileRects(
  frame: RefObject<HTMLElement | null>,
  positions: string[],
) {
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const key = positions.join(",");
  useEffect(() => {
    if (!key) {
      setRects((r) => (Object.keys(r).length ? {} : r));
      return;
    }
    const list = key.split(",");
    let raf = 0;
    const tick = () => {
      const box = frame.current?.getBoundingClientRect();
      if (box) {
        const next: Record<string, Rect> = {};
        for (const p of list) {
          const r = tileVisual(p)?.getBoundingClientRect();
          if (r && r.width > 0)
            next[p] = {
              x: r.left - box.left,
              y: r.top - box.top,
              w: r.width,
              h: r.height,
            };
        }
        setRects((prev) => (same(prev, next) ? prev : next));
      }
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
  }, [frame, key]);
  return rects;
}
