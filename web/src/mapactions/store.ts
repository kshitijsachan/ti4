import { create } from "zustand";
import type { LandingPlan } from "./landing";
import type { MovePlan } from "./movement";

export type MapActionStep = "activate" | "move" | "land" | "pick" | null;

type MapActionsState = {
  /** The map's own UI is driving the current tactical step (the decision popup should step aside). */
  active: boolean;
  step: MapActionStep;
  /** The bot prompt the map UI is answering. */
  promptId: string | null;
  /** Prompts the player chose to answer with the popup's buttons instead. */
  handedBack: Record<string, true>;
  /** A system someone asked the map to activate (`activateSystem`), confirmed on the board. */
  requested: string | null;
  plan: MovePlan;
  landing: LandingPlan;
  /** A confirm chip or the unit picker is open: the map's hover cards should not cover it. */
  interacting: boolean;
  setInteracting: (on: boolean) => void;
  setPresence: (
    active: boolean,
    step: MapActionStep,
    promptId: string | null,
  ) => void;
  handBack: (promptId: string) => void;
  takeOver: (promptId: string) => void;
  request: (position: string | null) => void;
  setPlan: (update: (plan: MovePlan) => MovePlan) => void;
  setLanding: (update: (plan: LandingPlan) => LandingPlan) => void;
  resetPlans: () => void;
};

export const useMapActions = create<MapActionsState>((set) => ({
  active: false,
  step: null,
  promptId: null,
  handedBack: {},
  requested: null,
  plan: {},
  landing: {},
  interacting: false,
  setInteracting: (interacting) =>
    set((s) => (s.interacting === interacting ? s : { interacting })),
  setPresence: (active, step, promptId) =>
    set((s) =>
      s.active === active && s.step === step && s.promptId === promptId
        ? s
        : { active, step, promptId },
    ),
  handBack: (promptId) =>
    set((s) => ({ handedBack: { ...s.handedBack, [promptId]: true } })),
  takeOver: (promptId) =>
    set((s) => {
      const rest = { ...s.handedBack };
      delete rest[promptId];
      return { handedBack: rest };
    }),
  request: (requested) => set({ requested }),
  setPlan: (update) => set((s) => ({ plan: update(s.plan) })),
  setLanding: (update) => set((s) => ({ landing: update(s.landing) })),
  resetPlans: () => set({ plan: {}, landing: {} }),
}));

/**
 * For the decision popup: whether the map's movement / landing UI owns the current tactical step. While `active`,
 * the popup should not show the bot's move or land buttons for `promptId` (the map answers that prompt).
 */
export function useMovementUI() {
  const active = useMapActions(
    (s) => s.active && (s.step === "move" || s.step === "land"),
  );
  const step = useMapActions((s) => s.step);
  const promptId = useMapActions((s) => s.promptId);
  return {
    active,
    step: active ? step : null,
    promptId: active ? promptId : null,
  };
}

/** Asks the board to activate `position` (the player still confirms on the map). */
export function activateSystem(position: string) {
  useMapActions.getState().request(position);
}
