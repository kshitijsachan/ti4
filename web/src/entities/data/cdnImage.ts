/**
 * Game art (tiles, units, tokens, cards) is the bot's own resource tree, served
 * same-origin under `/art` (the shim in production, vite.config.ts in dev).
 * Upstream rewrote every path to `.webp` for its CDN; the bot ships mostly PNGs,
 * so the server falls back across png/webp/jpg for whichever extension is asked.
 */
export const ART_BASE_URL = "/art";

/** Upstream card data hotlinks the bot's own resources through statically.io; serve those from `/art` too. */
const BOT_RESOURCE_URL = /^https:\/\/cdn\.statically\.io\/gh\/AsyncTI4\/TI4_map_generator_bot\/(?:master\/)?src\/main\/resources(\/[^?#]*)/;

export function cdnImage(image: string) {
  image = image.match(BOT_RESOURCE_URL)?.[1] ?? image;
  return `${ART_BASE_URL}${image.startsWith("/") ? image : `/${image}`}`;
}
