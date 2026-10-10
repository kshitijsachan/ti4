import { usePlayConnection } from "@/discord";
import type { Message } from "@/discord";
import { usePressButton } from "@/play/usePressButton";
import { choicesOf, type Choice } from "../../model/controls";
import { useRunner } from "../strategy/runner";

type Conn = ReturnType<typeof usePlayConnection>;
type State = ReturnType<Conn["store"]["getState"]>;

/** Where a step presses: found when the step runs, against the store as it is then. */
export type Target = { channelId: string; messageId: string; customId: string };

/**
 * One press of a live run. `find` runs just before the press, so a step can follow what earlier presses did: a trade
 * good button the bot removed once fewer trade goods were left, a prompt the bot posted mid-run. `null` skips it.
 */
export type LiveStep = { label: string; find: (state: State) => Target | null; optional?: boolean; waitMs?: number };

/** The message's last edit (or "gone"), to tell when the bot has finished with a press. */
function stamp(state: State, t: Target) {
  const m = state.messages[t.channelId]?.byId[t.messageId];
  return m ? (m.edited_timestamp ?? m.timestamp) : "gone";
}

function settled(conn: Conn, t: Target, before: string) {
  return new Promise<void>((resolve) => {
    const done = () => {
      unsubscribe();
      clearTimeout(timer);
      setTimeout(resolve, 150);
    };
    const check = () => {
      if (stamp(conn.store.getState(), t) !== before) done();
    };
    const unsubscribe = conn.store.subscribe(check);
    const timer = setTimeout(done, 4000);
    check();
  });
}

/** Waits up to `ms` for `find` to return a target (a prompt the bot is about to post). */
function waitFor(conn: Conn, step: LiveStep, ms: number) {
  return new Promise<Target | null>((resolve) => {
    const check = () => {
      const t = step.find(conn.store.getState());
      if (!t) return;
      finish(t);
    };
    const finish = (t: Target | null) => {
      unsubscribe();
      clearTimeout(timer);
      resolve(t);
    };
    const unsubscribe = conn.store.subscribe(check);
    const timer = setTimeout(() => finish(null), ms);
    check();
  });
}

/** A message's button whose id (without the faction lock) matches. */
export function buttonOn(m: Message | undefined, test: (c: Choice) => boolean): Choice | undefined {
  if (!m) return undefined;
  return choicesOf(m).find((c) => !c.disabled && !!c.customId && test(c));
}

export function messageOf(state: State, channelId: string, messageId: string) {
  return state.messages[channelId]?.byId[messageId];
}

/** The step that presses a button of one known message, picked by `test` at press time. */
export function pressOn(channelId: string, messageId: string, label: string, test: (c: Choice) => boolean): LiveStep {
  return {
    label,
    find: (s) => {
      const c = buttonOn(messageOf(s, channelId, messageId), test);
      return c?.customId ? { channelId, messageId, customId: c.customId } : null;
    },
  };
}

/**
 * Like the strategy runner, but each press is looked up when it runs (see `LiveStep`). Shares its progress store, so
 * one multi-press flow runs at a time across the decision panels.
 */
export function useLiveSequence() {
  const press = usePressButton();
  const conn = usePlayConnection();
  return async (key: string, steps: LiveStep[], after?: () => void) => {
    const runner = useRunner.getState();
    if (runner.running && Date.now() - runner.startedAt < 60_000) {
      runner.set({ error: `Still pressing “${runner.label}” — try again in a moment.` });
      return false;
    }
    runner.set({ running: key, step: 0, total: steps.length, label: "", error: null, startedAt: Date.now() });
    for (const [i, step] of steps.entries()) {
      useRunner.getState().set({ step: i + 1, label: step.label });
      const target = step.waitMs ? await waitFor(conn, step, step.waitMs) : step.find(conn.store.getState());
      if (!target) {
        if (step.optional) continue;
        console.info("[payment] skipped", step.label);
        continue;
      }
      const before = stamp(conn.store.getState(), target);
      console.info("[payment] press", target.customId, "on", target.messageId);
      const result = await press(target.channelId, target.messageId, target.customId);
      if (result.error) {
        useRunner.getState().set({ running: null, error: result.error });
        return false;
      }
      if (i < steps.length - 1) await settled(conn, target, before);
    }
    after?.();
    useRunner.getState().set({ running: null, step: 0, total: 0, label: "" });
    return true;
  };
}
