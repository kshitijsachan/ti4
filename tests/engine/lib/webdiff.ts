/*
 * Structural difference of two web-data payloads (bot GET /web-data), ignoring presentation-only and wall-clock
 * fields. Arrays of scalars compare as multisets (the bot's set iteration order is not stable).
 */
import type { Json } from "./env.ts";

export type WebDiff = { path: string; expected: unknown; actual: unknown };

/** Paths (regex over "a.b[3].c") that are not game state. */
export const VOLATILE_WEB_PATHS = [
  /JumpLink$/,
  /ThreadLink$/,
  /^gameCustomName$/,
  /^gameState\.turnStartedAt$/,
  /^eventSequence$/,
  /\.factionImage(Type)?$/,
  /\.decalId$/,
  /^versionSchema$/,
  // Stats derived from the board (expected hits, army values) are recomputed, never stored.
  /\.(expectedHitsTimes10|actualHits|spaceArmy\w+|groundArmy\w+)$/,
  /^tileUnitData\.[^.]+\.pds\.[^.]+\.expected$/,
];

const isScalar = (x: unknown) => x === null || ["string", "number", "boolean"].includes(typeof x);

/** Unrevealed objectives get a random "UNREVEALED_<n>" key on every render: number them in order instead. */
export function canonWeb(w: Json): Json {
  let n = 0;
  return JSON.parse(JSON.stringify(w).replace(/UNREVEALED_\d+/g, () => `UNREVEALED_#${n++}`));
}

export function diffWeb(expectedRaw: Json, actualRaw: Json, extraVolatile: RegExp[] = [], limit = 200): WebDiff[] {
  const expected = canonWeb(expectedRaw);
  const actual = canonWeb(actualRaw);
  const out: WebDiff[] = [];
  const skip = (path: string) => [...VOLATILE_WEB_PATHS, ...extraVolatile].some((r) => r.test(path));
  const walk = (e: unknown, a: unknown, path: string) => {
    if (out.length >= limit || skip(path)) return;
    if (Array.isArray(e) && Array.isArray(a)) {
      if (e.every(isScalar) && a.every(isScalar)) {
        const se = e.map((x) => JSON.stringify(x)).sort().join(",");
        const sa = a.map((x) => JSON.stringify(x)).sort().join(",");
        if (se !== sa) out.push({ path, expected: e, actual: a });
        return;
      }
      // playerData and similar: match elements by a stable key when there is one
      const key = ["discordId", "faction", "id", "key", "initiative", "position"].find((k) => e.every((x) => x && typeof x === "object" && k in (x as Json)));
      if (key) {
        const am = new Map(a.map((x) => [(x as Json)[key], x]));
        const em = new Map(e.map((x) => [(x as Json)[key], x]));
        for (const [k, x] of em) walk(x, am.get(k), `${path}[${key}=${k}]`);
        for (const [k, x] of am) if (!em.has(k)) out.push({ path: `${path}[${key}=${k}]`, expected: undefined, actual: x });
        return;
      }
      const n = Math.max(e.length, a.length);
      for (let i = 0; i < n; i++) walk(e[i], a[i], `${path}[${i}]`);
      return;
    }
    if (e && a && typeof e === "object" && typeof a === "object" && !Array.isArray(e) && !Array.isArray(a)) {
      for (const k of new Set([...Object.keys(e as Json), ...Object.keys(a as Json)])) walk((e as Json)[k], (a as Json)[k], path ? `${path}.${k}` : k);
      return;
    }
    if (JSON.stringify(e) !== JSON.stringify(a)) out.push({ path, expected: e, actual: a });
  };
  walk(expected, actual, "");
  return out;
}
