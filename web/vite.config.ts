import { defineConfig, type Plugin } from "vite";
import { createReadStream, existsSync, statSync } from "fs";
import { extname, join, normalize } from "path";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

/** The shim: bot API proxy, site endpoints, uploaded files and emoji. */
const SHIM = process.env.SHIM_URL ?? "http://127.0.0.1:8090";

/** The bot's resource tree: tiles, units, tokens, cards. Served as `/art/*`. */
const BOT_RESOURCES =
  process.env.BOT_RESOURCES ??
  "/home/user/asyncti4/ti4_map_generator_bot/src/main/resources";

const ART_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/** First existing file for the path, trying the other image extensions. */
function resolveArt(urlPath: string) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  const base = join(BOT_RESOURCES, rel);
  const stem = base.slice(0, base.length - extname(base).length);
  const candidates = [base, ...Object.keys(ART_TYPES).map((ext) => stem + ext)];
  return candidates.find((file) => existsSync(file) && statSync(file).isFile());
}

/**
 * Dev-only mirror of the shim's `/art` route, so game art loads from the bot
 * checkout instead of upstream's CDN.
 */
function botArt(): Plugin {
  return {
    name: "bot-art",
    configureServer(server) {
      server.middlewares.use("/art", (req, res, next) => {
        const file = resolveArt((req.url ?? "/").split("?")[0]);
        if (!file) return next();
        res.setHeader(
          "content-type",
          ART_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        );
        res.setHeader("cache-control", "public, max-age=86400");
        createReadStream(file).pipe(res);
      });
    },
  };
}

const ReactCompilerConfig = {
  target: "19",
};

export default defineConfig({
  plugins: [
    botArt(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  assetsInclude: ["**/*.woff", "**/*.woff2", "**/*.ttf", "**/*.otf"],
  server: {
    proxy: {
      "/bot": { target: SHIM, changeOrigin: true, ws: true },
      "/app": { target: SHIM, changeOrigin: true, ws: true },
      "/emojis": { target: SHIM, changeOrigin: true },
      "/attachments": { target: SHIM, changeOrigin: true },
    },
  },
});
