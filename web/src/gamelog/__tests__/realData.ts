/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Message } from "../../discord/types.ts";
import type { LogMessage } from "../parse/classify.ts";
import { toLogMessage } from "../parse/timeline.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = resolve(here, "../../../../docs/fixtures");
export const STATE_PATH = process.env.SHIM_STATE ?? "/home/user/run/shim-data/state.json";

type State = {
  channels: Record<string, { id: string; name: string }>;
  messages: Record<string, Message[]>;
  users: Record<string, { id: string; username: string; global_name?: string }>;
};

/** Captured `message_create` frames from docs/fixtures (channel names are unknown there, so empty). */
export function fixtureMessages(): LogMessage[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("cards-info"))
    .map((f) => JSON.parse(readFileSync(resolve(FIXTURE_DIR, f), "utf8")) as { message?: Message })
    .filter((f) => f.message)
    .map((f) => toLogMessage(f.message!, ""));
}

export function hasState(): boolean {
  return existsSync(STATE_PATH);
}

let cached: State | null = null;
function state(): State {
  cached ??= JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
  return cached;
}

/** A live game's actions channel + round / combat threads from the shim's state file. */
export function gameMessages(game: string): LogMessage[] {
  const s = state();
  const out: LogMessage[] = [];
  for (const c of Object.values(s.channels)) {
    if (c.name !== `${game}-actions` && !c.name.startsWith(`${game}-round-`)) continue;
    for (const m of s.messages[c.id] ?? []) out.push(toLogMessage(m, c.name));
  }
  return out;
}

export function nameOf(userId: string): string | undefined {
  const u = state().users[userId];
  return u ? u.global_name || u.username : undefined;
}
