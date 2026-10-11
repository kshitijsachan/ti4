import type {
  ClientOp,
  CommandOptionChoice,
  InteractionOption,
  ModalSubmitComponent,
  ServerFrame,
  Snowflake,
} from "../types";
import type { EngineFrame, EngineHello, EngineOp } from "@/engine/protocol";
import { createPlayStore, EMPTY_CHANNEL, type PlayActions } from "./store";

export type ConnectOptions = {
  /** Seat token from the player's `/play?t=` link. */
  token: string;
  /**
   * WebSocket endpoint. Defaults to `/app/ws` on the page's own origin (the shim serves the app, or the
   * Vite dev proxy forwards it). Pass an absolute `ws://host:8090/app/ws` to bypass the proxy.
   */
  url?: string;
};

const PAGE_SIZE = 100;
const BACKOFF_MS = [300, 1000, 2000, 4000, 8000, 15000];
const PING_MS = 25000;

let nonceSeq = 0;
const newNonce = () => `${Date.now().toString(36)}-${(nonceSeq++).toString(36)}`;

/** Resolve a websocket URL relative to the page, appending the seat token. */
function socketUrl(opts: ConnectOptions): string {
  const base = opts.url ?? "/app/ws";
  const abs = /^wss?:\/\//.test(base)
    ? new URL(base)
    : new URL(base, window.location.href.replace(/^http/, "ws"));
  abs.searchParams.set("token", opts.token);
  return abs.toString();
}

/**
 * One player's realtime link to the shim. Owns the socket, reconnection, nonce bookkeeping and history
 * paging; all state lands in the zustand store it creates.
 */
export class PlayConnection {
  readonly actions: PlayActions;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: number | undefined;
  private pingTimer: number | undefined;
  private historyInFlight = new Map<Snowflake, string>();
  private autocompleteWaiters = new Map<string, (choices: CommandOptionChoice[]) => void>();
  /** nonce → channel the action came from, so a modal it opens knows its origin. */
  private nonceChannel = new Map<string, Snowflake>();
  private hadHello = false;
  private engineListeners = new Set<(frame: EngineFrame) => void>();
  private helloListeners = new Set<() => void>();
  /** The engine fields of the latest hello (null before the first, or from a shim without the engine). */
  engineInfo: EngineHello | null = null;

  constructor(private opts: ConnectOptions) {
    this.actions = createPlayStore(opts.token.slice(0, 8));
  }

  get store() {
    return this.actions.store;
  }

  connect() {
    this.closedByUser = false;
    this.open();
  }

  close() {
    this.closedByUser = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.actions.setStatus("closed");
  }

  private open() {
    this.actions.setStatus(this.hadHello ? "reconnecting" : "connecting");
    const ws = new WebSocket(socketUrl(this.opts));
    this.ws = ws;
    ws.onmessage = (ev: MessageEvent<string>) => this.onFrame(ev.data);
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => ws.close();
  }

  private onClose(ws: WebSocket) {
    if (this.ws !== ws) return;
    window.clearInterval(this.pingTimer);
    this.ws = null;
    this.historyInFlight.clear();
    for (const [nonce, cb] of this.autocompleteWaiters) {
      cb([]);
      this.autocompleteWaiters.delete(nonce);
    }
    this.actions.failAllPending("Connection lost before the game server answered. Check the log, then retry.");
    if (this.closedByUser) return;
    this.actions.setStatus("reconnecting");
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private onFrame(raw: string) {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(raw) as ServerFrame;
    } catch {
      return;
    }
    if ((frame as { t: string }).t === "engine") {
      for (const l of this.engineListeners) l(frame as unknown as EngineFrame);
      return;
    }
    if (frame.t === "hello") return this.onHello(frame);
    if (frame.t === "history" && frame.nonce) this.clearHistoryFlight(frame.channel_id, frame.nonce);
    if (frame.t === "autocomplete") {
      const cb = frame.nonce ? this.autocompleteWaiters.get(frame.nonce) : undefined;
      if (cb && frame.nonce) this.autocompleteWaiters.delete(frame.nonce);
      cb?.(frame.choices ?? []);
      return;
    }
    const origin = frame.t === "modal" && frame.nonce ? this.nonceChannel.get(frame.nonce) : undefined;
    if ((frame.t === "interaction_done" || frame.t === "modal") && frame.nonce) this.nonceChannel.delete(frame.nonce);
    this.actions.apply(frame, origin);
  }

  private onHello(frame: Extract<ServerFrame, { t: "hello" }>) {
    const resync = this.hadHello;
    this.hadHello = true;
    this.attempt = 0;
    this.engineInfo = (frame as { engine?: EngineHello }).engine ?? { available: false, web_default: false };
    this.actions.apply(frame);
    this.actions.setStatus("open");
    for (const l of this.helloListeners) l();
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.send({ op: "ping" }), PING_MS);
    if (!resync) return;
    // Catch up on whatever happened while we were away, for every channel we had loaded.
    const messages = this.store.getState().messages;
    for (const id of Object.keys(messages)) {
      if (messages[id].loaded) this.requestHistory(id, undefined, true);
    }
  }

  private clearHistoryFlight(channelId: Snowflake, nonce: string) {
    if (this.historyInFlight.get(channelId) === nonce) this.historyInFlight.delete(channelId);
  }

  /** `t:"engine"` frames (the typed engine stream, see src/engine). */
  onEngineFrame(fn: (frame: EngineFrame) => void): () => void {
    this.engineListeners.add(fn);
    return () => this.engineListeners.delete(fn);
  }

  /** Every hello: the first connect and each reconnect (subscriptions must be renewed). */
  onHelloFrame(fn: () => void): () => void {
    this.helloListeners.add(fn);
    return () => this.helloListeners.delete(fn);
  }

  /** Send a raw op. Returns the nonce, or null when the socket is down. */
  send(op: ClientOp | EngineOp, nonce = newNonce()): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;
    this.ws.send(JSON.stringify({ ...op, nonce }));
    return nonce;
  }

  private sendTracked(op: ClientOp, key: string, channelId?: Snowflake): string | null {
    const nonce = this.send(op);
    if (!nonce) {
      this.actions.toast("Not connected to the game server — reconnecting.");
      return null;
    }
    this.actions.addPending(nonce, key);
    window.setTimeout(() => this.actions.settle(nonce, "No response from the game server."), 20000);
    if (channelId) this.nonceChannel.set(nonce, channelId);
    return nonce;
  }

  /** Load the newest page (first call) or the page before the oldest message we hold. */
  loadHistory(channelId: Snowflake) {
    const c = this.store.getState().messages[channelId] ?? EMPTY_CHANNEL;
    if (c.loaded && !c.hasMore) return;
    this.requestHistory(channelId, c.loaded ? c.ids[0] : undefined);
  }

  private requestHistory(channelId: Snowflake, before?: Snowflake, force = false) {
    if (this.historyInFlight.has(channelId) && !force) return;
    const nonce = this.send({ op: "history", channel_id: channelId, before, limit: PAGE_SIZE });
    if (!nonce) return;
    this.historyInFlight.set(channelId, nonce);
    this.actions.setHistoryLoading(channelId, true);
  }

  click(channelId: Snowflake, messageId: Snowflake, customId: string) {
    this.actions.noteInteraction(channelId, messageId, customId);
    return this.sendTracked(
      { op: "click", channel_id: channelId, message_id: messageId, custom_id: customId },
      `${messageId}:${customId}`,
      channelId,
    );
  }

  select(channelId: Snowflake, messageId: Snowflake, customId: string, values: string[], componentType: number) {
    this.actions.noteInteraction(channelId, messageId, customId, values);
    return this.sendTracked(
      { op: "select", channel_id: channelId, message_id: messageId, custom_id: customId, values, component_type: componentType },
      `${messageId}:${customId}`,
      channelId,
    );
  }

  submitModal(interactionId: Snowflake, customId: string, components: ModalSubmitComponent[], channelId?: Snowflake) {
    return this.sendTracked(
      { op: "modal_submit", interaction_id: interactionId, custom_id: customId, components },
      `modal:${interactionId}`,
      channelId,
    );
  }

  sendMessage(channelId: Snowflake, content: string, replyTo?: Snowflake) {
    return this.sendTracked({ op: "send", channel_id: channelId, content, reply_to: replyTo }, `send:${channelId}`);
  }

  runCommand(channelId: Snowflake, name: string, options: InteractionOption[]) {
    return this.sendTracked({ op: "command", channel_id: channelId, name, options }, `command:${channelId}`, channelId);
  }

  dismiss(channelId: Snowflake, messageId: Snowflake) {
    this.send({ op: "dismiss", channel_id: channelId, message_id: messageId });
  }

  autocomplete(channelId: Snowflake, name: string, options: InteractionOption[]): Promise<CommandOptionChoice[]> {
    const nonce = this.send({ op: "autocomplete", channel_id: channelId, name, options });
    if (!nonce) return Promise.resolve([]);
    return new Promise((resolve) => {
      this.autocompleteWaiters.set(nonce, resolve);
      window.setTimeout(() => {
        if (!this.autocompleteWaiters.delete(nonce)) return;
        resolve([]);
      }, 5000);
    });
  }
}
