import { GameLogFull, type LogView } from "./ui/GameLogFull";
import { GameLogTicker } from "./ui/GameLogTicker";

export type GameLogProps = {
  gameName: string;
  /** `ticker`: the latest 1–3 events for the top bar. `full`: the drawer history with grouping, filters and search. */
  variant: "ticker" | "full";
  className?: string;
  /** Ticker only: how many events (1–3, default 3). */
  max?: number;
  /**
   * Ticker only: open the full log (a "Log" button; in transient mode, clicking the event). Gets the clicked
   * event's id; the full log scrolls to that event and expands it on its own (via `useLogReveal`).
   */
  onOpen?: (eventId?: string) => void;
  /** Ticker only: show just the newest event, and only for a few seconds after it happens. */
  transient?: boolean;
  /** Full only: initial grouping. */
  defaultView?: LogView;
};

/** The game's history as clean one-line events (not chat). Must sit inside `<PlayProvider>`. */
export function GameLog({ gameName, variant, className, max, onOpen, transient, defaultView }: GameLogProps) {
  if (variant === "ticker")
    return (
      <GameLogTicker gameName={gameName} className={className} max={max} onOpen={onOpen} transient={transient} />
    );
  return <GameLogFull gameName={gameName} className={className} defaultView={defaultView} />;
}
