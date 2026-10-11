/*
 * A scripted browser for the shim's /app/ws protocol (shim/src/clients.ts): connect as a seat (its private link
 * token), see its channels and messages, click / select / submit / run slash commands and wait for the bot's ack.
 * Uses Node's built-in WebSocket (Node >= 22).
 */
import { SHIM_URL, type Json } from "./env.ts";

export type Msg = Json & { id: string; channel_id: string };

export class ShimClient {
  readonly token: string;
  ws!: WebSocket;
  me: Json = {};
  channels = new Map<string, Json>();
  messages = new Map<string, Map<string, Msg>>();
  private waiters = new Map<string, (f: Json) => void>();
  private listeners = new Set<(f: Json) => void>();
  private nonce = 0;

  constructor(token: string) {
    this.token = token;
  }

  static async connect(token: string): Promise<ShimClient> {
    const c = new ShimClient(token);
    await c.open();
    return c;
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = SHIM_URL.replace(/^http/, "ws") + `/app/ws?token=${encodeURIComponent(this.token)}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error("shim ws: no hello within 20s")), 20000);
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`shim ws: cannot connect to ${url.replace(/token=.*/, "token=…")}`));
      };
      ws.onmessage = (ev) => {
        const f = JSON.parse(String(ev.data));
        if (f.t === "hello") {
          this.me = f.me;
          for (const ch of f.channels ?? []) this.channels.set(ch.id, ch);
          clearTimeout(timer);
          resolve();
        } else if (f.t === "channels") for (const ch of f.channels) this.channels.set(ch.id, ch);
        else if (f.t === "channel_upsert") this.channels.set(f.channel.id, f.channel);
        else if (f.t === "history") for (const m of f.messages) this.put(m);
        else if (f.t === "message_create" || f.t === "message_update") this.put(f.message);
        else if (f.t === "message_delete") this.messages.get(f.channel_id)?.delete(f.id);
        if (f.nonce && this.waiters.has(f.nonce) && (f.t === "interaction_done" || f.t === "modal" || f.t === "history" || f.t === "autocomplete")) {
          this.waiters.get(f.nonce)!(f);
        }
        for (const l of this.listeners) l(f);
      };
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* closed */
    }
  }

  private put(m: Msg) {
    if (!this.messages.has(m.channel_id)) this.messages.set(m.channel_id, new Map());
    this.messages.get(m.channel_id)!.set(m.id, m);
  }

  onFrame(fn: (f: Json) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Sends an op and resolves with the shim's answer frame (interaction_done / modal / history), or a timeout frame. */
  op(op: Json, timeoutMs = 30000): Promise<Json> {
    const n = `eng-${++this.nonce}-${Date.now()}`;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiters.delete(n);
        resolve({ t: "timeout", error: `no answer within ${timeoutMs / 1000}s` });
      }, timeoutMs);
      this.waiters.set(n, (f) => {
        clearTimeout(t);
        this.waiters.delete(n);
        resolve(f);
      });
      this.ws.send(JSON.stringify({ ...op, nonce: n }));
    });
  }

  async history(channelId: string, limit = 100): Promise<Msg[]> {
    const f = await this.op({ op: "history", channel_id: channelId, limit }, 15000);
    return (f.messages ?? []) as Msg[];
  }

  channelByName(name: string | RegExp): Json | undefined {
    return [...this.channels.values()].find((c) => (typeof name === "string" ? c.name === name : name.test(String(c.name))));
  }

  click(channelId: string, messageId: string, customId: string) {
    return this.op({ op: "click", channel_id: channelId, message_id: messageId, custom_id: customId });
  }

  select(channelId: string, messageId: string, customId: string, values: string[], componentType = 3) {
    return this.op({ op: "select", channel_id: channelId, message_id: messageId, custom_id: customId, values, component_type: componentType });
  }

  command(channelId: string, name: string, options: Json[]) {
    return this.op({ op: "command", channel_id: channelId, name, options }, 60000);
  }

  send(channelId: string, content: string) {
    return this.op({ op: "send", channel_id: channelId, content });
  }

  /** Resolves with the first frame that satisfies `pred` (or null on timeout). */
  waitFrame(pred: (f: Json) => boolean, timeoutMs: number): Promise<Json | null> {
    return new Promise((resolve) => {
      const off = this.onFrame((f) => {
        if (pred(f)) {
          clearTimeout(t);
          off();
          resolve(f);
        }
      });
      const t = setTimeout(() => {
        off();
        resolve(null);
      }, timeoutMs);
    });
  }
}

/** Every enabled control (button / select) of a message, depth-first. */
export function controlsOf(components: Json[] | undefined): { id: string; label: string; type: number; options?: string[] }[] {
  const out: { id: string; label: string; type: number; options?: string[] }[] = [];
  const walk = (list: Json[] | undefined) => {
    for (const c of list ?? []) {
      if (!c || typeof c !== "object") continue;
      if (c.type === 2 && c.custom_id) out.push({ id: c.custom_id, label: String(c.label ?? ""), type: 2 });
      if ([3, 5, 6, 7, 8].includes(c.type) && c.custom_id) out.push({ id: c.custom_id, label: String(c.placeholder ?? ""), type: c.type, options: c.options?.map((o: Json) => o.value) });
      walk(c.components);
      if (c.accessory) walk([c.accessory]);
    }
  };
  walk(components);
  return out;
}
