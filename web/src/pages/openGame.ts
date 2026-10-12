import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getToken } from "@/play/session";

/** The game screen's chunk: the same module the /game/:mapid route lazy-loads. */
const loadGamePage = () => import("./GamePage");

/** Fetches the game screen's code ahead of a click, so opening a game is instant. */
export function preloadGamePage() {
  loadGamePage().catch(() => undefined);
}

/**
 * Opens a game screen. The route is lazy, so a plain router navigation only
 * changes the URL once the screen's code has loaded: on a slow link that is a
 * long, silent wait, and after a redeploy (old chunk names gone) it never
 * happens. Load it first, and if that fails, load the page in full (with the
 * seat's token, so the tab stays signed in).
 */
export function useOpenGame() {
  const navigate = useNavigate();
  return useCallback(
    async (game: string) => {
      const path = game.startsWith("/") ? game : `/game/${game}`;
      try {
        await loadGamePage();
      } catch {
        const token = getToken();
        window.location.assign(
          token ? `${path}?t=${encodeURIComponent(token)}` : path,
        );
        return;
      }
      navigate(path);
    },
    [navigate],
  );
}
