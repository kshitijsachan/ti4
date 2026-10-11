import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import cx from "clsx";
import { useBoardCover } from "@/state/boardCover";
import classes from "./Popup.module.css";

export { classes as popupClasses };

/**
 * The popup's floating layer: rendered into the page body over the board area (under the top bar, over the hand
 * bar, left of an open side drawer); a full-screen overlay (players view, a player's sheet) puts it underneath.
 */
export function PopupLayer({ children, contained, rightInset, peeking }: {
  children: ReactNode;
  contained: boolean;
  rightInset: number;
  peeking?: boolean;
}) {
  const style = { "--decision-right-inset": `${rightInset}px` } as CSSProperties;
  const covered = useBoardCover((s) => s.open > 0);
  const layer = (
    <div className={cx("ti4play", classes.layer, classes.fixed, contained && classes.board, peeking && classes.peeking, covered && classes.covered)} style={style}>
      {children}
    </div>
  );
  return typeof document === "undefined" ? layer : createPortal(layer, document.body);
}

/** Whether a scrolling body has more above / below its visible part, kept current as it scrolls and grows. */
export function useScrollEdges(el: HTMLElement | null) {
  const [edges, setEdges] = useState({ above: false, below: false });
  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const above = el.scrollTop > 2;
      const below = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      setEdges((e) => (e.above === above && e.below === below ? e : { above, below }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(el);
    const mutate = new MutationObserver(measure);
    mutate.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", measure);
      resize?.disconnect();
      mutate.disconnect();
    };
  }, [el]);
  return edges;
}

/** "Peek at map": hold to see the map while held, or click (or Space/Enter) to keep peeking until the next click. */
export function usePeek() {
  const [peeking, setPeeking] = useState(false);
  const [mode, setMode] = useState<"hold" | "toggle" | null>(null);
  const start = useRef(0);
  useEffect(() => {
    if (!peeking) return;
    const stop = () => {
      setPeeking(false);
      setMode(null);
    };
    const release = () => {
      if (mode !== "hold") return;
      if (Date.now() - start.current < 300) setMode("toggle");
      else stop();
    };
    const anyClick = () => mode === "toggle" && stop();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stop();
    window.addEventListener("pointerup", release);
    window.addEventListener("pointerdown", anyClick);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointerdown", anyClick);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      window.removeEventListener("keydown", onKey);
    };
  }, [peeking, mode]);
  return {
    peeking,
    hold: () => {
      start.current = Date.now();
      setMode("hold");
      setPeeking(true);
    },
    toggle: () => {
      setMode("toggle");
      setPeeking((v) => !v);
    },
  };
}

/** The popup's footer, under its scrolling body: where a renderer's primary action (Confirm, Pay, Vote) goes. */
export const FooterSlot = createContext<HTMLElement | null>(null);

/**
 * A renderer's primary action, kept in the popup's footer so a long body scrolls under it and the action never
 * falls below the fold. Rendered in place outside a popup.
 */
export function DecisionFooter({ children }: { children: ReactNode }) {
  const slot = useContext(FooterSlot);
  if (!slot) return <>{children}</>;
  return createPortal(<div className={classes.footerPart}>{children}</div>, slot);
}
