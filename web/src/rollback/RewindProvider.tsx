import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { buildRewindIndex, type RewindIndex, type RowRewind } from "./lineage";
import { RewindDialog, type RewindRequest } from "./RewindDialog";
import { useUndoPoints, useUndoStore } from "./useUndoPoints";
import type { UndoPoint } from "./types";

type EventLike = { id: string; time: string };

type Ctx = {
  index: RewindIndex;
  ask: (eventLabel: string, point: UndoPoint) => void;
};

const RewindContext = createContext<Ctx | null>(null);

const EMPTY: RewindIndex = { rows: new Map(), livePoints: [] };

/** Classifies `events` against the game's undo saves: undone, rewindable (to which save), current, too old. */
export function useRewindIndex(gameName: string, events: readonly EventLike[]): RewindIndex {
  const { data } = useUndoPoints(gameName);
  return useMemo(() => (data ? buildRewindIndex(events, data.points, data.rewinds) : EMPTY), [data, events]);
}

type ProviderProps = { gameName: string; events: readonly EventLike[]; children: ReactNode };

/** Gives log rows their rewind state (`useRewindRow`) and hosts the confirmation dialog. */
export function RewindProvider({ gameName, events, children }: ProviderProps) {
  const index = useRewindIndex(gameName, events);
  const rewind = useUndoStore((s) => s.rewind);
  const [request, setRequest] = useState<RewindRequest | null>(null);

  const ask = useCallback(
    (eventLabel: string, point: UndoPoint) => {
      const undoCount = index.livePoints.filter((p) => p.savedAt > point.savedAt).length;
      const before = [...index.livePoints].reverse().find((p) => p.savedAt < point.savedAt);
      setRequest({ eventLabel, point, undoCount, before });
    },
    [index],
  );
  const ctx = useMemo(() => ({ index, ask }), [index, ask]);

  return (
    <RewindContext.Provider value={ctx}>
      {children}
      <RewindDialog request={request} onCancel={() => setRequest(null)} onConfirm={(p) => rewind(gameName, p.index)} />
    </RewindContext.Provider>
  );
}

export type RewindRow = RowRewind & {
  /** Opens the confirmation dialog (only for `live` rows). */
  ask?: (eventLabel: string) => void;
};

/** This event's rewind state, or null outside a `<RewindProvider>` / before the saves have loaded. */
export function useRewindRow(eventId: string): RewindRow | null {
  const ctx = useContext(RewindContext);
  const row = ctx?.index.rows.get(eventId);
  if (!ctx || !row) return null;
  if (row.status !== "live") return row;
  return { ...row, ask: (label: string) => ctx.ask(label, row.point) };
}
