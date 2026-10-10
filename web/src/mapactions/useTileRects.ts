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

/**
 * Screen areas floating controls must stay clear of, relative to `frame`: the docked decision popup (any open
 * non-modal dialog that is not ours) and the step bar.
 */
export function obstaclesIn(frame: HTMLElement | null): Rect[] {
  if (!frame) return [];
  const box = frame.getBoundingClientRect();
  const out: Rect[] = [];
  const els = document.querySelectorAll<HTMLElement>(
    '[role="dialog"][aria-modal="false"], [data-mapactions-bar]',
  );
  els.forEach((el) => {
    if (el.closest("[data-mapactions-float]")) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height)
      out.push({
        x: r.left - box.left,
        y: r.top - box.top,
        w: r.width,
        h: r.height,
      });
  });
  return out;
}

export function overlaps(a: Rect, b: Rect, pad = 6) {
  return (
    a.x < b.x + b.w + pad &&
    a.x + a.w + pad > b.x &&
    a.y < b.y + b.h + pad &&
    a.y + a.h + pad > b.y
  );
}

/**
 * Where to put a `size` box next to `anchor` inside a `bounds` frame: the first of right, left, below, above that
 * fits and clears every obstacle; else the side with the least overlap.
 */
export function placeBeside(
  anchor: Rect,
  size: { w: number; h: number },
  bounds: { w: number; h: number },
  obstacles: Rect[],
) {
  const clampY = (y: number) =>
    Math.min(Math.max(8, y), Math.max(8, bounds.h - size.h - 8));
  const clampX = (x: number) =>
    Math.min(Math.max(8, x), Math.max(8, bounds.w - size.w - 8));
  const midY = anchor.y + anchor.h / 2 - size.h / 2;
  const midX = anchor.x + anchor.w / 2 - size.w / 2;
  const candidates: Rect[] = [
    { x: anchor.x + anchor.w * 0.92, y: clampY(midY), ...size },
    { x: anchor.x + anchor.w * 0.08 - size.w, y: clampY(midY), ...size },
    { x: clampX(midX), y: anchor.y + anchor.h * 0.9, ...size },
    { x: clampX(midX), y: anchor.y + anchor.h * 0.1 - size.h, ...size },
  ];
  const inside = (r: Rect) =>
    r.x >= 4 &&
    r.y >= 4 &&
    r.x + r.w <= bounds.w - 4 &&
    r.y + r.h <= bounds.h - 4;
  const cost = (r: Rect) =>
    obstacles.reduce((sum, o) => {
      const w = Math.max(
        0,
        Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x),
      );
      const h = Math.max(
        0,
        Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y),
      );
      return sum + w * h;
    }, 0) + (inside(r) ? 0 : 1e7);
  const free = candidates.find(
    (r) => inside(r) && !obstacles.some((o) => overlaps(r, o)),
  );
  if (free) return { left: free.x, top: free.y };
  const best = candidates.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  return { left: clampX(best.x), top: clampY(best.y) };
}
