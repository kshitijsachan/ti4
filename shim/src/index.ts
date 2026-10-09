import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { Store } from "./store.js";
import { Gateway } from "./gateway.js";
import { Hub } from "./hub.js";
import { Rest } from "./rest.js";
import { Clients } from "./clients.js";
import { Lobby } from "./lobby.js";
import { defaultAvatarPng, discordError, sendJson } from "./http.js";
import { log } from "./log.js";

const PORT = Number(process.env.PORT ?? 8090);
const DATA_DIR = process.env.SHIM_DATA ?? join(process.cwd(), "data");
/** Where the bot reaches us (REST + gateway). Internal address. */
const INTERNAL_URL = process.env.SHIM_INTERNAL_URL ?? `http://127.0.0.1:${PORT}`;
/** Public base URL of the site, used for attachment links shown to browsers. Empty = relative. */
const PUBLIC_URL = process.env.PUBLIC_URL ?? "";
const WEB_DIST = process.env.WEB_DIST ?? join(process.cwd(), "..", "web", "dist");
const BOT_API = process.env.BOT_API_URL ?? "http://127.0.0.1:8081";

const store = new Store(DATA_DIR);
const gateway = new Gateway(store, () => INTERNAL_URL.replace(/^http/, "ws") + "/gateway");
const hub = new Hub(store, gateway, () => PUBLIC_URL);
const rest = new Rest(hub, () => INTERNAL_URL.replace(/^http/, "ws") + "/gateway", () => PUBLIC_URL);
(hub as any).rest = rest;
const clients = new Clients(hub);
// Threads created before mention auto-join existed: replay it over stored messages (idempotent).
for (const list of Object.values(store.state.messages)) for (const m of list) hub.autoJoinMentioned(m);
const lobby = new Lobby(hub, clients);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function serveFile(res: import("node:http").ServerResponse, file: string, cache = "public, max-age=31536000, immutable") {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": cache });
  createReadStream(file).pipe(res);
  return true;
}

// Only websocket upgrades go to the 'upgrade' handler. Java's HttpClient (the bot fetching emoji/attachment
// images from us) sends `Upgrade: h2c` on plain-HTTP requests, which must be served as normal requests.
const server = createServer({ shouldUpgradeCallback: (req: import("node:http").IncomingMessage) => /websocket/i.test(String(req.headers.upgrade ?? "")) } as any, async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  try {
    if (path.startsWith("/api/v10/") || path.startsWith("/api/v9/")) {
      return await rest.handle(req, res, path.replace(/^\/api\/v\d+/, ""), url.searchParams);
    }
    if (path.startsWith("/app/")) return await lobby.handle(req, res, path.slice(4), url.searchParams);
    if (path.startsWith("/attachments/")) {
      const [, , id, name] = path.split("/");
      if (serveFile(res, join(DATA_DIR, "files", id.replace(/\D/g, ""), decodeURIComponent(name ?? "").replace(/[\/\\]/g, "")))) return;
      return discordError(res, 404, 0, "not found");
    }
    if (path.startsWith("/emojis/")) {
      const id = path.slice(8).replace(/\.\w+$/, "").replace(/\D/g, "");
      const emoji = store.state.emojis[id];
      if (emoji && serveFile(res, join(DATA_DIR, "emojis", `${id}.${emoji._ext ?? "png"}`))) return;
      return discordError(res, 404, 0, "not found");
    }
    // Discord CDN default avatars (the bot draws player avatars into some images).
    const av = /^\/embed\/avatars\/(\d+)\.png$/.exec(path);
    if (av) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
      return res.end(defaultAvatarPng(Number(av[1])));
    }
    // Custom avatars are not supported; fall back to the user's default avatar.
    const ua = /^\/avatars\/(\d+)\/[^/]+$/.exec(path);
    if (ua) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
      return res.end(defaultAvatarPng(Number((BigInt(ua[1]) >> 22n) % 6n)));
    }
    if (path.startsWith("/bot/")) return proxyToBot(req, res, path.slice(4) + url.search);
    if (path === "/healthz") return sendJson(res, 200, { ok: true, bot: gateway.isReady });
    // Static web client with SPA fallback.
    const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[\/\\])+/, "");
    if (rel !== "/" && serveFile(res, join(WEB_DIST, rel), rel.startsWith("/assets/") ? undefined : "no-cache")) return;
    if (serveFile(res, join(WEB_DIST, "index.html"), "no-cache")) return;
    res.writeHead(404).end("web client not built");
  } catch (e) {
    log.error(`${req.method} ${path}: ${(e as Error).stack}`);
    if (!res.headersSent) discordError(res, 500, 0, "internal error");
  }
});

/**
 * The bot's own Spring API (game state JSON for the map). GETs are open; other methods only reach the
 * authenticated /api/game/** endpoints. Auth: `Authorization: Bearer <seat token>` (the bot resolves it via
 * our /api/v10/users/@me), or `?token=<seat token>` which we turn into that header.
 */
async function proxyToBot(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, path: string) {
  const method = req.method ?? "GET";
  const u = new URL(path, "http://x");
  if (method !== "GET" && !u.pathname.startsWith("/api/game/")) return discordError(res, 405, 0, "read only");
  const headers: Record<string, string> = { accept: String(req.headers.accept ?? "*/*") };
  const seatToken = u.searchParams.get("token");
  if (seatToken) {
    u.searchParams.delete("token");
    headers.authorization = `Bearer ${seatToken}`;
  } else if (req.headers.authorization) headers.authorization = String(req.headers.authorization);
  if (req.headers["content-type"]) headers["content-type"] = String(req.headers["content-type"]);
  try {
    let reqBody: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      reqBody = Buffer.concat(chunks).toString("utf8");
    }
    const upstream = await fetch(BOT_API + u.pathname + u.search, { method, headers, body: reqBody });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    discordError(res, 502, 0, "bot api unavailable");
  }
}

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/gateway") {
    wss.handleUpgrade(req, socket, head, (ws) => gateway.attach(ws));
    return;
  }
  if (url.pathname === "/app/ws") {
    const userId = clients.userForToken(url.searchParams.get("token"));
    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => clients.attach(ws, userId));
    return;
  }
  if (url.pathname === "/bot/ws") {
    // Pass-through to the bot's STOMP websocket (live map state).
    proxyWebSocket(req, socket, head, BOT_API.replace(/^http/, "ws") + "/ws");
    return;
  }
  socket.destroy();
});

function proxyWebSocket(req: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer, target: string) {
  import("ws").then(({ WebSocket }) => {
    const upstream = new WebSocket(target, req.headers["sec-websocket-protocol"]?.split(",").map((s) => s.trim()));
    upstream.on("open", () => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (d, isBinary) => upstream.readyState === 1 && upstream.send(d, { binary: isBinary }));
        upstream.on("message", (d, isBinary) => ws.readyState === 1 && ws.send(d, { binary: isBinary }));
        ws.on("close", () => upstream.close());
        upstream.on("close", () => ws.close());
      });
    });
    upstream.on("error", () => socket.destroy());
  });
}

server.listen(PORT, () => {
  log.info(`shim listening on :${PORT} (data ${DATA_DIR})`);
  log.info(`bot token: ${store.state.bot_token}`);
  log.info(`bot user id: ${store.state.bot_id}, guild id: ${store.state.guild_id}`);
  log.info(`admin link: ${PUBLIC_URL || INTERNAL_URL}/admin?key=${store.state.admin_token}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    store.saveNow();
    process.exit(0);
  });
}

export { readdirSync };
