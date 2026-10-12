import { usePlayConnection } from "@/discord";

const TIMEOUT_MS = 20000;

export type PressResult = { error?: string };

/**
 * Presses a bot button over the shared play connection and settles when the
 * bot acknowledges it (`interaction_done`), for views (draft, trade) that
 * drive the bot's own buttons from their own UI.
 */
export function usePressButton() {
  const connection = usePlayConnection();

  return (channelId: string, messageId: string, customId: string) =>
    new Promise<PressResult>((resolve) => {
      const nonce = connection.click(channelId, messageId, customId);
      if (!nonce) {
        resolve({ error: "Not connected to the game server." });
        return;
      }
      const settle = (result: PressResult) => {
        unsubscribe();
        clearTimeout(timer);
        resolve(result);
      };
      const check = () => {
        const results = connection.store.getState().results;
        if (!(nonce in results)) return;
        const error = results[nonce];
        settle(error ? { error } : {});
      };
      const unsubscribe = connection.store.subscribe(check);
      const timer = setTimeout(() => settle({}), TIMEOUT_MS);
      check();
    });
}
