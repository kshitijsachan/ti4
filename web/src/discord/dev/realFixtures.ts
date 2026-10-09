import type { Message, ServerFrame } from "../types";

/**
 * Real bot output captured into docs/fixtures/*.json (one server frame per file). The harness shows every
 * captured message in one synthetic channel, ordered by file name, so renderer changes can be checked
 * against what the bot actually sends. Loaded raw so a half-written capture cannot break the build.
 */
const files = import.meta.glob<string>("../../../../docs/fixtures/*.json", { query: "?raw", import: "default", eager: true });

export const REAL_CHANNEL_ID = "200";

export function realFixtureFrames(): { messages: Message[]; modals: ServerFrame[] } {
  const messages: Message[] = [];
  const modals: ServerFrame[] = [];
  let seq = 9_000_000;
  for (const path of Object.keys(files).sort()) {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(files[path]) as ServerFrame;
    } catch {
      continue;
    }
    if (frame.t === "modal") modals.push(frame);
    if (frame.t !== "message_create" && frame.t !== "message_update") continue;
    const name = path.split("/").pop()?.replace(/\.json$/, "") ?? "";
    messages.push({
      id: String(seq++),
      channel_id: REAL_CHANNEL_ID,
      author: { id: "fixture", username: "fixture", global_name: "fixture", bot: true },
      content: `-# ${name}`,
      timestamp: frame.message.timestamp,
    });
    messages.push({ ...frame.message, id: String(seq++), channel_id: REAL_CHANNEL_ID });
  }
  return { messages, modals };
}
