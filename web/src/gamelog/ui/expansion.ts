import { createContext, useContext } from "react";
import type { GameEvent } from "../types";

export type LogExpansion = {
  isOpen: (eventId: string) => boolean;
  toggle: (eventId: string) => void;
  /** Events folded under this one (`parentId`), oldest first. */
  childrenOf: (eventId: string) => readonly GameEvent[];
  /** The event to highlight briefly (just revealed from the ticker). */
  flashId?: string;
};

/** Which rows of the full log are expanded; rows outside a provider (the ticker) keep their own state. */
export const LogExpansionContext = createContext<LogExpansion | null>(null);

export const useLogExpansion = () => useContext(LogExpansionContext);
