import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { IconMinus, IconPlus, IconX } from "@tabler/icons-react";
import cx from "clsx";
import type { PlayConnection } from "@/discord";
import { cdnImage } from "@/entities/data/cdnImage";
import { getColorAlias } from "@/entities/lookup/colors";
import {
  HEX_PATH,
  TILE_HEIGHT,
  TILE_WIDTH,
} from "@/entities/geometry/tilePositioning";
import { getPlanetData } from "@/entities/lookup/planets";
import type { Scope } from "./driver";
import {
  commitMove,
  groupKey,
  summarize,
  type MovePlan,
  type UnitGroup,
} from "./movement";
import { useMapActions } from "./store";
import { maxBoost, outOfReach, reachOf, reachText, type MoveBonus } from "./range";
import type { useMoveBonuses } from "./bonuses";
import { obstaclesIn, placeBeside, type Rect } from "./useTileRects";
import classes from "./MapActions.module.css";

const unitImg = (color: string | undefined, unit: string) =>
  cdnImage(`/units/${getColorAlias(color)}_${unit}.png`);

function picked(plan: MovePlan, origin: string) {
  return Object.values(plan[origin] ?? {}).reduce((a, b) => a + b, 0);
}

/** Origins lit on the map (by whether they look in reach), arrows for planned moves, and the ghost fleet. */
export function MoveArt({
  rects,
  target,
  groups,
  distances,
  plan,
  color,
  bonuses = [],
}: {
  rects: Record<string, Rect>;
  target: string;
  groups: Record<string, UnitGroup[]>;
  distances: Map<string, number>;
  plan: MovePlan;
  color?: string;
  bonuses?: MoveBonus[];
}) {
  const extra = maxBoost(bonuses);
  const t = rects[target];
  const incoming = new Map<string, number>();
  for (const [origin, picks] of Object.entries(plan)) {
    for (const g of groups[origin] ?? []) {
      const n = picks[groupKey(g)] ?? 0;
      if (n) incoming.set(g.unit, (incoming.get(g.unit) ?? 0) + n);
    }
  }
  const reach = (origin: string) => {
    const d = distances.get(origin);
    const ships = (groups[origin] ?? []).filter((g) => !g.cargo);
    /* Fighters and ground forces ride in ships from elsewhere: only the distance matters for them. */
    if (!ships.length) return d !== undefined;
    return d !== undefined && Math.max(...ships.map((g) => g.move)) + extra >= d;
  };
  return (
    <>
      {Object.keys(groups).map((origin) => {
        const r = rects[origin];
        if (!r) return null;
        const cls = picked(plan, origin)
          ? classes.hexOriginPicked
          : reach(origin)
            ? classes.hexOrigin
            : classes.hexOriginFar;
        return (
          <svg
            key={origin}
            className={classes.mark}
            style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            viewBox={`0 0 ${TILE_WIDTH} ${TILE_HEIGHT}`}
            aria-hidden="true"
          >
            <path d={HEX_PATH} className={cls} />
          </svg>
        );
      })}
      {t && (
        <svg
          className={classes.mark}
          style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
          viewBox={`0 0 ${TILE_WIDTH} ${TILE_HEIGHT}`}
          aria-hidden="true"
        >
          <path d={HEX_PATH} className={classes.hexTarget} />
        </svg>
      )}
      {t && (
        <svg className={classes.art} aria-hidden="true">
          <defs>
            <marker
              id="mapactions-arrow"
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className={classes.arrowHead} />
            </marker>
          </defs>
          {Object.keys(plan)
            .filter((o) => picked(plan, o) && rects[o])
            .map((o) => {
              const a = rects[o];
              const x1 = a.x + a.w / 2;
              const y1 = a.y + a.h / 2;
              const x2 = t.x + t.w / 2;
              const y2 = t.y + t.h / 2;
              const len = Math.hypot(x2 - x1, y2 - y1) || 1;
              const trim = Math.min(t.w * 0.28, len / 3);
              return (
                <line
                  key={o}
                  x1={x1 + ((x2 - x1) / len) * trim}
                  y1={y1 + ((y2 - y1) / len) * trim}
                  x2={x2 - ((x2 - x1) / len) * trim}
                  y2={y2 - ((y2 - y1) / len) * trim}
                  className={classes.arrow}
                  markerEnd="url(#mapactions-arrow)"
                />
              );
            })}
        </svg>
      )}
      {t && incoming.size > 0 && (
        <div
          className={cx(classes.surface, classes.ghost)}
          style={{ left: t.x + t.w / 2, top: t.y + t.h * 0.78 }}
        >
          {[...incoming.entries()].map(([unit, n]) => (
            <span key={unit} className={classes.ghostUnit}>
              <img src={unitImg(color, unit)} alt="" />
              {n}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function holderLabel(holder: string) {
  if (holder === "space") return "";
  return `on ${getPlanetData(holder)?.name ?? holder}`;
}

/** The units of one origin system: click a unit's art (or +) to add one, − to take one back, All for the lot. */
export function UnitPicker({
  origin,
  name,
  rect,
  frame,
  groups,
  allGroups,
  distances,
  bonuses,
  color,
  onClose,
}: {
  origin: string;
  name?: string;
  rect: Rect;
  frame: RefObject<HTMLDivElement | null>;
  groups: UnitGroup[];
  /** Every origin's units, to count the one-ship bonuses planned elsewhere. */
  allGroups: Record<string, UnitGroup[]>;
  distances: Map<string, number>;
  bonuses: MoveBonus[];
  color: string;
  onClose: () => void;
}) {
  const distance = distances.get(origin);
  const plan = useMapActions((s) => s.plan);
  const setPlan = useMapActions((s) => s.setPlan);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: rect.x + rect.w, top: rect.y });

  useLayoutEffect(() => {
    const el = frame.current;
    const me = ref.current?.getBoundingClientRect();
    if (!el || !me) return;
    const box = el.getBoundingClientRect();
    const next = placeBeside(
      rect,
      { w: me.width, h: me.height },
      { w: box.width, h: box.height },
      obstaclesIn(el),
    );
    setPos((p) =>
      Math.abs(p.left - next.left) < 1 && Math.abs(p.top - next.top) < 1
        ? p
        : next,
    );
  }, [rect, frame, groups.length]);

  const picks = plan[origin] ?? {};
  const reach = (g: UnitGroup) => reachOf(g, origin, plan, allGroups, distances, bonuses);
  /* Ships the map counts out of reach cannot be added; a one-ship bonus covers only as many as it allows. */
  const cap = (g: UnitGroup) => {
    const r = reach(g);
    if (r.kind === "ok") return g.total;
    if (r.kind === "bonus") return Math.min(g.total, r.left);
    return picks[groupKey(g)] ?? 0;
  };
  const set = (g: UnitGroup, n: number) =>
    setPlan((p) => ({
      ...p,
      [origin]: {
        ...(p[origin] ?? {}),
        [groupKey(g)]: Math.max(0, Math.min(cap(g), n)),
      },
    }));
  const allShips = () =>
    setPlan((p) => ({
      ...p,
      [origin]: Object.fromEntries(
        groups.map((g) => [groupKey(g), reach(g).kind === "ok" ? g.total : (p[origin]?.[groupKey(g)] ?? 0)]),
      ),
    }));
  const none = () => setPlan((p) => ({ ...p, [origin]: {} }));
  const local = summarize({ [origin]: picks }, { [origin]: groups });

  return (
    <div
      ref={ref}
      className={cx(classes.surface, classes.picker)}
      style={{ left: pos.left, top: pos.top }}
      data-mapactions-float
      role="dialog"
      aria-label={`Units in ${origin}`}
    >
      <div className={classes.pickerHead}>
        <span className={cx(classes.barTitle, classes.ellipsis)}>
          {name || "System"}
        </span>
        <span className={cx(classes.mono, classes.muted)}>{origin}</span>
        <span className={classes.grow} />
        {distance !== undefined && (
          <span className={cx(classes.muted, classes.nowrap)}>
            {distance} away
          </span>
        )}
        <button
          type="button"
          className={cx(classes.iconButton, classes.step)}
          onClick={onClose}
          aria-label="Close"
        >
          <IconX size={13} />
        </button>
      </div>
      {groups.map((g) => {
        const n = picks[groupKey(g)] ?? 0;
        const r = reach(g);
        const slow = r.kind === "far";
        const full = n >= cap(g);
        const damaged = g.states[1] + g.states[3];
        return (
          <div
            key={groupKey(g)}
            className={cx(classes.unitRow, n > 0 && classes.unitRowPicked)}
          >
            <img
              src={unitImg(color, g.unit)}
              alt=""
              className={classes.unitImg}
              onClick={() => set(g, n + 1)}
              title={full && n < g.total ? reachText(r) : "Add one"}
            />
            <span className={classes.unitName}>
              {g.name}
              <span className={cx(classes.unitSub, slow && classes.slow)}>
                {[
                  holderLabel(g.holder),
                  g.cargo ? "needs capacity" : reachText(r),
                  g.capacity ? `capacity ${g.capacity}` : "",
                  damaged ? `${damaged} damaged` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <button
              type="button"
              className={cx(classes.iconButton, classes.step)}
              onClick={() => set(g, n - 1)}
              disabled={!n}
              aria-label={`One less ${g.name}`}
            >
              <IconMinus size={12} />
            </button>
            <span className={classes.count}>
              {n}/{g.total}
            </span>
            <button
              type="button"
              className={cx(classes.iconButton, classes.step)}
              onClick={() => set(g, n + 1)}
              disabled={full}
              title={full && n < g.total ? reachText(r) : undefined}
              aria-label={`One more ${g.name}`}
            >
              <IconPlus size={12} />
            </button>
          </div>
        );
      })}
      <div className={classes.pickerFoot}>
        <button type="button" className={classes.button} onClick={allShips}>
          All
        </button>
        <button
          type="button"
          className={classes.button}
          onClick={none}
          disabled={local.empty}
        >
          None
        </button>
        <span className={classes.grow} />
        {local.capacity > 0 || local.cargo > 0 ? (
          <span
            className={cx(
              classes.mono,
              local.cargo > local.capacity ? classes.slow : classes.muted,
            )}
          >
            cargo {local.cargo}/{local.capacity}
          </span>
        ) : null}
      </div>
    </div>
  );
}

type PanelProps = {
  gameName: string;
  target: string;
  targetName?: string;
  groups: Record<string, UnitGroup[]>;
  color: string;
  conn: PlayConnection;
  scope: Scope;
  prompt: { channelId: string; messageId: string };
  busy: string | null;
  error: string | null;
  run: (work: () => Promise<void>) => Promise<void>;
  setBusy: (text: string | null) => void;
  onHandBack: () => void;
  hasOrigins: boolean;
  distances: Map<string, number>;
  bonuses: MoveBonus[];
  moveBonus: ReturnType<typeof useMoveBonuses>;
};

/** The movement step's bar: what moves in, the capacity it needs, and one Move. */
export function MovePanel({
  gameName,
  target,
  targetName,
  groups,
  color,
  conn,
  scope,
  prompt,
  busy,
  error,
  run,
  setBusy,
  onHandBack,
  hasOrigins,
  distances,
  bonuses,
  moveBonus,
}: PanelProps) {
  const plan = useMapActions((s) => s.plan);
  const resetPlans = useMapActions((s) => s.resetPlans);
  const sum = summarize(plan, groups);
  const far = outOfReach(plan, groups, distances, bonuses);
  const over = sum.cargo > sum.capacity;
  const fill = sum.capacity
    ? Math.min(100, (sum.cargo / sum.capacity) * 100)
    : sum.cargo
      ? 100
      : 0;

  const move = () =>
    run(async () => {
      await moveBonus.runChosen(setBusy);
      await commitMove(target, plan, groups, color, {
        gameName,
        conn,
        scope,
        prompt,
        onProgress: setBusy,
      });
      resetPlans();
    });

  return (
    <>
      <div className={classes.barHead}>
        <span className={classes.barTitle}>
          Move into {targetName || "the system"}
        </span>
        <span className={cx(classes.mono, classes.muted)}>{target}</span>
        <span className={classes.grow} />
        <button
          type="button"
          className={classes.link}
          onClick={onHandBack}
          disabled={!!busy}
        >
          Use the game's buttons
        </button>
      </div>
      <div className={classes.barText}>
        {busy
          ? busy
          : sum.empty
            ? hasOrigins
              ? "Click a glowing system to pick the ships that move in (dimmed: probably out of reach)."
              : "None of your ships can move in. Press Move to continue without moving."
            : `Moving in: ${sum.text}`}
      </div>
      {(sum.capacity > 0 || sum.cargo > 0) && (
        <div className={cx(classes.meter, over && classes.meterOver)}>
          <span>Capacity</span>
          <div className={classes.meterTrack}>
            <div className={classes.meterFill} style={{ width: `${fill}%` }} />
          </div>
          <span className={classes.mono}>
            {sum.cargo}/{sum.capacity}
          </span>
        </div>
      )}
      {(moveBonus.offers.length > 0 || moveBonus.notes.length > 0) && (
        <div className={classes.bonuses} aria-label="Move bonuses">
          {moveBonus.offers.map((o) => (
            <label key={o.id} className={classes.bonus} title={o.note}>
              <input
                type="checkbox"
                checked={moveBonus.chosen.includes(o.id)}
                onChange={() => moveBonus.toggle(o.id)}
                disabled={!!busy}
              />
              <span>{o.label}</span>
            </label>
          ))}
          {moveBonus.notes.map((n) => (
            <div key={n} className={classes.muted}>
              {n}
            </div>
          ))}
        </div>
      )}
      {far.length > 0 && !busy && (
        <div className={cx(classes.barText, classes.slow)}>
          Out of reach by the map's count: {far.join("; ")}. The game will refuse it unless an ability covers it.
        </div>
      )}
      {error && <div className={classes.error}>{error}</div>}
      <div className={classes.barActions}>
        <button
          type="button"
          className={cx(classes.button, classes.primary)}
          onClick={() => void move()}
          disabled={!!busy}
        >
          {sum.empty
            ? "Continue without moving"
            : over || far.length
              ? "Move anyway"
              : "Move"}
        </button>
        <button
          type="button"
          className={classes.button}
          onClick={resetPlans}
          disabled={!!busy || sum.empty}
        >
          Clear
        </button>
      </div>
    </>
  );
}
