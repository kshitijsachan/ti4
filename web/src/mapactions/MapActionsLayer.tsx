import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { IconCheck, IconX, IconInfoCircle } from "@tabler/icons-react";
import cx from "clsx";
import { useGameData } from "@/state/useGameContext";
import { useAppStore } from "@/state/appStore";
import { getTileById } from "@/entities/lookup/systems";
import {
  HEX_PATH,
  TILE_HEIGHT,
  TILE_WIDTH,
} from "@/entities/geometry/tilePositioning";
import { baseId } from "@/decisions/model/controls";
import { useMapActionContext } from "./context";
import { activationOf, type Activation } from "./eligibility";
import { activateSystem as driveActivation } from "./activate";
import { buttonsOf, pressButton } from "./driver";
import { promptHasMoves, unitsAt, type UnitGroup } from "./movement";
import { distancesTo } from "./range";
import { landingOffer } from "./landing";
import { useMapActions } from "./store";
import { tileAt, useTileRects, type Rect } from "./useTileRects";
import { MovePanel, MoveArt, UnitPicker } from "./MovePanel";
import { LandingPanel } from "./LandingPanel";
import classes from "./MapActions.module.css";

type Props = {
  gameName: string;
  /** The map's scroller: clicks on its hexes are read here (and never after a drag). */
  containerRef: RefObject<HTMLDivElement | null>;
  /** The decision popup is docked on the right of the table. */
  docked?: boolean;
};

type Chip = { position: string; kind: "activate" | "pick"; label: string };

const DRAG_SLOP = 6;
const TOOLTIP_DELAY = 350;

function HexMark({ rect, className }: { rect: Rect; className: string }) {
  return (
    <svg
      className={classes.mark}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      viewBox={`0 0 ${TILE_WIDTH} ${TILE_HEIGHT}`}
      aria-hidden="true"
    >
      <path d={HEX_PATH} className={className} />
    </svg>
  );
}

/** Keeps a class on the map's tile elements (they are upstream components, so it is set by id). */
function useTileClasses(byPosition: Record<string, string>) {
  useEffect(() => {
    const apply = () => {
      document
        .querySelectorAll(
          ".mapactions-can, .mapactions-cannot, .mapactions-origin",
        )
        .forEach((el) => {
          const want = byPosition[el.id.slice("tile-".length)];
          for (const c of [
            "mapactions-can",
            "mapactions-cannot",
            "mapactions-origin",
          ])
            if (c !== want) el.classList.remove(c);
        });
      for (const [pos, cls] of Object.entries(byPosition))
        document.getElementById(`tile-${pos}`)?.classList.add(cls);
    };
    apply();
    const timer = window.setInterval(apply, 1500);
    return () => {
      window.clearInterval(timer);
      document
        .querySelectorAll(
          ".mapactions-can, .mapactions-cannot, .mapactions-origin",
        )
        .forEach((el) =>
          el.classList.remove(
            "mapactions-can",
            "mapactions-cannot",
            "mapactions-origin",
          ),
        );
    };
  }, [byPosition]);
}

/**
 * The map's actions: on my action-phase turn a click on a system activates it (after a one-tap confirm) by
 * driving the bot's own Tactical Action → ring → system buttons; then ships are picked on the map and moved in
 * one go, and ground forces landed per planet with one confirm. Other prompts whose answers are systems can be
 * answered by clicking the system too.
 */
export function MapActionsLayer({
  gameName,
  containerRef,
  docked = false,
}: Props) {
  const gameData = useGameData();
  const tiles = useMemo(() => gameData?.tiles ?? {}, [gameData?.tiles]);
  const names = useMemo(
    () =>
      Object.fromEntries(
        Object.values(tiles).map((t) => [
          t.position,
          getTileById(t.systemId)?.name ?? "",
        ]),
      ),
    [tiles],
  );
  const ctx = useMapActionContext(gameName, names);
  const { step, me, web, conn, scope, pick } = ctx;
  const frameRef = useRef<HTMLDivElement>(null);
  const [chip, setChip] = useState<Chip | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{
    position: string;
    x: number;
    y: number;
  } | null>(null);
  const [tipShown, setTipShown] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const handedBack = useMapActions((s) => s.handedBack);
  const requested = useMapActions((s) => s.requested);
  const plan = useMapActions((s) => s.plan);
  const setPresence = useMapActions((s) => s.setPresence);
  const resetPlans = useMapActions((s) => s.resetPlans);
  const openDossier = useAppStore((s) => s.openSystemDossier);

  const promptId = step.kind === "none" ? null : step.prompt.message.id;
  const prompt =
    step.kind === "none"
      ? null
      : { channelId: step.prompt.channelId, messageId: step.prompt.message.id };
  const ownsPrompt = !!promptId && !handedBack[promptId];
  const activating = step.kind === "turn" || step.kind === "choose";
  const target =
    step.kind === "move" || step.kind === "land" ? step.target : null;
  const moving =
    step.kind === "move" &&
    ownsPrompt &&
    !!prompt &&
    (!promptHasMoves(conn, prompt) || !!busy);
  const offer =
    step.kind === "land" && prompt ? landingOffer(conn, scope, prompt) : null;
  const landing = step.kind === "land" && ownsPrompt && !!offer;

  /* What a click on each system would do now. */
  const activation = useMemo<Record<string, Activation>>(() => {
    if (!activating) return {};
    return Object.fromEntries(
      Object.values(tiles).map((t) => [
        t.position,
        activationOf(t, me, web, step),
      ]),
    );
  }, [activating, tiles, me, web, step]);

  const origins = useMemo(() => {
    if (step.kind !== "move" || !me) return [];
    const ids = buttonsOf(step.prompt.message, me.faction).map(
      (c) => baseId(c.customId).match(/^tacticalMoveFrom_(\w+)/)?.[1],
    );
    return [...new Set(ids)].filter(
      (p): p is string => !!p && p !== step.target,
    );
  }, [step, me]);
  const groups = useMemo(() => {
    const out: Record<string, UnitGroup[]> = {};
    if (!me) return out;
    for (const o of origins) {
      const list = unitsAt(o, me, web);
      if (list.length) out[o] = list;
    }
    return out;
  }, [origins, me, web]);
  const distances = useMemo(
    () =>
      target && me && moving
        ? distancesTo(target, tiles, me.faction, me.techs ?? [], web)
        : new Map<string, number>(),
    [target, me, moving, tiles, web],
  );

  /* The popup steps aside while the map answers the move / land prompt. */
  useEffect(() => {
    const mapStep = moving
      ? "move"
      : landing
        ? "land"
        : activating
          ? "activate"
          : pick
            ? "pick"
            : null;
    setPresence(
      moving || landing,
      mapStep,
      moving || landing ? promptId : null,
    );
  }, [moving, landing, activating, pick, promptId, setPresence]);
  useEffect(() => () => setPresence(false, null, null), [setPresence]);

  /* A new tactical action starts with nothing planned. */
  useEffect(() => {
    resetPlans();
    setPicker(null);
  }, [target, resetPlans]);

  useEffect(() => {
    if (!activating) setChip((c) => (c?.kind === "activate" ? null : c));
  }, [activating]);

  const tileClasses = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [pos, a] of Object.entries(activation))
      out[pos] = a.ok ? "mapactions-can" : "mapactions-cannot";
    if (moving)
      for (const o of Object.keys(groups)) out[o] = "mapactions-origin";
    if (pick)
      for (const pos of Object.keys(pick.byPosition))
        out[pos] = "mapactions-can";
    return out;
  }, [activation, moving, groups, pick]);
  useTileClasses(tileClasses);

  /* Someone else (a link, another panel) asked to activate a system. */
  useEffect(() => {
    if (!requested) return;
    useMapActions.getState().request(null);
    const a = activation[requested];
    if (a?.ok)
      setChip({
        position: requested,
        kind: "activate",
        label: `Activate ${names[requested] || requested}?`,
      });
    else
      setError(
        a && !a.ok ? a.reason : "You can't activate a system right now.",
      );
  }, [requested, activation, names]);

  /* Map clicks: answered here when they mean something for the current step, else left to the map (dossier). */
  const onTileClick = useRef<(position: string) => boolean>(() => false);
  onTileClick.current = (position: string) => {
    if (busy) return true;
    setError(null);
    if (activating) {
      const a = activation[position];
      if (!a?.ok) return false;
      setChip({
        position,
        kind: "activate",
        label: `Activate ${names[position] || "system"}?`,
      });
      return true;
    }
    if (moving && groups[position]) {
      setPicker((p) => (p === position ? null : position));
      return true;
    }
    if (pick?.byPosition[position]) {
      setChip({
        position,
        kind: "pick",
        label: pick.byPosition[position].label,
      });
      return true;
    }
    return false;
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      const start = down;
      down = null;
      if (e.button !== 0) return;
      if (
        start &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_SLOP
      )
        return;
      const position = tileAt(e.target);
      if (!position || !onTileClick.current(position)) return;
      e.stopPropagation();
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      const frame = frameRef.current?.getBoundingClientRect();
      const position = tileAt(e.target);
      if (!frame || !position) {
        setHover(null);
        return;
      }
      setHover((h) =>
        h?.position === position &&
        Math.abs(h.x - (e.clientX - frame.left)) < 40 &&
        Math.abs(h.y - (e.clientY - frame.top)) < 40
          ? h
          : { position, x: e.clientX - frame.left, y: e.clientY - frame.top },
      );
    };
    const onLeave = () => setHover(null);
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("click", onClick, true);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [containerRef]);

  const hoverPos = hover?.position;
  useEffect(() => {
    setTipShown(false);
    if (!hoverPos) return;
    const timer = window.setTimeout(() => setTipShown(true), TOOLTIP_DELAY);
    return () => window.clearTimeout(timer);
  }, [hoverPos]);

  useEffect(() => {
    if (!chip && !picker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChip(null);
        setPicker(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chip, picker]);

  const placed = useMemo(() => {
    const list = new Set<string>();
    if (chip) list.add(chip.position);
    if (target && (moving || landing)) list.add(target);
    if (moving) Object.keys(groups).forEach((o) => list.add(o));
    return [...list].sort();
  }, [chip, target, moving, landing, groups]);
  const rects = useTileRects(frameRef, placed);

  const run = async (work: () => Promise<void>) => {
    setBusy("Working…");
    setError(null);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const confirmChip = () => {
    if (!chip) return;
    const { position, kind } = chip;
    setChip(null);
    if (kind === "activate") {
      void run(() =>
        driveActivation(position, { conn, scope, step, onProgress: setBusy }),
      );
      return;
    }
    const choice = pick?.byPosition[position];
    if (!choice?.customId || !pick) return;
    void run(() =>
      pressButton(conn, {
        channelId: pick.prompt.channelId,
        messageId: pick.prompt.message.id,
        customId: choice.customId!,
      }),
    );
  };

  const tooltip = (() => {
    if (!hover || !tipShown || chip || busy || hover.position === picker) return null;
    const name = names[hover.position];
    const label = `${name ? `${name} ` : ""}(${hover.position})`;
    if (activating) {
      const a = activation[hover.position];
      if (!a) return null;
      return a.ok
        ? { text: `${label} — click to activate`, blocked: false }
        : { text: `${label} — ${a.reason}`, blocked: true };
    }
    if (moving && groups[hover.position]) {
      const d = distances.get(hover.position);
      const fastest = Math.max(
        0,
        ...groups[hover.position].filter((g) => !g.cargo).map((g) => g.move),
      );
      const reach =
        d === undefined
          ? "no clear path by my count"
          : `${d} away · fastest ship moves ${fastest}`;
      return {
        text: `${label} — pick ships to move from here (${reach})`,
        blocked: false,
      };
    }
    if (moving && hover.position === target)
      return { text: `${label} — your ships move here`, blocked: false };
    if (pick?.byPosition[hover.position])
      return {
        text: `Click to choose: ${pick.byPosition[hover.position].label}`,
        blocked: false,
      };
    return null;
  })();

  const chipRect = chip ? rects[chip.position] : undefined;
  const dossierFor = (position: string) => {
    const systemId = tiles[position]?.systemId;
    if (systemId) openDossier(position, systemId);
  };

  const showBar =
    moving || landing || (!!busy && !moving && !landing) || (!!error && !chip);

  return (
    <>
      <div ref={frameRef} className={cx(classes.layer, "ti4play")}>
        {moving && target && (
          <MoveArt
            rects={rects}
            target={target}
            groups={groups}
            distances={distances}
            plan={plan}
            color={me?.color}
          />
        )}
        {chip && chipRect && (
          <HexMark rect={chipRect} className={classes.hexConfirm} />
        )}
        {landing && target && rects[target] && (
          <HexMark rect={rects[target]} className={classes.hexTarget} />
        )}
      </div>
      <div className={cx(classes.layer, classes.ui, "ti4play")}>
        {chip && chipRect && (
          <div
            className={cx(classes.surface, classes.chip)}
            style={{
              left: chipRect.x + chipRect.w / 2,
              top: chipRect.y + chipRect.h * 0.22,
            }}
            role="dialog"
            aria-label={chip.label}
          >
            <span className={classes.chipText}>{chip.label}</span>
            <span className={cx(classes.mono, classes.muted)}>
              {chip.position}
            </span>
            <button
              type="button"
              className={cx(classes.iconButton, classes.go)}
              onClick={confirmChip}
              autoFocus
              aria-label="Confirm"
              title="Confirm (Enter)"
            >
              <IconCheck size={16} stroke={2.2} />
            </button>
            <button
              type="button"
              className={classes.iconButton}
              onClick={() => setChip(null)}
              aria-label="Cancel"
              title="Cancel (Esc)"
            >
              <IconX size={15} stroke={2} />
            </button>
            <button
              type="button"
              className={classes.iconButton}
              onClick={() => {
                dossierFor(chip.position);
                setChip(null);
              }}
              aria-label="System details"
              title="System details"
            >
              <IconInfoCircle size={15} stroke={1.8} />
            </button>
          </div>
        )}

        {tooltip && hover && (
          <div
            className={cx(
              classes.surface,
              classes.tooltip,
              tooltip.blocked && classes.tooltipBlocked,
            )}
            style={{ left: hover.x, top: hover.y }}
          >
            {tooltip.text}
          </div>
        )}

        {moving && picker && groups[picker] && rects[picker] && me && (
          <UnitPicker
            origin={picker}
            name={names[picker]}
            rect={rects[picker]}
            frame={frameRef}
            groups={groups[picker]}
            distance={distances.get(picker)}
            color={me.color}
            onClose={() => setPicker(null)}
          />
        )}

        {showBar && (
          <div
            className={cx(
              classes.surface,
              classes.bar,
              docked && classes.barDocked,
            )}
          >
            {moving && target && prompt && me ? (
              <MovePanel
                gameName={gameName}
                target={target}
                targetName={names[target]}
                groups={groups}
                color={me.color}
                conn={conn}
                scope={scope}
                prompt={prompt}
                busy={busy}
                error={error}
                run={run}
                setBusy={setBusy}
                onHandBack={() =>
                  promptId && useMapActions.getState().handBack(promptId)
                }
                hasOrigins={Object.keys(groups).length > 0}
              />
            ) : landing && target && prompt && offer && me ? (
              <LandingPanel
                target={target}
                targetName={names[target]}
                offer={offer}
                me={me}
                web={web}
                conn={conn}
                scope={scope}
                prompt={prompt}
                busy={busy}
                error={error}
                run={run}
                setBusy={setBusy}
                onHandBack={() =>
                  promptId && useMapActions.getState().handBack(promptId)
                }
              />
            ) : (
              <div className={classes.barHead}>
                <span className={busy ? classes.barText : classes.error}>
                  {busy ?? error}
                </span>
                <span className={classes.grow} />
                {!busy && (
                  <button
                    type="button"
                    className={classes.iconButton}
                    onClick={() => setError(null)}
                    aria-label="Dismiss"
                  >
                    <IconX size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
