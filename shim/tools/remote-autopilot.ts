/*
 * Dev harness: runs the autopilot (rule table + planner) for some seats OUTSIDE the shim, over the same browser
 * protocol (/app/ws?token=…), so planner changes can be tried against the live shim and bot without restarting
 * either. The seats are taken off the shim's own autopilot first (POST /app/admin/autopilot enabled:false).
 *
 *   npx tsx tools/remote-autopilot.ts --game pbd60            # take over that game's autopilot seats
 *   npx tsx tools/remote-autopilot.ts --names "Bot Alpha 3,Bot Beta 3"
 *
 * Env: SHIM (default http://127.0.0.1:8090), BOT_API (default http://127.0.0.1:8081), SHIM_DATA for the admin key.
 */
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { Autopilot } from "../src/autopilot.js";
import type { Json, StoredMessage } from "../src/store.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1] ?? "1"]] : a), []),
);
const SHIM = process.env.SHIM ?? "http://127.0.0.1:8090";
const BOT_API = process.env.BOT_API ?? "http://127.0.0.1:8081";
const key = JSON.parse(readFileSync(`${process.env.SHIM_DATA ?? "/home/user/run/shim-data"}/state.json`, "utf8")).admin_token as string;

class RemoteStore {
  state: Json = { channels: {}, users: {}, seats: {}, thread_members: {}, messages: {} };
  private visible = new Map<string, Set<string>>();
  scheduleSave() {}
  channel(id: string) {
    return this.state.channels[id];
  }
  messages(channelId: string): StoredMessage[] {
    return (this.state.messages[channelId] ??= []);
  }
  findMessage(channelId: string, id: string) {
    return this.messages(channelId).find((m) => m.id === id);
  }
  canView(userId: string, channelId: string) {
    return !!this.visible.get(userId)?.has(channelId);
  }
  see(userId: string, ch: Json) {
    this.state.channels[ch.id] = { ...this.state.channels[ch.id], ...ch };
    if (!inOnlyGame(ch, this.state.channels)) return;
    if (ch.thread_members) this.state.thread_members[ch.id] = ch.thread_members;
    let set = this.visible.get(userId);
    if (!set) this.visible.set(userId, (set = new Set()));
    set.add(ch.id);
  }
  unsee(userId: string, id: string) {
    this.visible.get(userId)?.delete(id);
  }
  put(userId: string, wire: Json) {
    const list = this.messages(wire.channel_id);
    const i = list.findIndex((m) => m.id === wire.id);
    const prev = i >= 0 ? list[i] : undefined;
    const m: StoredMessage = { ...prev, ...wire } as StoredMessage;
    if (wire.ephemeral) m._ephemeral_for = userId;
    if (wire.prompted_user_id) m._prompted_for = wire.prompted_user_id;
    if (wire.my_press) m._presses = { ...prev?._presses, [userId]: wire.my_press };
    if (i >= 0) list[i] = m;
    else {
      list.push(m);
      list.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      if (list.length > 300) list.splice(0, list.length - 300);
    }
  }
  remove(channelId: string, id: string) {
    const list = this.messages(channelId);
    const i = list.findIndex((m) => m.id === id);
    if (i >= 0) list.splice(i, 1);
  }
}

/** --only pbdN: the seats see nothing of other games (they may sit in live games played by the shim). */
function inOnlyGame(ch: Json, channels: Record<string, Json>): boolean {
  const only = args.only ?? args.game;
  if (!only) return true;
  const name = String(ch.name ?? "");
  if (name.startsWith(`${only}-`) || name.includes(`-${only}-`)) return true;
  const parent = ch.parent_id ? channels[ch.parent_id] : undefined;
  return !!parent && parent !== ch && inOnlyGame(parent, channels);
}

const store = new RemoteStore();
const tokens = new Map<string, string>(); // user id → token

const clients = {
  attachVirtual(userId: string, onFrame: (f: Json) => void) {
    const token = tokens.get(userId)!;
    let ws: WebSocket | null = null;
    const queue: Json[] = [];
    let closed = false;
    const open = () => {
      ws = new WebSocket(`${SHIM.replace(/^http/, "ws")}/app/ws?token=${token}`);
      ws.on("open", () => {
        for (const op of queue.splice(0)) ws!.send(JSON.stringify(op));
      });
      ws.on("message", (raw) => {
        const f = JSON.parse(String(raw)) as Json;
        switch (f.t) {
          case "hello":
            for (const u of f.users ?? []) store.state.users[u.id] = { ...store.state.users[u.id], ...u };
            for (const c of f.channels ?? []) {
              store.see(userId, c);
              if ([0, 11, 12].includes(c.type)) ws!.send(JSON.stringify({ op: "history", channel_id: c.id, limit: 60 }));
            }
            break;
          case "channels":
            for (const c of f.channels ?? []) store.see(userId, c);
            break;
          case "channel_upsert":
            store.see(userId, f.channel);
            ws!.send(JSON.stringify({ op: "history", channel_id: f.channel.id, limit: 60 }));
            break;
          case "channel_delete":
            store.unsee(userId, f.id);
            break;
          case "user_upsert":
            store.state.users[f.user.id] = { ...store.state.users[f.user.id], ...f.user };
            break;
          case "history":
            for (const m of f.messages ?? []) store.put(userId, m);
            break;
          case "message_create":
          case "message_update":
            store.put(userId, f.message);
            break;
          case "message_delete":
            store.remove(f.channel_id, f.id);
            break;
        }
        onFrame(f);
      });
      ws.on("close", () => {
        if (!closed) setTimeout(open, 2000);
      });
      ws.on("error", () => {});
    };
    open();
    return {
      send(op: Json) {
        if (ws?.readyState === 1) ws.send(JSON.stringify(op));
        else queue.push(op);
      },
      close() {
        closed = true;
        ws?.close();
      },
    };
  },
};

async function seats(): Promise<Json[]> {
  const r = await fetch(`${SHIM}/app/admin/players?key=${key}`);
  return (await r.json()) as Json[];
}

async function pick(): Promise<Json[]> {
  const all = await seats();
  if (args.names) {
    const names = String(args.names).split(",").map((s) => s.trim());
    return all.filter((s) => names.includes(s.name));
  }
  const game = String(args.game ?? "");
  for (;;) {
    try {
      const r = await fetch(`${BOT_API}/api/public/game/${game}/web-data`);
      if (r.ok) {
        const data = (await r.json()) as Json;
        const ids = new Set((data.playerData ?? []).map((p: Json) => String(p.discordId)));
        const mine = all.filter((s) => ids.has(String(s.user_id)) && (s.autopilot || args.all));
        if (mine.length) return mine;
      }
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const chosen = await pick();
for (const s of chosen) {
  tokens.set(String(s.user_id), String(s.token));
  store.state.seats[s.token] = { user_id: String(s.user_id), autopilot: true };
  await fetch(`${SHIM}/app/admin/autopilot?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, user_id: s.user_id, enabled: false }),
  });
}
// The other seats of the shim (people), so the rule table can tell them apart from autopilots.
for (const s of await seats()) if (!store.state.seats[s.token]) store.state.seats[s.token] = { user_id: String(s.user_id) };
console.log(`remote autopilot for ${chosen.map((s) => s.name).join(", ")}`);
const hub = { store, gateway: { botReady: true } };
new Autopilot(hub as never, clients as never, BOT_API);
