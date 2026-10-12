import { create } from "zustand";

export type DecisionFocusState = {
  /** Ring position of the system the current decision is about ("301"), for the map to highlight. */
  position: string | null;
  /** Why: the open prompt names this system, or the player is hovering a system choice. */
  source: "prompt" | "hover" | null;
  /** Short caption for the highlight ("Activate", "Combat"). */
  label: string | null;
  /** Bumps on every change so re-focusing the same system still pans. */
  key: number;
  set: (position: string | null, source: DecisionFocusState["source"], label?: string | null) => void;
};

/**
 * The system the decision popup wants the table to look at. The board reads `position` (getState /
 * subscribe or as a hook); `null` means nothing to highlight.
 */
export const useDecisionFocus = create<DecisionFocusState>((set, get) => ({
  position: null,
  source: null,
  label: null,
  key: 0,
  set: (position, source, label = null) => {
    const cur = get();
    if (cur.position === position && cur.source === source && cur.label === label) return;
    set({ position, source: position ? source : null, label: position ? label : null, key: cur.key + 1 });
  },
}));

type WaitingOnMe = {
  /** Required decisions waiting on me right now, in any phase. */
  count: number;
  /** Title of the first one ("Choose a flavor of Keleres"), for the header's tooltip. */
  title: string | null;
  set: (count: number, title: string | null) => void;
};

/** What the decision popup holds for me, for the header's "Your move" pill (setup and agenda included). */
export const useWaitingOnMe = create<WaitingOnMe>((set, get) => ({
  count: 0,
  title: null,
  set: (count, title) => {
    const cur = get();
    if (cur.count === count && cur.title === title) return;
    set({ count, title });
  },
}));

export type TradeRequest = {
  /** Bumps per request. */
  key: number;
  /** Faction (lower case) of the player whose offer is being countered, when known. */
  faction?: string;
  /** Display name of that player, when known. */
  playerName?: string;
};

type DecisionRequests = {
  openTrade: TradeRequest | null;
  requestTrade: (req: Omit<TradeRequest, "key">) => void;
};

/** Window event fired alongside `useDecisionRequests.openTrade`, for listeners outside React. */
export const OPEN_TRADE_EVENT = "ti4:decisions:open-trade";

/**
 * Requests the decision popup makes of the page around it. "Counter" on a trade offer sets `openTrade`
 * (and fires {@link OPEN_TRADE_EVENT}); the layout opens its trade drawer in response.
 */
export const useDecisionRequests = create<DecisionRequests>((set, get) => ({
  openTrade: null,
  requestTrade: (req) => {
    const next = { ...req, key: (get().openTrade?.key ?? 0) + 1 };
    set({ openTrade: next });
    window.dispatchEvent(new CustomEvent<TradeRequest>(OPEN_TRADE_EVENT, { detail: next }));
  },
}));
