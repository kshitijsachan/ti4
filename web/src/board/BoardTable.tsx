import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { MapActionsLayer } from "@/mapactions";
import { useBoardFocus } from "./focus";
import { MAX_ZOOM, useBoardZoom } from "./boardZoom";
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
function roomyMargins(contentSize: ContentSize, zoom: number, area: { w: number; h: number }) {
  const { bleed } = contentSize;
  const padX = Math.max(CLEARANCE, area.w * ZOOM_ROOM);
  const padY = Math.max(CLEARANCE, area.h * ZOOM_ROOM);
  return {
    marginLeft: bleed.left * zoom + padX,
    marginRight: bleed.right * zoom + padX,
    marginTop: bleed.top * zoom + padY,
    marginBottom: bleed.bottom * zoom + padY,
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

/** Space kept clear for the decision popup docked on the right of a wide table. */
const DOCK_RESERVE = 400;
/** Below this table width the popup is a bottom sheet and nothing is reserved for it. */
const DOCK_MIN_TABLE = 1000;
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

function useAreaSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** The zoom that shows the whole board in the free part of the table, and where to put it. */
function fitLayout(bounds: Bounds | null, area: { w: number; h: number }, docked: boolean) {
  if (!bounds || !area.w || !area.h) return null;
  const reserve = area.w >= DOCK_MIN_TABLE ? DOCK_RESERVE : 0;
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const availW = area.w - FIT_PAD * 2 - reserve;
  const availH = area.h - FIT_PAD * 2 - HAND_RESERVE;
  const zoom = Math.min(FIT_MAX, Math.max(0.05, Math.min(availW / bw, availH / bh)));
  // The zoom always leaves room for the popup; the board only slides over while it is open.
  const right = docked ? area.w - reserve : area.w;
  const cx = right / 2;
  // A narrow table shows the popup as a bottom sheet: lift the board to the top, above it.
  const cy = docked && !reserve ? FIT_PAD + (bh * zoom) / 2 : FIT_PAD + availH / 2;
  return {
    zoom,
    marginLeft: cx - ((bounds.minX + bounds.maxX) / 2) * zoom,
    marginTop: cy - ((bounds.minY + bounds.maxY) / 2) * zoom,
    width: bounds.maxX * zoom,
    height: bounds.maxY * zoom,
  };
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
  /** A decision popup is docked on the right: keep the board clear of it. */
  docked?: boolean;
};

/**
 * The table: the live map. At rest the whole board is fitted into the free part of the table (clear of the
 * hand bar and of a docked decision popup) and follows the window size; zooming in makes it pannable, and
 * zooming back out (or the fit button) returns to the fitted view.
 */
export function BoardTable({ gameName, docked = false }: Props) {
  const gameData = useGameData();
  const tilesList = useTilesList(gameData?.tiles);
  useDragScroll();

  const { tooltipUnit, handleMouseEnter, handleMouseLeave, handleMouseDown } = useTabsAndTooltips();
  const { tooltipPlanet, handlePlanetMouseEnter, handlePlanetMouseLeave, handleUnitMouseEnter, handleUnitMouseLeave } =
    useMapTooltips(handleMouseEnter, handleMouseLeave);

  const isFirefox = useSettingsStore((s) => s.settings.isFirefox);

  const mapLayout = getMapLayoutConfig("pannable");
  const contentSize = useMapContentSize("pannable");
  const containerRef = useRef<HTMLDivElement>(null);
  const area = useAreaSize(containerRef);
  const bounds = usePaintedBounds(contentSize.height);
  const fit = fitLayout(bounds, area, docked);

  const fitZoom = fit?.zoom ?? 0;
  const { zoom: boardZoom, fitted, zoomIn, zoomOut, fit: fitBoard } = useBoardZoom(containerRef, fitZoom, gameName);
  const useFit = fitted && !!fit;
  const zoom = fit ? boardZoom : computeMapZoom(DEFAULT_ZOOM, contentSize.width + 150);
  const board = boardGeometry(contentSize, contentSize.width + mapLayout.mapWidthExtra, zoom);
  const placement = useFit
    ? {
        width: fit.width,
        height: fit.height,
        margins: {
          marginLeft: fit.marginLeft,
          marginTop: fit.marginTop,
          transition: "margin-left 240ms ease",
        },
      }
    : fit
      ? { width: board.width, height: board.height, margins: roomyMargins(contentSize, zoom, area) }
      : { width: board.width, height: board.height, margins: board.margins };

  useBoardShortcuts({ zoomIn, zoomOut, fit: fitBoard });
  useScrollToReplayHighlight(containerRef);
  useFocusReveal(containerRef);

  return (
    <div className={classes.table}>
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
            tooltipUnit={tooltipUnit}
            tooltipPlanet={tooltipPlanet}
          />
        )}
      </div>
      <MapActionsLayer gameName={gameName} containerRef={containerRef} docked={docked} />
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
