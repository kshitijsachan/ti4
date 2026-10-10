import { create } from "zustand";
import { usePlayConnection } from "@/discord";
import { usePressButton } from "@/play/usePressButton";

/** One bot button to press. */
export type Press = { channelId: string; messageId: string; customId: string; label: string };

type RunnerState = {
  /** Key of the flow being run (one at a time). */
  running: string | null;
  step: number;
  total: number;
  label: string;
  error: string | null;
  set: (s: Partial<RunnerState>) => void;
};

/**
 * Flows that press several bot buttons in a row ("replenish these 2 players, then done") live here rather than in
 * the component: the popup remounts as each press retires a prompt, and the run must carry on regardless.
 */
export const useRunner = create<RunnerState>((set) => ({
  running: null,
  step: 0,
  total: 0,
  label: "",
  error: null,
  set: (s) => set(s),
}));

/** Runs presses in order, each after the bot acknowledged the previous one; then `after`. */
export function useRunSequence() {
  const press = usePressButton();
  const conn = usePlayConnection();
  return async (key: string, presses: Press[], after?: (dismiss: (id: string) => void) => void) => {
    const runner = useRunner.getState();
    if (runner.running) return;
    runner.set({ running: key, step: 0, total: presses.length, label: "", error: null });
    for (const [i, p] of presses.entries()) {
      useRunner.getState().set({ step: i + 1, label: p.label });
      const result = await press(p.channelId, p.messageId, p.customId);
      if (result.error) {
        useRunner.getState().set({ running: null, error: result.error });
        return;
      }
    }
    after?.((id) => conn.actions.dismissPrompt(id));
    useRunner.getState().set({ running: null, step: 0, total: 0, label: "" });
  };
}
