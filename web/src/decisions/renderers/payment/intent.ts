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

export const usePaymentIntent = create<IntentState>((set) => ({
  build: null,
  setBuild: (build) => set({ build }),
}));

/** A build intent still worth applying to a payment prompt (the bot posts it within seconds). */
export function freshBuild(b: BuildIntent | null) {
  return b && Date.now() - b.at < 5 * 60_000 ? b : null;
}
