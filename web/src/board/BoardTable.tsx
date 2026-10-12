import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Tooltip, UnstyledButton } from "@mantine/core";
import { IconMinus, IconPlus, IconArrowsMinimize } from "@tabler/icons-react";
import { InteractiveMapRenderer } from "@/domains/map/components/renderer/InteractiveMapRenderer";
import { useDragScroll } from "@/hooks/useDragScroll";
import { useTabsAndTooltips } from "@/hooks/useTabsAndTooltips";
import { useGameData } from "@/state/useGameContext";
import { useSettingsStore } from "@/state/appStore";
import { useMapContentSize } from "@/domains/map/components/hooks/useMapContentSize";
import { useTilesList } from "@/hooks/useTilesList";
import { shouldHideZoomControls, computeMapZoom } from "@/utils/zoom";
import { useMapTooltips } from "@/domains/map/components/hooks/useMapTooltips";
import { getMapLayoutConfig } from "@/domains/map/components/mapLayout";
import { useBoardShortcuts } from "@/domains/map/components/hooks/useBoardShortcuts";
import { MapLensChip } from "@/domains/map/components/MapLensChip";
import { useScrollToReplayHighlight } from "@/hooks/useScrollToReplayHighlight";
import {
  calculateStatTilePositions,
  HEX_PATH,
  TILE_HEIGHT,
  TILE_WIDTH,
} from "@/entities/geometry/tilePositioning";
import {
  HOME_LABEL_HEIGHT,
  HOME_LABEL_WIDTH,
  homeLabelAnchors,
} from "@/domains/map/components/HomeSystemLabels";
import { MapActionsLayer, useMapActions } from "@/mapactions";
import { useBoardFocus } from "./focus";
import { MAX_ZOOM, useBoardZoom } from "./boardZoom";
import { useAreaSize } from "./useBoardReserve";
import type { ScreenRect } from "@/state/reservedArea";
import classes from "./BoardTable.module.css";

const CLEARANCE = 20;
/** Before the board's extent is known (no tiles yet). */
const DEFAULT_ZOOM = 0.4;
const FOCUS_MS = 4000;
const FOCUS_CLASS = "board-focus-tile";

type ContentSize = ReturnType<typeof useMapContentSize>;

/** Scaled extents of the board, centred in the scroller when it fits. */
function boardGeometry(contentSize: ContentSize, unscaledWidth: number, zoom: number) {
  const { bleed } = contentSize;
  const width = unscaledWidth * zoom;
  const bleedLeft = bleed.left * zoom;
  const bleedRight = bleed.right * zoom;
  return {
    unscaledWidth,
    unscaledHeight: contentSize.height,
    width,
    height: contentSize.height * zoom,
    paintedWidth: unscaledWidth + bleed.left + bleed.right,
    paintedHeight: contentSize.height + bleed.top + bleed.bottom,
    margins: {
      marginTop: bleed.top * zoom + CLEARANCE,
      marginBottom: bleed.bottom * zoom + CLEARANCE,
      marginLeft: `max(${bleedLeft + CLEARANCE}px, calc((100% - ${width}px + ${bleedLeft}px - ${bleedRight}px) / 2))`,
      marginRight: "auto",
    },
  };
}

/** Share of the table kept around a zoomed board, so any point of it can be brought under the cursor. */
const ZOOM_ROOM = 0.6;

/** Margins for a zoomed-in board: room on every side to zoom about any point and pan past the edges. */
function roomyMargins(
  contentSize: ContentSize,
  zoom: number,
  area: { w: number; h: number },
  reserve: ScreenRect | null,
) {
  const { bleed } = contentSize;
  const padX = Math.max(CLEARANCE, area.w * ZOOM_ROOM);
  const padY = Math.max(CLEARANCE, area.h * ZOOM_ROOM);
  // Enough to scroll the board's far edges out from under a popup.
  const right = reserve && reserve.left > area.w / 2 ? area.w - reserve.left + CLEARANCE : 0;
  const bottom = reserve && reserve.left <= area.w / 2 && reserve.top > area.h / 2 ? area.h - reserve.top + CLEARANCE : 0;
  return {
    marginLeft: bleed.left * zoom + padX,
    marginRight: bleed.right * zoom + Math.max(padX, right),
    marginTop: bleed.top * zoom + padY,
    marginBottom: bleed.bottom * zoom + Math.max(padY, bottom, HAND_RESERVE + CLEARANCE),
  };
}

const VIEWPORT_MARGIN = 60;
const SVG_NS = "http://www.w3.org/2000/svg";

/** A lit hex outline laid over a tile (the map's tiles are upstream components, so it is added to the DOM). */
function focusRing() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${TILE_WIDTH} ${TILE_HEIGHT}`);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add(classes.focusRing);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", HEX_PATH);
  svg.appendChild(path);
  return svg;
}

/** Brings a system on screen (only if it isn't already) and lights it; returns the undo. */
function revealTile(container: HTMLElement, position: string, persist: boolean) {
  const tile = document.getElementById(`tile-${position}`);
  const visual = tile?.querySelector<HTMLElement>('[data-map-tile-visual="true"]');
  if (!tile || !visual || !container.contains(tile)) return () => {};

  const viewport = container.getBoundingClientRect();
  const target = visual.getBoundingClientRect();
  const visible =
    target.left >= viewport.left + VIEWPORT_MARGIN &&
    target.right <= viewport.right - VIEWPORT_MARGIN &&
    target.top >= viewport.top + VIEWPORT_MARGIN &&
    target.bottom <= viewport.bottom - VIEWPORT_MARGIN;
  if (!visible) {
    container.scrollTo({
      left: container.scrollLeft + target.left + target.width / 2 - (viewport.left + viewport.width / 2),
      top: container.scrollTop + target.top + target.height / 2 - (viewport.top + viewport.height / 2),
      behavior: "smooth",
    });
  }
  const ring = focusRing();
  visual.parentElement?.appendChild(ring);
  tile.classList.add(FOCUS_CLASS);
  const clear = () => {
    tile.classList.remove(FOCUS_CLASS);
    ring.remove();
  };
  const timer = persist ? undefined : window.setTimeout(clear, FOCUS_MS);
  return () => {
    window.clearTimeout(timer);
    clear();
  };
}

function useFocusReveal(containerRef: RefObject<HTMLDivElement | null>) {
  const position = useBoardFocus((s) => s.position);
  const persist = useBoardFocus((s) => s.persist);
  const key = useBoardFocus((s) => s.key);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !position) return;
    let cleanup = () => {};
    const frame = window.requestAnimationFrame(() => {
      cleanup = revealTile(container, position, persist);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      cleanup();
    };
  }, [containerRef, position, persist, key]);
}

/** Kept between the board and a floating popup. */
const RESERVE_GAP = 8;
/** Kept clear at the bottom for the hand bar. */
const HAND_RESERVE = 48;
const FIT_PAD = 20;
const FIT_MAX = 1;

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Map units kept around the painted extent, for unit stacks and tokens that lean past a tile's rim. */
const BOUNDS_SLACK = 24;
/** Where upstream draws the expeditions wheel (when it's on the map at all), relative to the content bottom. */
const EXPEDITIONS = { left: 100, fromBottom: 400, size: 300 };

/**
 * The painted extent of the board, unscaled: every tile (off-board ones too), the home-system name labels, or,
 * with the map's own player stats switched back on, the stat hexes and the expeditions wheel.
 */
function usePaintedBounds(contentHeight: number): Bounds | null {
  const gameData = useGameData();
  const tiles = useTilesList(gameData?.tiles);
  const showStats = useSettingsStore((s) => s.settings.showMapPlayerStats);
  return useMemo(() => {
    if (!tiles.length) return null;
    const boxes = tiles.map((t) => ({ x: t.properties.x, y: t.properties.y, w: TILE_WIDTH, h: TILE_HEIGHT }));
    if (showStats) {
      const stats = calculateStatTilePositions(
        Object.values(gameData?.statTilePositions ?? {}).flat(),
        gameData?.ringCount,
        gameData?.tilePositions,
      );
      boxes.push(...stats.map((p) => ({ x: p.x, y: p.y, w: TILE_WIDTH, h: TILE_HEIGHT })));
      const expeditions = Object.values(gameData?.expeditions ?? {});
      if (expeditions.some((e) => e.completedBy == null)) {
        const top = contentHeight - EXPEDITIONS.fromBottom;
        boxes.push({ x: EXPEDITIONS.left, y: top, w: EXPEDITIONS.size, h: EXPEDITIONS.size });
      }
    } else {
      const anchors = homeLabelAnchors(gameData?.statTilePositions, tiles, gameData?.ringCount, gameData?.tilePositions);
      boxes.push(
        ...anchors.map((a) => ({
          x: a.x - HOME_LABEL_WIDTH / 2,
          y: a.y - HOME_LABEL_HEIGHT / 2,
          w: HOME_LABEL_WIDTH,
          h: HOME_LABEL_HEIGHT,
        })),
      );
    }
    return {
      minX: Math.min(...boxes.map((b) => b.x)) - BOUNDS_SLACK,
      minY: Math.min(...boxes.map((b) => b.y)) - BOUNDS_SLACK,
      maxX: Math.max(...boxes.map((b) => b.x + b.w)) + BOUNDS_SLACK,
      maxY: Math.max(...boxes.map((b) => b.y + b.h)) + BOUNDS_SLACK,
    };
  }, [
    tiles,
    showStats,
    contentHeight,
    gameData?.statTilePositions,
    gameData?.ringCount,
    gameData?.tilePositions,
    gameData?.expeditions,
  ]);
}

type Box = { x: number; y: number; w: number; h: number };
type Side = "full" | "left" | "right" | "above" | "below";

/** The zoom that shows the whole board inside `box`, and where that puts it. */
function fitInto(bounds: Bounds, box: Box) {
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const zoom = Math.min(FIT_MAX, Math.max(0.05, Math.min((box.w - FIT_PAD * 2) / bw, (box.h - FIT_PAD * 2) / bh)));
  const marginLeft = box.x + box.w / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom;
  const marginTop = box.y + box.h / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom;
  const painted = {
    left: marginLeft + bounds.minX * zoom,
    top: marginTop + bounds.minY * zoom,
    right: marginLeft + bounds.maxX * zoom,
    bottom: marginTop + bounds.maxY * zoom,
  };
  return { zoom, marginLeft, marginTop, painted };
}

function hits(a: ScreenRect, b: ScreenRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * The zoom that shows the whole board in the free part of the table, and where to put it: clear of the hand bar
 * and of `reserve` (a popup floating over the table), beside or above or below it, whichever shows the board largest.
 */
function fitLayout(bounds: Bounds | null, area: { w: number; h: number }, reserve: ScreenRect | null) {
  if (!bounds || !area.w || !area.h) return null;
  const free: Box = { x: 0, y: 0, w: area.w, h: area.h - HAND_RESERVE };
  const candidates: { side: Side; box: Box }[] = [{ side: "full", box: free }];
  if (reserve) {
    const r = reserve;
    candidates.push(
      { side: "left", box: { ...free, w: r.left - RESERVE_GAP } },
      { side: "right", box: { ...free, x: r.right + RESERVE_GAP, w: free.w - r.right - RESERVE_GAP } },
      { side: "above", box: { ...free, h: Math.min(free.h, r.top - RESERVE_GAP) } },
      { side: "below", box: { ...free, y: r.bottom + RESERVE_GAP, h: free.h - r.bottom - RESERVE_GAP } },
    );
  }
  const fits = candidates
    .filter((c) => c.box.w > FIT_PAD * 4 && c.box.h > FIT_PAD * 4)
    .map((c) => ({ side: c.side, ...fitInto(bounds, c.box) }))
    // The whole table only while the board, fitted to it, stays clear of the popup.
    .filter((f) => f.side !== "full" || !reserve || !hits(f.painted, reserve));
  if (!fits.length) return null;
  const best = fits.reduce((a, b) => (b.zoom > a.zoom * 1.001 ? b : a));
  return {
    side: best.side,
    zoom: best.zoom,
    marginLeft: best.marginLeft,
    marginTop: best.marginTop,
    width: bounds.maxX * best.zoom,
    height: bounds.maxY * best.zoom,
  };
}

/** A fitted board moving to a new fit (a popup came or went) glides there instead of jumping. */
function useFitGlide(
  containerRef: RefObject<HTMLDivElement | null>,
  fit: { zoom: number; marginLeft: number; marginTop: number } | null,
  area: { w: number; h: number },
) {
  const prev = useRef<{ zoom: number; marginLeft: number; marginTop: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const last = prev.current;
    prev.current = fit ? { zoom: fit.zoom, marginLeft: fit.marginLeft, marginTop: fit.marginTop, w: area.w, h: area.h } : null;
    if (!fit || !last) return;
    // Window resizes follow the window directly.
    if (last.w !== area.w || last.h !== area.h) return;
    const dx = last.marginLeft - fit.marginLeft;
    const dy = last.marginTop - fit.marginTop;
    const scale = last.zoom / fit.zoom;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.001) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const board = containerRef.current?.firstElementChild;
    if (!(board instanceof HTMLElement) || typeof board.animate !== "function") return;
    board.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        { transformOrigin: "0 0", transform: "none" },
      ],
      { duration: 320, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
  }, [containerRef, fit?.zoom, fit?.marginLeft, fit?.marginTop, area.w, area.h]);
}

function ZoomButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label} position="left" openDelay={300}>
      <UnstyledButton className={classes.zoomButton} onClick={onClick} disabled={disabled} aria-label={label}>
        {children}
      </UnstyledButton>
    </Tooltip>
  );
}

type Props = {
  gameName: string;
  /** The part of the table a floating popup covers, in the table's pixels: the board keeps clear of it. */
  reserve?: ScreenRect | null;
};

/**
 * The table: the live map. At rest the whole board is fitted into the free part of the table (clear of the
 * hand bar and of a decision popup) and follows the window size and the popup coming and going; zooming in
 * makes it pannable (with room to scroll every system out from under the popup), and zooming back out (or the
 * fit button) returns to the fitted view.
 */
export function BoardTable({ gameName, reserve = null }: Props) {
  const gameData = useGameData();
  const tilesList = useTilesList(gameData?.tiles);
  useDragScroll();

  const { tooltipUnit, handleMouseEnter, handleMouseLeave, handleMouseDown } = useTabsAndTooltips();
  const { tooltipPlanet, handlePlanetMouseEnter, handlePlanetMouseLeave, handleUnitMouseEnter, handleUnitMouseLeave } =
    useMapTooltips(handleMouseEnter, handleMouseLeave);

  const mapInteracting = useMapActions((s) => s.interacting);
  const isFirefox = useSettingsStore((s) => s.settings.isFirefox);

  const mapLayout = getMapLayoutConfig("pannable");
  const contentSize = useMapContentSize("pannable");
  const containerRef = useRef<HTMLDivElement>(null);
  const area = useAreaSize(containerRef);
  const bounds = usePaintedBounds(contentSize.height);
  const fit = fitLayout(bounds, area, reserve);

  const fitZoom = fit?.zoom ?? 0;
  const { zoom: boardZoom, fitted, zoomIn, zoomOut, fit: fitBoard } = useBoardZoom(containerRef, fitZoom, gameName);
  const useFit = fitted && !!fit;
  const zoom = fit ? boardZoom : computeMapZoom(DEFAULT_ZOOM, contentSize.width + 150);
  const board = boardGeometry(contentSize, contentSize.width + mapLayout.mapWidthExtra, zoom);
  const placement = useFit
    ? {
        width: fit.width,
        height: fit.height,
        margins: { marginLeft: fit.marginLeft, marginTop: fit.marginTop },
      }
    : fit
      ? { width: board.width, height: board.height, margins: roomyMargins(contentSize, zoom, area, reserve) }
      : { width: board.width, height: board.height, margins: board.margins };

  useFitGlide(containerRef, useFit ? fit : null, area);
  // Back at the fit: drop any scroll left over from panning, which would push the fitted board off its place.
  useLayoutEffect(() => {
    if (useFit) containerRef.current?.scrollTo(0, 0);
  }, [useFit]);
  useBoardShortcuts({ zoomIn, zoomOut, fit: fitBoard });
  // The popup docked down the right of the table: controls on that edge move left of it.
  const reserveRight = reserve && reserve.left > area.w / 2 ? area.w - reserve.left : 0;
  const tableStyle = { "--board-reserve-right": `${reserveRight}px` } as CSSProperties;
  useScrollToReplayHighlight(containerRef);
  useFocusReveal(containerRef);

  return (
    <div className={classes.table} style={tableStyle}>
      <div ref={containerRef} className={`dragscroll ${classes.scroller} ${useFit ? classes.fitted : ""}`}>
        {gameData && (
          <InteractiveMapRenderer
            mapLayoutConfig={mapLayout}
            zoom={zoom}
            isFirefox={isFirefox}
            contentSize={contentSize}
            layoutWidthOverride={placement.width}
            layoutHeightOverride={placement.height}
            widthOverride={board.unscaledWidth}
            heightOverride={board.unscaledHeight}
            styleOverrides={placement.margins}
            gameData={gameData}
            tilesList={tilesList}
            onUnitMouseOver={handleUnitMouseEnter}
            onUnitMouseLeave={handleUnitMouseLeave}
            onUnitSelect={handleMouseDown}
            onPlanetMouseEnter={handlePlanetMouseEnter}
            onPlanetMouseLeave={handlePlanetMouseLeave}
            tooltipUnit={mapInteracting ? null : tooltipUnit}
            tooltipPlanet={mapInteracting ? null : tooltipPlanet}
          />
        )}
      </div>
      <MapActionsLayer gameName={gameName} containerRef={containerRef} docked={reserveRight > 0} />
      <MapLensChip />
      {!shouldHideZoomControls() && (
        <div className={classes.zoom}>
          <ZoomButton label="Zoom in (+)" onClick={zoomIn} disabled={!useFit && zoom >= MAX_ZOOM}>
            <IconPlus size={14} stroke={1.8} />
          </ZoomButton>
          <ZoomButton label="Zoom out (−)" onClick={zoomOut} disabled={useFit}>
            <IconMinus size={14} stroke={1.8} />
          </ZoomButton>
          <ZoomButton label="Fit the board (0)" onClick={fitBoard} disabled={useFit}>
            <IconArrowsMinimize size={14} stroke={1.8} />
          </ZoomButton>
        </div>
      )}
    </div>
  );
}
