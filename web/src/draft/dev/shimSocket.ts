/** Minimal player connection to the shim's browser protocol (`/app/ws`), enough to press buttons. */
export type ShimHello = {
  me: { id: string; global_name?: string; username?: string };
};

type Waiter = (frame: { t: string; error?: string }) => void;

export class ShimSocket {
  private ws: WebSocket;
  private nonce = 0;
  private waiters = new Map<string, Waiter>();
  readonly hello: Promise<ShimHello>;
  onFrame?: (frame: { t: string; [k: string]: unknown }) => void;

  constructor(token: string) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(
      `${proto}://${location.host}/app/ws?token=${encodeURIComponent(token)}`,
    );
    this.hello = new Promise((resolve, reject) => {
      this.ws.addEventListener("error", () =>
        reject(new Error("socket error")),
      );
      this.ws.addEventListener("message", (ev) => {
        const f = JSON.parse(String(ev.data)) as { t: string; nonce?: string; error?: string; [k: string]: unknown };
        if (f.t === "hello") resolve(f as unknown as ShimHello);
        this.onFrame?.(f);
        if (
          f.t === "interaction_done" &&
          f.nonce &&
          this.waiters.has(f.nonce)
        ) {
          this.waiters.get(f.nonce)!(f);
          this.waiters.delete(f.nonce);
        }
      });
    });
  }

  /** Clicks a button; resolves when the bot acknowledged the interaction. */
  click(
    channelId: string,
    messageId: string,
    customId: string,
  ): Promise<{ error?: string }> {
    const nonce = `draft-${++this.nonce}`;
    this.ws.send(
      JSON.stringify({
        op: "click",
        channel_id: channelId,
        message_id: messageId,
        custom_id: customId,
        nonce,
      }),
    );
    return new Promise((resolve) => {
      const timer = window.setTimeout(
        () => resolve({ error: "The bot didn't answer in time" }),
        20000,
      );
      this.waiters.set(nonce, (f) => {
        window.clearTimeout(timer);
        resolve({ error: f.error });
      });
    });
  }

  close() {
    this.ws.close();
  }
}
