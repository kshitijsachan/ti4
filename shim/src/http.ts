import type { IncomingMessage, ServerResponse } from "node:http";
import busboy from "busboy";
import type { Json } from "./store.js";

export type UploadedFile = { field: string; filename: string; contentType: string; data: Buffer };
export type Body = { json: Json; files: UploadedFile[] };

export async function readBody(req: IncomingMessage): Promise<Body> {
  const type = req.headers["content-type"] ?? "";
  if (type.startsWith("multipart/form-data")) return readMultipart(req);
  const raw = await readRaw(req);
  if (!raw.length) return { json: {}, files: [] };
  try {
    return { json: parseJson(raw.toString("utf8")), files: [] };
  } catch {
    return { json: {}, files: [] };
  }
}

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readMultipart(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: 64 * 1024 * 1024 } });
    let json: Json = {};
    const files: UploadedFile[] = [];
    bb.on("field", (name, value) => {
      if (name === "payload_json") {
        try {
          json = parseJson(value);
        } catch {}
      }
    });
    bb.on("file", (field, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () =>
        files.push({ field, filename: info.filename, contentType: info.mimeType, data: Buffer.concat(chunks) }),
      );
    });
    bb.on("close", () => resolve({ json, files }));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

/**
 * JSON.parse that keeps Discord snowflakes intact: JDA sends some ids (permission overwrites, etc.)
 * as bare numbers, which would lose precision as JS doubles. Large integers become strings.
 */
export function parseJson(text: string): any {
  return JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|(-?\d{16,})(?=\s*[,\]}])/g, (m, str, num) => (str ? str : `"${num}"`)));
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  const data = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(data);
}

export function noContent(res: ServerResponse) {
  res.writeHead(204, { "access-control-allow-origin": "*" });
  res.end();
}

export function discordError(res: ServerResponse, status: number, code: number, message: string) {
  sendJson(res, status, { code, message });
}

/** Width/height for PNG, GIF and JPEG, enough for Discord attachment metadata. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}
