import cx from "clsx";
import type { DraftSlice, DraftState } from "../types";
import classes from "../Draft.module.css";

type Props = {
  draft: DraftState;
  botBase: string;
  width: number;
  /** Seat (template player number) to emphasise, e.g. yours or the hovered speaker position. */
  seat: number | null;
  /** When set together with `seat`, ghost these slice tiles into that seat. */
  ghostSlice?: DraftSlice | null;
};

/**
 * The galaxy as the bot is building it: every template position with whatever tile the draft has placed so
 * far, seat numbers on the home positions, and an optional "what if" slice ghosted into a seat.
 */
export function GalaxyPreview({
  draft,
  botBase,
  width,
  seat,
  ghostSlice,
}: Props) {
  const template = draft.mapTemplate;
  if (!template) return null;
  /* Ring positions only: corner slots ("tl", "br", …) hold off-board extras that would blow up the bounds. */
  const positions = template.positions.filter((p) => /^\d+$/.test(p.pos));
  if (positions.length === 0) return null;
  const tw = template.tileWidth;
  const th = template.tileHeight;
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) + tw - minX;
  const spanY = Math.max(...ys) + th - minY;
  const scale = width / spanX;
  const height = Math.round(spanY * scale);
  const w = Math.round(tw * scale);
  const h = Math.round(th * scale);

  const ownerBySeat = new Map<number, string>();
  for (const p of draft.players) {
    const s = draft.seats.length > 0 ? p.seat : p.speakerOrder;
    if (s != null) ownerBySeat.set(s, p.name);
  }

  return (
    <div className={classes.galaxy} style={{ width, height }}>
      {positions.map((p) => {
        const inSeat = seat != null && p.playerNumber === seat;
        const ghost =
          inSeat && ghostSlice && p.miltyTileIndex != null
            ? ghostSlice.tiles[p.miltyTileIndex]
            : undefined;
        const src = ghost ? ghost.image : p.image;
        const left = (p.x - minX) * scale;
        const top = (p.y - minY) * scale;
        return (
          <div
            key={p.pos}
            className={cx(
              classes.galaxyHex,
              inSeat && classes.galaxySeat,
              ghost && classes.galaxyGhost,
            )}
            style={{ left, top, width: w, height: h }}
            title={p.pos}
          >
            {src ? (
              <img
                src={`${botBase}${src}?w=160`}
                alt=""
                draggable={false}
                loading="lazy"
              />
            ) : null}
            {p.home && p.playerNumber != null && (
              <span className={classes.galaxySeatLabel}>
                <b>{p.playerNumber}</b>
                {ownerBySeat.get(p.playerNumber) && (
                  <em>{ownerBySeat.get(p.playerNumber)}</em>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
