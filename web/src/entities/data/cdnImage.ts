/**
 * Game art (tiles, units, tokens, cards) is the bot's own resource tree, served
 * same-origin under `/art` (the shim in production, vite.config.ts in dev).
 * Upstream rewrote every path to `.webp` for its CDN; the bot ships mostly PNGs,
 * so the server falls back across png/webp/jpg for whichever extension is asked.
 */
export const ART_BASE_URL = "/art";

export function cdnImage(image: string) {
  return `${ART_BASE_URL}${image.startsWith("/") ? image : `/${image}`}`;
}
