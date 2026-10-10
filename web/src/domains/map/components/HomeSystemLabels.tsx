import { memo, type CSSProperties } from "react";
import {
  calculateStatTilePositions,
  TILE_HEIGHT,
  TILE_WIDTH,
} from "@/entities/geometry/tilePositioning";
import { getPrimaryColorCSS } from "@/entities/lookup/colors";
import { getPlayerFactionDisplayName } from "@/entities/game/playerUtils";
import type { PlayerData } from "@/entities/data/types";
import type { Tile } from "@/entities/game/types";
import styles from "./HomeSystemLabels.module.css";

/** Unscaled size of a label's box, for whoever fits the board to the screen. */
export const HOME_LABEL_WIDTH = 320;
export const HOME_LABEL_HEIGHT = 58;
/** Gap between the home tile's rim and the near edge of its label. */
const RIM_GAP = 14;

export type HomeLabelAnchor = {
  faction: string;
  x: number;
  y: number;
  /** Which way the label hangs off the tile, so the pill hugs the tile side of its box. */
  side: "left" | "right" | "centre";
};

type Point = { x: number; y: number };

const centre = (p: Point) => ({
  x: p.x + TILE_WIDTH / 2,
  y: p.y + TILE_HEIGHT / 2,
});

/**
 * Where each faction's name goes: just outside its home system, on the side where upstream would have drawn
 * its stat hexes (always the open side of the board). The home is the board tile nearest those hexes.
 */
export function homeLabelAnchors(
  statTilePositions: Record<string, string[]> | undefined,
  tiles: Tile[],
  ringCount: number | undefined,
  tilePositions: string[] | undefined,
): HomeLabelAnchor[] {
  if (!statTilePositions || !tiles.length) return [];
  const tileCentres = tiles.map((t) => centre(t.properties));
  const anchors: HomeLabelAnchor[] = [];
  for (const [faction, ids] of Object.entries(statTilePositions)) {
    if (!ids?.length) continue;
    const stats = calculateStatTilePositions(ids, ringCount, tilePositions).map(
      centre,
    );
    const cx = stats.reduce((s, p) => s + p.x, 0) / stats.length;
    const cy = stats.reduce((s, p) => s + p.y, 0) / stats.length;
    let home = tileCentres[0];
    let best = Infinity;
    for (const c of tileCentres) {
      const d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
      if (d < best) {
        best = d;
        home = c;
      }
    }
    const dx = cx - home.x;
    const dy = cy - home.y;
    const len = Math.hypot(dx, dy) || 1;
    // Distance from a flat-topped hex's centre to its rim along (dx, dy), then a little beyond.
    const ux = Math.abs(dx / len);
    const uy = Math.abs(dy / len);
    const rim = Math.min(
      TILE_HEIGHT / 2 / Math.max(uy, 1e-6),
      TILE_HEIGHT / 2 / Math.max((uy + Math.sqrt(3) * ux) / 2, 1e-6),
    );
    // Push the label's near edge (not its centre) out to just past the rim.
    const nx = dx / len;
    const ny = dy / len;
    anchors.push({
      faction,
      x: home.x + nx * (rim + RIM_GAP) + (nx * HOME_LABEL_WIDTH) / 2,
      y: home.y + ny * (rim + RIM_GAP) + (ny * HOME_LABEL_HEIGHT) / 2,
      side: nx < -0.3 ? "left" : nx > 0.3 ? "right" : "centre",
    });
  }
  return anchors;
}

type Props = {
  anchors: HomeLabelAnchor[];
  playerData: PlayerData[];
};

/** A small, quiet faction name in the seat colour beside each home system; the seat rail carries the rest. */
export const HomeSystemLabels = memo(function HomeSystemLabels({
  anchors,
  playerData,
}: Props) {
  return (
    <>
      {anchors.map(({ faction, x, y, side }) => {
        const player = playerData.find((p) => p.faction === faction);
        if (!player) return null;
        return (
          <div
            key={faction}
            className={styles.label}
            data-side={side}
            style={
              {
                left: x - HOME_LABEL_WIDTH / 2,
                top: y - HOME_LABEL_HEIGHT / 2,
                width: HOME_LABEL_WIDTH,
                height: HOME_LABEL_HEIGHT,
                "--seat": getPrimaryColorCSS(player.color),
              } as CSSProperties
            }
          >
            <span className={styles.pill}>
              <span className={styles.dot} />
              <span className={styles.name}>
                {getPlayerFactionDisplayName(player)}
              </span>
            </span>
          </div>
        );
      })}
    </>
  );
});
