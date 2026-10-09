import { useEffect, useRef, type RefObject } from "react";
import { InteractiveMapRenderer } from "@/domains/map/components/renderer/InteractiveMapRenderer";
import { useDragScroll } from "@/hooks/useDragScroll";
import { useTabsAndTooltips } from "@/hooks/useTabsAndTooltips";
import { useGameData, useGameDataState } from "@/state/useGameContext";
import { useAppStore, useSettingsStore } from "@/state/appStore";
import ZoomControls from "@/shared/ui/map/ZoomControls";
import { useMapContentSize } from "@/domains/map/components/hooks/useMapContentSize";
import { useTilesList } from "@/hooks/useTilesList";
import { shouldHideZoomControls, computeMapZoom } from "@/utils/zoom";
import { useMapTooltips } from "@/domains/map/components/hooks/useMapTooltips";
import { ReconnectButton } from "@/domains/map/components/renderer/ReconnectButton";
import { getMapLayoutConfig } from "@/domains/map/components/mapLayout";
import { useMapKeyboardShortcuts } from "@/domains/map/components/hooks/useMapKeyboardShortcuts";
import { useScrollToReplayHighlight } from "@/hooks/useScrollToReplayHighlight";
import { HEX_PATH, TILE_HEIGHT, TILE_WIDTH } from "@/entities/geometry/tilePositioning";
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

/**
 * The table: the live map, full bleed, pannable. The first time a game's board
 * arrives it is fitted to the space so every system is in view.
 */
export function BoardTable({ gameName }: { gameName: string }) {
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
  const zoom = computeMapZoom(storeZoom, contentSize.width + 150);
  const board = boardGeometry(contentSize, contentSize.width + mapLayout.mapWidthExtra, zoom);
  const containerRef = useRef<HTMLDivElement>(null);

  const fitBoard = (smooth = true) => {
    const area = containerRef.current;
    if (!area || !area.clientHeight) return;
    const availW = area.clientWidth - CLEARANCE * 2;
    const availH = area.clientHeight - CLEARANCE * 2;
    const widthToFit = Math.max(board.paintedWidth, (board.paintedHeight * availW) / availH);
    const fitZoom = handleZoomFitToWidth(widthToFit, availW);
    requestAnimationFrame(() => {
      const centreX = CLEARANCE + (board.paintedWidth * fitZoom) / 2;
      area.scrollTo({
        left: Math.max(0, centreX - area.clientWidth / 2),
        top: 0,
        behavior: smooth ? "smooth" : "auto",
      });
    });
  };

  const fitted = useRef<string | null>(null);
  const hasBoard = !!gameData && contentSize.width > 0;
  useEffect(() => {
    if (!hasBoard || fitted.current === gameName) return;
    fitted.current = gameName;
    fitBoard(false);
    // Fit once per game, when its board first has a size.
  }, [hasBoard, gameName]);

  useMapKeyboardShortcuts({ handlers, settings, handleZoomIn, handleZoomOut, handleAreaSelect, selectedArea });
  useScrollToReplayHighlight(containerRef);
  useFocusReveal(containerRef);

  return (
    <div className={classes.table}>
      <div ref={containerRef} className={`dragscroll ${classes.scroller}`}>
        {gameData && (
          <InteractiveMapRenderer
            mapLayoutConfig={mapLayout}
            zoom={zoom}
            isFirefox={settings.isFirefox}
            contentSize={contentSize}
            layoutWidthOverride={board.width}
            layoutHeightOverride={board.height}
            widthOverride={board.unscaledWidth}
            heightOverride={board.unscaledHeight}
            styleOverrides={board.margins}
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
          <ZoomControls zoomClass="" hideFitToScreen onFitBoard={() => fitBoard()} />
        </div>
      )}
      <ReconnectButton gameDataState={gameDataState} />
    </div>
  );
}
