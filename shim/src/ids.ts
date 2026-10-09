import { randomBytes } from "node:crypto";

const DISCORD_EPOCH = 1420070400000n;
let lastMs = 0n;
let seq = 0n;

/** Discord-style snowflake, monotonic within this process. */
export function snowflake(at: number = Date.now()): string {
  let ms = BigInt(at) - DISCORD_EPOCH;
  if (ms <= lastMs) {
    ms = lastMs;
    seq = (seq + 1n) & 0xfffn;
    if (seq === 0n) ms = lastMs + 1n;
  } else {
    seq = 0n;
  }
  lastMs = ms;
  return ((ms << 22n) | (1n << 17n) | seq).toString();
}

export function snowflakeTime(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

export function isoFromSnowflake(id: string): string {
  return new Date(snowflakeTime(id)).toISOString();
}

export function token(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
