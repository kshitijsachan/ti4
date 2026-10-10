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
  startedAt: number;
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
  startedAt: 0,
  set: (s) => set(s),
}));

type Conn = ReturnType<typeof usePlayConnection>;

/** The message's last edit (or "gone"), to tell when the bot has finished with a press. */
function stamp(conn: Conn, p: Press) {
  const m = conn.store.getState().messages[p.channelId]?.byId[p.messageId];
  return m ? (m.edited_timestamp ?? m.timestamp) : "gone";
}

/**
 * The bot acknowledges a press before it has applied it; a second press on the heels of the first can race it and
 * one change gets lost (seen: the last "Gain 1 Strategy Token" vanished). Wait until the bot edited or deleted the
 * message, or a short while.
 */
function settled(conn: Conn, p: Press, before: string) {
  return new Promise<void>((resolve) => {
    const done = () => {
      unsubscribe();
      clearTimeout(timer);
      setTimeout(resolve, 150);
    };
    const check = () => {
      if (stamp(conn, p) !== before) done();
    };
    const unsubscribe = conn.store.subscribe(check);
    const timer = setTimeout(done, 4000);
    check();
  });
}

/** Runs presses in order, each after the bot acknowledged the previous one; then `after`. */
export function useRunSequence() {
  const press = usePressButton();
  const conn = usePlayConnection();
  return async (key: string, presses: Press[], after?: (dismiss: (id: string) => void) => void) => {
    const runner = useRunner.getState();
    /* A run whose promise was lost (socket swap, hot reload) must not block the panels for good. */
    if (runner.running && Date.now() - runner.startedAt < 60_000) {
      runner.set({ error: `Still pressing “${runner.label}” — try again in a moment.` });
      return;
    }
    runner.set({ running: key, step: 0, total: presses.length, label: "", error: null, startedAt: Date.now() });
    for (const [i, p] of presses.entries()) {
      useRunner.getState().set({ step: i + 1, label: p.label });
      const before = stamp(conn, p);
      console.info("[strategy] press", p.customId, "on", p.messageId);
      const result = await press(p.channelId, p.messageId, p.customId);
      if (!result.error && i < presses.length - 1) await settled(conn, p, before);
      if (result.error) {
        useRunner.getState().set({ running: null, error: result.error });
        return;
      }
    }
    after?.((id) => conn.actions.dismissPrompt(id));
    useRunner.getState().set({ running: null, step: 0, total: 0, label: "" });
  };
}
