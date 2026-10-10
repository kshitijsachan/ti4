import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Portal } from "@mantine/core";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
  type Rect,
} from "@floating-ui/react";
import { useAppStore } from "@/state/appStore";
import { reservedRects } from "@/state/reservedArea";
import {
  getMapLayoutConfig,
  mapCoordsToScreen,
  type MapLayout,
} from "./mapLayout";
import { hoverTarget, type HoverKind } from "./hoverAnchor";
import classes from "./MapTooltipPositioner.module.css";

type Coords = { x: number; y: number };

const EDGE_PADDING = 8;
const GAP = 10;
const LINGER_MS = 250;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 120;
/** Table chrome a hover card must never slide under: the hand tray (and the reserved areas: the decision popup). */
const OBSTACLES = "[data-hover-avoid]";

function findClippingContainer(element: Element | null): Element | null {
  let current = element?.parentElement ?? null;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll|overlay|hidden)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) return current;
    current = current.parentElement;
  }
  return null;
}

function toRect(r: DOMRect | { left: number; top: number; right: number; bottom: number }): Rect {
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/** Cuts the obstacle out of the area along whichever edge keeps the most room. */
function carve(area: DOMRect, obstacle: DOMRect): DOMRect {
  const overlaps =
    obstacle.left < area.right && obstacle.right > area.left && obstacle.top < area.bottom && obstacle.bottom > area.top;
  if (!overlaps || obstacle.width === 0 || obstacle.height === 0) return area;
  const options = [
    new DOMRect(area.left, area.top, obstacle.left - area.left, area.height),
    new DOMRect(obstacle.right, area.top, area.right - obstacle.right, area.height),
    new DOMRect(area.left, area.top, area.width, obstacle.top - area.top),
    new DOMRect(area.left, obstacle.bottom, area.width, area.bottom - obstacle.bottom),
  ];
  return options.reduce((best, r) => (r.width * r.height > best.width * best.height ? r : best));
}

/** The part of the table a hover card may use: the map's own viewport, minus the hand tray and a docked popup. */
function freeArea(anchor: Element | null): Rect {
  const container = findClippingContainer(anchor);
  let area = container
    ? container.getBoundingClientRect()
    : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  for (const obstacle of document.querySelectorAll(OBSTACLES)) {
    area = carve(area, obstacle.getBoundingClientRect());
  }
  for (const r of reservedRects()) {
    area = carve(area, new DOMRect(r.left, r.top, r.right - r.left, r.bottom - r.top));
  }
  return toRect(area);
}

/**
 * Keeps a hover card up for a moment after the pointer leaves what it describes, and for as long as the
 * pointer is on the card, so it can be reached, read and scrolled.
 */
export function useLingeringHover<T>(value: T | null) {
  const [shown, setShown] = useState<T | null>(value);
  const overCard = useRef(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;

  const clearTimer = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  };

  const scheduleClose = () => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (overCard.current || latest.current) return;
      setShown(null);
    }, LINGER_MS);
  };

  useEffect(() => {
    if (value) {
      clearTimer();
      setShown(value);
      return;
    }
    if (!overCard.current) scheduleClose();
  }, [value]);

  useEffect(() => clearTimer, []);

  return {
    shown,
    onCardEnter: () => {
      overCard.current = true;
      clearTimer();
    },
    onCardLeave: () => {
      overCard.current = false;
      if (!latest.current) scheduleClose();
    },
  };
}

type MapTooltipPositionerProps = {
  /** Map coordinates of what is hovered; the card falls back to this point when the hovered element is gone. */
  coords: Coords;
  kind: HoverKind;
  mapPadding?: number;
  mapZoom?: number;
  mapLayout?: MapLayout;
  zIndexVar?: string;
  onCardEnter?: () => void;
  onCardLeave?: () => void;
  children?: ReactNode;
};

/**
 * A map hover card, floated beside the hovered unit or planet: it flips to whichever side has room, shifts to
 * stay on the table clear of the hand tray and a docked decision popup, and scrolls inside when taller than
 * the room it has. It never covers the thing it describes.
 */
export function MapTooltipPositioner({
  coords,
  kind,
  mapPadding,
  mapZoom,
  mapLayout = "panels",
  zIndexVar = "var(--z-map-unit-details)",
  onCardEnter,
  onCardLeave,
  children,
}: MapTooltipPositionerProps) {
  const storeZoom = useAppStore((state) => state.zoomLevel);
  const zoom = mapZoom ?? storeZoom;
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const resolvedPadding = mapPadding ?? getMapLayoutConfig(mapLayout).mapPadding;
  const screen = mapCoordsToScreen(coords, zoom, resolvedPadding);

  const boundary = () => ({ boundary: freeArea(anchorRef.current), padding: EDGE_PADDING });
  const { refs, floatingStyles } = useFloating({
    strategy: "fixed",
    placement: "right",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(GAP),
      flip(() => ({ ...boundary(), crossAxis: false, fallbackPlacements: ["left", "bottom", "top"] })),
      shift(boundary),
      size(() => ({
        ...boundary(),
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.max(MIN_WIDTH, availableWidth)}px`,
            maxHeight: `${Math.max(MIN_HEIGHT, availableHeight)}px`,
          });
        },
      })),
    ],
  });

  useLayoutEffect(() => {
    refs.setReference(hoverTarget(kind) ?? anchorRef.current);
  }, [kind, coords, refs]);

  return (
    <>
      <div ref={anchorRef} className={classes.anchor} style={{ left: `${screen.x}px`, top: `${screen.y}px` }} />
      <Portal>
        <div
          ref={refs.setFloating}
          className={classes.card}
          style={{ ...floatingStyles, zIndex: zIndexVar }}
          onMouseEnter={onCardEnter}
          onMouseLeave={onCardLeave}
        >
          {children}
        </div>
      </Portal>
    </>
  );
}
