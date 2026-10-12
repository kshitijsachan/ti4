import { config } from "@/config";
import type { RewindResponse, UndoPointsResponse } from "./types";

export class UndoApiError extends Error {
  readonly status: number;
  /** The latest action is another player's; retry with `force` after asking. */
  readonly needsForce: boolean;
  constructor(message: string, status: number, needsForce = false) {
    super(message);
    this.status = status;
    this.needsForce = needsForce;
  }
}

async function call<T>(url: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (res.ok) return JSON.parse(text) as T;
  let parsed: { error?: string; needsForce?: boolean } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    /* not JSON */
  }
  const fallback = res.status === 401 || res.status === 403 ? "You're not a player in this game." : res.status >= 502 ? "The bot is offline." : `HTTP ${res.status}`;
  const message = parsed.error && parsed.error !== "Forbidden" ? parsed.error : fallback;
  throw new UndoApiError(message, res.status, !!parsed.needsForce);
}

const base = (game: string) => `${config.api.botApiUrl}/game/${encodeURIComponent(game)}`;

export const fetchUndoPoints = (game: string, token: string) => call<UndoPointsResponse>(`${base(game)}/undo-points`, token);

export const postRewind = (game: string, token: string, index: number) => call<RewindResponse>(`${base(game)}/rewind`, token, { index });

export const postUndo = (game: string, token: string, force = false) => call<RewindResponse>(`${base(game)}/undo`, token, { force });
