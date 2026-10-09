import { GameLogFull, type LogView } from "./ui/GameLogFull";
import { GameLogTicker } from "./ui/GameLogTicker";

export type GameLogProps = {
  gameName: string;
  /** `ticker`: the latest 1–3 events for the top bar. `full`: the drawer history with grouping, filters and search. */
  variant: "ticker" | "full";
  className?: string;
  /** Ticker only: how many events (1–3, default 3). */
  max?: number;
  /** Ticker only: show a "Log" button that calls this (e.g. to open the drawer). */
  onOpen?: () => void;
  /** Full only: initial grouping. */
  defaultView?: LogView;
};

/** The game's history as clean one-line events (not chat). Must sit inside `<PlayProvider>`. */
export function GameLog({ gameName, variant, className, max, onOpen, defaultView }: GameLogProps) {
  if (variant === "ticker") return <GameLogTicker gameName={gameName} className={className} max={max} onOpen={onOpen} />;
  return <GameLogFull gameName={gameName} className={className} defaultView={defaultView} />;
}
