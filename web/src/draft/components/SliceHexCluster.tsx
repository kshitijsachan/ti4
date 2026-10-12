import cx from "clsx";
import type { DraftTile, MapTemplate } from "../types";
import classes from "../Draft.module.css";

type Props = {
  tiles: DraftTile[];
  layout: MapTemplate["sliceLayout"];
  tileWidth: number;
  tileHeight: number;
  /** Rendered width in px; omit to fill the container width (tiles scale with it). */
  width?: number;
  botBase: string;
  homeImage?: string | null;
  homeLabel?: string;
  dimmed?: boolean;
  highlightIndex?: number | null;
  onTileHover?: (index: number | null) => void;
};

const DEFAULT_LAYOUT = [
  { x: 260, y: 600 },
  { x: 0, y: 450 },
  { x: 260, y: 300 },
  { x: 520, y: 450 },
  { x: 0, y: 150 },
  { x: 260, y: 0 },
];

/** A slice drawn the way the bot lays it out: home system at the bottom, slice tiles fanned toward Mecatol. */
export function SliceHexCluster({
  tiles,
  layout,
  tileWidth,
  tileHeight,
  width,
  botBase,
  homeImage,
  homeLabel = "HOME",
  dimmed,
  highlightIndex,
  onTileHover,
}: Props) {
  const points = layout.length >= tiles.length + 1 ? layout : DEFAULT_LAYOUT;
  const maxX = Math.max(...points.map((p) => p.x)) + tileWidth;
  const maxY = Math.max(...points.map((p) => p.y)) + tileHeight;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const box = (p: { x: number; y: number }) => ({
    left: pct(p.x, maxX),
    top: pct(p.y, maxY),
    width: pct(tileWidth, maxX),
    height: pct(tileHeight, maxY),
  });
  const imgParam = width && width < 200 ? 160 : 240;
  const home = points[0];

  return (
    <div
      className={cx(classes.cluster, dimmed && classes.clusterDimmed)}
      style={{ width: width ?? "100%", aspectRatio: `${maxX} / ${maxY}` }}
    >
      <div className={classes.clusterHome} style={box(home)}>
        {homeImage ? (
          <img
            src={`${botBase}${homeImage}?w=${imgParam}`}
            alt=""
            draggable={false}
          />
        ) : (
          <svg viewBox="0 0 345 300" aria-hidden>
            <polygon points="86,2 259,2 343,150 259,298 86,298 2,150" />
            <text x="172" y="166" textAnchor="middle">
              {homeLabel}
            </text>
          </svg>
        )}
      </div>
      {tiles.map((tile, i) => {
        const p = points[i + 1];
        if (!p) return null;
        return (
          <img
            key={`${tile.id}-${i}`}
            className={cx(
              classes.clusterTile,
              highlightIndex === i && classes.clusterTileLit,
            )}
            src={`${botBase}${tile.image}?w=${imgParam}`}
            alt={tile.name}
            title={tile.name}
            draggable={false}
            loading="lazy"
            style={box(p)}
            onMouseEnter={onTileHover ? () => onTileHover(i) : undefined}
            onMouseLeave={onTileHover ? () => onTileHover(null) : undefined}
          />
        );
      })}
    </div>
  );
}
