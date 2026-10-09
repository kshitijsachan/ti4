import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** The bot links games to upstream's site: asyncti4.com/game/<name>[/newui...]. */
const UPSTREAM_GAME_LINK =
  /^https?:\/\/(?:www\.)?asyncti4\.com\/game\/([A-Za-z0-9_-]+)/i;

/** Maps a bot-posted URL onto this site, or null when it points elsewhere. */
export function localGamePath(href: string): string | null {
  const match = UPSTREAM_GAME_LINK.exec(href);
  return match ? `/game/${match[1]}` : null;
}

/**
 * Turns links to upstream's game pages (in messages, embeds and link buttons)
 * into in-app navigation. Done once at the document level so every renderer
 * is covered without each one knowing about it.
 */
export function useGameLinkInterception() {
  const navigate = useNavigate();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      const path = localGamePath(anchor.getAttribute("href") ?? "");
      if (!path) return;
      event.preventDefault();
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        window.open(path, "_blank", "noopener");
        return;
      }
      navigate(path);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigate]);
}
