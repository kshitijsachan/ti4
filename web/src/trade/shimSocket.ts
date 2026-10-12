import type { PressButton } from "./types";

type Frame = { t: string; nonce?: string; error?: string };

/**
 * Fallback button presser for when the host app doesn't pass `onPress`: a lazily opened `/app/ws` connection
 * for the seat token that only sends `click` ops and waits for `interaction_done`.
 */
export function createSocketPresser(token: string): {
  press: PressButton;
  close: () => void;
} {
  let ws: WebSocket | null = null;
  let ready: Promise<WebSocket> | null = null;
  let seq = 0;
  const waiters = new Map<string, (f: Frame) => void>();

  const open = () => {
    if (ready) return ready;
    ready = new Promise<WebSocket>((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const sock = new WebSocket(
        `${proto}://${location.host}/app/ws?token=${encodeURIComponent(token)}`,
      );
      ws = sock;
      sock.addEventListener("error", () => reject(new Error("Connection to the table failed")));
      sock.addEventListener("close", () => {
        ready = null;
        ws = null;
      });
      sock.addEventListener("message", (ev) => {
        const f = JSON.parse(String(ev.data)) as Frame;
        if (f.t === "hello") resolve(sock);
        if (f.t !== "interaction_done" || !f.nonce) return;
        waiters.get(f.nonce)?.(f);
        waiters.delete(f.nonce);
      });
    });
    return ready;
  };

  const press: PressButton = async (channelId, messageId, customId) => {
    const sock = await open();
    const nonce = `trade-${++seq}`;
    sock.send(
      JSON.stringify({ op: "click", channel_id: channelId, message_id: messageId, custom_id: customId, nonce }),
    );
    return new Promise<{ error?: string }>((resolve) => {
      const timer = window.setTimeout(() => {
        waiters.delete(nonce);
        resolve({ error: "The bot didn't answer in time" });
      }, 20000);
      waiters.set(nonce, (f) => {
        window.clearTimeout(timer);
        resolve({ error: f.error });
      });
    });
  };

  return { press, close: () => ws?.close() };
}
