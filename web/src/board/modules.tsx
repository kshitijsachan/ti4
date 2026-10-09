import type { ComponentType } from "react";

/*
 * The decisions, hand and log modules are built alongside the board. They are
 * picked up from their directories at build time, so the board ships (with
 * fallbacks) whether or not each one has landed yet.
 */
type Exports = Record<string, unknown>;

const decisions = import.meta.glob<Exports>(
  ["../decisions/*.{ts,tsx}", "!../decisions/*.test.*"],
  { eager: true },
);
const hand = import.meta.glob<Exports>(
  ["../hand/*.{ts,tsx}", "!../hand/*.test.*"],
  { eager: true },
);
const gamelog = import.meta.glob<Exports>(
  ["../gamelog/*.{ts,tsx}", "!../gamelog/*.test.*"],
  { eager: true },
);

/** The named export from a module directory, preferring its index file. */
function pick<T>(mods: Record<string, Exports>, name: string): T | undefined {
  const entries = Object.entries(mods).sort(([a], [b]) => {
    const ai = /\/index\.tsx?$/.test(a) ? 0 : 1;
    const bi = /\/index\.tsx?$/.test(b) ? 0 : 1;
    return ai - bi;
  });
  for (const [, mod] of entries) {
    if (mod[name] !== undefined) return mod[name] as T;
  }
  return undefined;
}

export type DecisionHostProps = {
  gameName: string;
  placement?: "fixed" | "contained";
  className?: string;
};
export type HandTrayProps = { gameName: string };
export type GameLogProps = {
  gameName: string;
  variant: "ticker" | "full";
  className?: string;
  max?: number;
  onOpen?: () => void;
};

/** A zustand hook: callable for a slice, with getState/subscribe on it. */
export type FocusStore = {
  getState: () => unknown;
  subscribe: (listener: (state: unknown) => void) => () => void;
};

export const DecisionHostModule = pick<ComponentType<DecisionHostProps>>(
  decisions,
  "DecisionHost",
);
export const HandTrayModule = pick<ComponentType<HandTrayProps>>(
  hand,
  "HandTray",
);
export const GameLogModule = pick<ComponentType<GameLogProps>>(
  gamelog,
  "GameLog",
);
export const decisionFocusStore = pick<FocusStore>(
  decisions,
  "useDecisionFocus",
);
export const logFocusStore = pick<FocusStore>(gamelog, "useLogFocus");
