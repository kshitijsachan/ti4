import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Tooltip, UnstyledButton } from "@mantine/core";
import { IconMinus, IconPlus, IconArrowsMinimize } from "@tabler/icons-react";
import { InteractiveMapRenderer } from "@/domains/map/components/renderer/InteractiveMapRenderer";
import { useDragScroll } from "@/hooks/useDragScroll";
import { useTabsAndTooltips } from "@/hooks/useTabsAndTooltips";
import { useGameData, useGameDataState } from "@/state/useGameContext";
import { useAppStore, useSettingsStore } from "@/state/appStore";
import { useMapContentSize } from "@/domains/map/components/hooks/useMapContentSize";
import { useTilesList } from "@/hooks/useTilesList";
import { shouldHideZoomControls, computeMapZoom } from "@/utils/zoom";
import { useMapTooltips } from "@/domains/map/components/hooks/useMapTooltips";
import { ReconnectButton } from "@/domains/map/components/renderer/ReconnectButton";
import { getMapLayoutConfig } from "@/domains/map/components/mapLayout";
import { useMapKeyboardShortcuts } from "@/domains/map/components/hooks/useMapKeyboardShortcuts";
import { useScrollToReplayHighlight } from "@/hooks/useScrollToReplayHighlight";
import {
  calculateStatTilePositions,
  HEX_PATH,
  TILE_HEIGHT,
  TILE_WIDTH,
} from "@/entities/geometry/tilePositioning";
import { useBoardFocus } from "./focus";
import classes from "./BoardTable.module.css";

const CLEARANCE = 20;
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
const HAND_RESERVE = 40;
const FIT_PAD = 12;
const FIT_MAX = 1;

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** The painted extent of the board (tiles and the stat tiles around it), unscaled. */
function usePaintedBounds(): Bounds | null {
  const gameData = useGameData();
  const tiles = useTilesList(gameData?.tiles);
  return useMemo(() => {
    if (!tiles.length) return null;
    const stats = calculateStatTilePositions(
      Object.values(gameData?.statTilePositions ?? {}).flat(),
      gameData?.ringCount,
      gameData?.tilePositions,
    );
    const points = [...tiles.map((t) => t.properties), ...stats];
    return {
      minX: Math.min(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxX: Math.max(...points.map((p) => p.x + TILE_WIDTH)),
      maxY: Math.max(...points.map((p) => p.y + TILE_HEIGHT)),
    };
  }, [tiles, gameData?.statTilePositions, gameData?.ringCount, gameData?.tilePositions]);
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
  const cy = FIT_PAD + availH / 2;
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
  const gameDataState = useGameDataState();
  useDragScroll();

  const { selectedArea, tooltipUnit, handleAreaSelect, handleMouseEnter, handleMouseLeave, handleMouseDown } =
    useTabsAndTooltips();
  const { tooltipPlanet, handlePlanetMouseEnter, handlePlanetMouseLeave, handleUnitMouseEnter, handleUnitMouseLeave } =
    useMapTooltips(handleMouseEnter, handleMouseLeave);

  const storeZoom = useAppStore((s) => s.zoomLevel);
  const handleZoomIn = useAppStore((s) => s.handleZoomIn);
  const handleZoomOut = useAppStore((s) => s.handleZoomOut);
  const handleZoomFitToWidth = useAppStore((s) => s.handleZoomFitToWidth);
  const settings = useSettingsStore((s) => s.settings);
  const handlers = useSettingsStore((s) => s.handlers);

  const mapLayout = getMapLayoutConfig("pannable");
  const contentSize = useMapContentSize("pannable");
  const containerRef = useRef<HTMLDivElement>(null);
  const area = useAreaSize(containerRef);
  const bounds = usePaintedBounds();
  const fit = fitLayout(bounds, area, docked);

  // Fitted until the player zooms past the fit; zooming back down to it (or below) fits again.
  const [fitted, setFitted] = useState(true);
  const fitZoom = fit?.zoom ?? 0;
  const lastStoreZoom = useRef(storeZoom);
  useEffect(() => {
    const changed = lastStoreZoom.current !== storeZoom;
    lastStoreZoom.current = storeZoom;
    if (!fitZoom) return;
    if (storeZoom <= fitZoom) setFitted(true);
    else if (changed) setFitted(false);
  }, [storeZoom, fitZoom]);
  useEffect(() => setFitted(true), [gameName]);

  const useFit = fitted && !!fit;
  const zoom = useFit ? fit.zoom : computeMapZoom(storeZoom, contentSize.width + 150);
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
    : { width: board.width, height: board.height, margins: board.margins };

  /** Out of the fitted view: the next zoom step above it, centred on the board. */
  const zoomIn = () => {
    if (!useFit) return handleZoomIn();
    let next = handleZoomFitToWidth(1, fitZoom);
    if (next <= fitZoom) {
      handleZoomIn();
      next = useAppStore.getState().zoomLevel;
    }
    setFitted(false);
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el || !bounds) return;
      el.scrollTo({
        left: ((bounds.minX + bounds.maxX) / 2) * next - el.clientWidth / 2 + CLEARANCE,
        top: ((bounds.minY + bounds.maxY) / 2) * next - el.clientHeight / 2 + CLEARANCE,
      });
    });
  };
  const zoomOut = () => {
    if (useFit) return;
    handleZoomOut();
  };

  useMapKeyboardShortcuts({ handlers, settings, handleZoomIn, handleZoomOut, handleAreaSelect, selectedArea });
  useScrollToReplayHighlight(containerRef);
  useFocusReveal(containerRef);

  return (
    <div className={classes.table}>
      <div ref={containerRef} className={`dragscroll ${classes.scroller} ${useFit ? classes.fitted : ""}`}>
        {gameData && (
          <InteractiveMapRenderer
            mapLayoutConfig={mapLayout}
            zoom={zoom}
            isFirefox={settings.isFirefox}
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
      {!shouldHideZoomControls() && (
        <div className={classes.zoom}>
          <ZoomButton label="Zoom in" onClick={zoomIn} disabled={!useFit && storeZoom >= 2}>
            <IconPlus size={14} stroke={1.8} />
          </ZoomButton>
          <ZoomButton label="Zoom out" onClick={zoomOut} disabled={useFit}>
            <IconMinus size={14} stroke={1.8} />
          </ZoomButton>
          <ZoomButton label="Fit the board" onClick={() => setFitted(true)} disabled={useFit}>
            <IconArrowsMinimize size={14} stroke={1.8} />
          </ZoomButton>
        </div>
      )}
      <ReconnectButton gameDataState={gameDataState} />
    </div>
  );
}
