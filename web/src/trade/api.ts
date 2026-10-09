import type {
  PendingResponse,
  ProposeRequest,
  ProposeResponse,
  TradeOptions,
} from "./types";

export class TradeApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new TradeApiError(errorMessage(text, res.status), res.status);
  return JSON.parse(text) as T;
}

function errorMessage(body: string, status: number) {
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    if (parsed.error && parsed.error !== "Forbidden") return parsed.error;
    if (parsed.message) return parsed.message;
  } catch {
    /* not JSON */
  }
  if (status === 401 || status === 403) return "You're not a player in this game.";
  if (status === 502 || status === 503) return "The bot is offline.";
  return body.slice(0, 200) || `HTTP ${status}`;
}

const base = (botBase: string, game: string) =>
  `${botBase}/api/game/${encodeURIComponent(game)}/trade`;

export const fetchTradeOptions = (botBase: string, game: string, token: string) =>
  call<TradeOptions>(`${base(botBase, game)}/options`, token);

export const fetchPendingTrades = (botBase: string, game: string, token: string) =>
  call<PendingResponse>(`${base(botBase, game)}/pending`, token);

export const proposeTrade = (
  botBase: string,
  game: string,
  token: string,
  body: ProposeRequest,
) =>
  call<ProposeResponse>(`${base(botBase, game)}/propose`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
