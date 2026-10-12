import { useCallback, useEffect, useRef, useState } from "react";
import type { CardGroup, HandCard } from "./model";

const SHOW_MS = 8_000;
/** The tray keeps marking arrivals a while longer, for a player who opens it after the notice is gone. */
const MARK_MS = 30_000;

/** How many of each card the hand holds (scored secrets and notes in play are not "held"). */
function heldCounts(groups: CardGroup[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const card of groups.flatMap((g) => g.cards)) {
    if (card.scored || card.inPlayArea) continue;
    out.set(card.key, (out.get(card.key) ?? 0) + (card.count ?? 1));
  }
  return out;
}

export type NewCards = {
  /** Cards that just arrived, newest draw first; empty when nothing to show. */
  fresh: HandCard[];
  /** Keys of cards still highlighted as new in the tray (a while longer than the notice). */
  newKeys: Set<string>;
  dismiss: () => void;
};

/**
 * Cards that arrived since the last hand snapshot (drawn, dealt, received in a trade), from the hand data
 * itself, so silent draws (Politics, status phase) show too. The first complete snapshot only sets the
 * baseline: a page load or reconnect never announces anything.
 */
export function useNewCards(groups: CardGroup[], ready: boolean): NewCards {
  const baseline = useRef<Map<string, number> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const markTimer = useRef<number | undefined>(undefined);
  const [fresh, setFresh] = useState<HandCard[]>([]);
  const [marked, setMarked] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!ready) return;
    const now = heldCounts(groups);
    const before = baseline.current;
    baseline.current = now;
    if (!before) return;
    const arrived = groups
      .flatMap((g) => g.cards)
      .filter((c) => !c.scored && !c.inPlayArea && (now.get(c.key) ?? 0) > (before.get(c.key) ?? 0));
    if (!arrived.length) return;
    setFresh((prev) => {
      const keys = new Set(arrived.map((c) => c.key));
      // Keep earlier arrivals that are still in hand; a second draw adds to the same notice.
      return [...arrived, ...prev.filter((c) => !keys.has(c.key) && now.has(c.key))];
    });
    setMarked((prev) => new Set([...prev, ...arrived.map((c) => c.key)]));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFresh([]), SHOW_MS);
    window.clearTimeout(markTimer.current);
    markTimer.current = window.setTimeout(() => setMarked(new Set()), MARK_MS);
  }, [groups, ready]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(markTimer.current);
    },
    [],
  );

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setFresh([]);
  }, []);

  return { fresh, newKeys: marked, dismiss };
}
