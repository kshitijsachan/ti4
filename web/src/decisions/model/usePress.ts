import { useEffect, useState } from "react";
import { usePlayConnection } from "@/discord";
import { usePressButton, type PressResult } from "@/play/usePressButton";
import type { Decision } from "./classify";
import { baseId, type Choice } from "./controls";

const TIMEOUT_MS = 20000;

export type PressState = {
  /** The decision being answered, kept on screen until the bot acknowledges (the store drops it at once). */
  held: Decision | null;
  /** Key of the choice whose press is in flight. */
  pendingKey: string | null;
  error: string | null;
};

/**
 * Presses a decision's buttons and selects. The play store marks a prompt answered the moment it is pressed,
 * so the decision is held here (spinner, then error if the bot refuses) until the bot settles the press.
 */
export function useDecisionPress() {
  const pressButton = usePressButton();
  const conn = usePlayConnection();
  const [state, setState] = useState<PressState>({ held: null, pendingKey: null, error: null });

  const selectAndWait = (d: Decision, choice: Choice, values: string[]) =>
    new Promise<PressResult>((resolve) => {
      const { channelId } = d.prompt;
      const nonce = conn.select(channelId, d.id, choice.customId ?? "", values, choice.component.type);
      if (!nonce) {
        resolve({ error: "Not connected to the game server." });
        return;
      }
      const check = () => {
        const results = conn.store.getState().results;
        if (!(nonce in results)) return;
        unsubscribe();
        clearTimeout(timer);
        const error = results[nonce];
        resolve(error ? { error } : {});
      };
      const unsubscribe = conn.store.subscribe(check);
      const timer = setTimeout(() => {
        unsubscribe();
        resolve({});
      }, TIMEOUT_MS);
      check();
    });

  /** Presses `choice` of `target` (a step of `shown`, or `shown` itself), keeping `shown` on screen meanwhile. */
  const press = async (shown: Decision, target: Decision, choice: Choice, values?: string[]) => {
    if (!choice.customId || state.pendingKey) return;
    setState({ held: shown, pendingKey: choice.key, error: null });
    const before = conn.store.getState().pressed[target.id];
    const result = values
      ? await selectAndWait(target, choice, values)
      : await pressButton(target.prompt.channelId, target.id, choice.customId);
    /* "Dismiss" / "Delete these buttons": gone for good on this message, whatever the bot does with it. */
    if (/^deleteButtons$/.test(baseId(choice.customId)) || /^(dismiss|delete these buttons)/i.test(choice.label)) conn.actions.dismissPrompt(target.id);
    if (result.error) {
      /* The press did not go through: the prompt is still unanswered, so keep it in the queue. */
      const { pressed } = conn.store.getState();
      const restored = { ...pressed };
      if (before === undefined) delete restored[target.id];
      else restored[target.id] = before;
      conn.store.setState({ pressed: restored });
      setState({ held: shown, pendingKey: null, error: result.error });
      return;
    }
    setState({ held: null, pendingKey: null, error: null });
  };

  const release = () => setState({ held: null, pendingKey: null, error: null });

  /* Never leave the popup stuck on a spinner if a press's promise is lost (socket swap, hot reload). */
  const stuck = state.pendingKey;
  useEffect(() => {
    if (!stuck) return;
    const timer = setTimeout(() => setState((s) => (s.pendingKey === stuck ? { held: null, pendingKey: null, error: null } : s)), TIMEOUT_MS + 5000);
    return () => clearTimeout(timer);
  }, [stuck]);

  return { ...state, press, release };
}
