/** Numeric order of two snowflake strings without BigInt allocation. */
export function compareSnowflakes(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const DISCORD_EPOCH = 1420070400000;

/** Milliseconds since the Unix epoch encoded in a snowflake. */
export function snowflakeTime(id: string): number {
  try {
    return Number(BigInt(id) >> 22n) + DISCORD_EPOCH;
  } catch {
    return 0;
  }
}
