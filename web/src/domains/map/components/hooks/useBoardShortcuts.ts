import { useEffect } from "react";
import { useSettingsStore } from "@/state/appStore";

type ZoomActions = {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
};

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** The game screen's map keys; KeyboardShortcutsModal lists exactly these. */
export function useBoardShortcuts({ zoomIn, zoomOut, fit }: ZoomActions) {
  const handlers = useSettingsStore((s) => s.handlers);

  useEffect(() => {
    const actions: Record<string, () => void> = {
      "+": zoomIn,
      "=": zoomIn,
      "-": zoomOut,
      "0": fit,
      o: handlers.toggleOverlays,
      y: handlers.togglePlanetTypesMode,
      t: handlers.toggleTechSkipsMode,
      a: handlers.toggleAttachmentsMode,
      p: handlers.togglePdsMode,
    };

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handlers, zoomIn, zoomOut, fit]);
}
