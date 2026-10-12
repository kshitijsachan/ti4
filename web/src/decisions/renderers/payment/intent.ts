import { create } from "zustand";

/** What the production panel just built, so the payment that follows can say what it pays for and keep my toggles. */
export type BuildIntent = {
  at: number;
  /** "2 fighters, 1 carrier" */
  units: string;
  /** "307" or a system name */
  where: string;
  cost: number;
  sarween: boolean;
};

type IntentState = {
  build: BuildIntent | null;
  setBuild: (b: BuildIntent | null) => void;
};

const KEY = "ti4.payment.build";

function stored(): BuildIntent | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null") as BuildIntent | null;
  } catch {
    return null;
  }
}

/** Kept in session storage too, so a reload between Build and Pay keeps what was built and the toggles. */
export const usePaymentIntent = create<IntentState>((set) => ({
  build: stored(),
  setBuild: (build) => {
    try {
      if (build) sessionStorage.setItem(KEY, JSON.stringify(build));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage blocked: memory only */
    }
    set({ build });
  },
}));

/** My toggles and picks on one payment prompt, kept per message so a reload shows them as I left them. */
export type PaySelection = { discounts: string[]; planets?: string[]; tg?: number; comm?: number; cost?: number };

const SELECTION_KEY = "ti4.payment.selection";

function selections(): Record<string, PaySelection> {
  try {
    return JSON.parse(sessionStorage.getItem(SELECTION_KEY) ?? "{}") as Record<string, PaySelection>;
  } catch {
    return {};
  }
}

export function readPaySelection(messageId: string): PaySelection | undefined {
  return selections()[messageId];
}

export function writePaySelection(messageId: string, sel: PaySelection) {
  try {
    const all = { ...selections(), [messageId]: sel };
    const keep = Object.keys(all).slice(-20);
    sessionStorage.setItem(SELECTION_KEY, JSON.stringify(Object.fromEntries(keep.map((k) => [k, all[k]]))));
  } catch {
    /* storage blocked: memory only */
  }
}

/** A build intent still worth applying to a payment prompt (the bot posts it within seconds). */
export function freshBuild(b: BuildIntent | null) {
  return b && Date.now() - b.at < 5 * 60_000 ? b : null;
}
