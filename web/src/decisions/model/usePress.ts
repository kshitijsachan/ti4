import { useState } from "react";
import { usePlayConnection } from "@/discord";
import { usePressButton, type PressResult } from "@/play/usePressButton";
import type { Decision } from "./classify";
import type { Choice } from "./controls";

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

  const press = async (d: Decision, choice: Choice, values?: string[]) => {
    if (!choice.customId || state.pendingKey) return;
    setState({ held: d, pendingKey: choice.key, error: null });
    const result = values
      ? await selectAndWait(d, choice, values)
      : await pressButton(d.prompt.channelId, d.id, choice.customId);
    if (result.error) {
      setState({ held: d, pendingKey: null, error: result.error });
      return;
    }
    setState({ held: null, pendingKey: null, error: null });
  };

  const release = () => setState({ held: null, pendingKey: null, error: null });

  return { ...state, press, release };
}
