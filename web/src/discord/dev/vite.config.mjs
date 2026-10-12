import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Standalone dev server for the play-UI harness: `npx vite --config src/discord/dev/vite.config.mjs`
 * from web/, then open /discord-harness.html?t=<seat token>.
 */
const shim = process.env.SHIM_URL ?? "http://127.0.0.1:8090";
const web = resolve(__dirname, "../../..");

export default defineConfig({
  root: web,
  plugins: [react({ babel: { plugins: [["babel-plugin-react-compiler", { target: "19" }]] } })],
  resolve: { alias: { "@": resolve(web, "src") } },
  server: {
    port: Number(process.env.PORT ?? 5180),
    host: "127.0.0.1",
    // The harness reads captured frames from ../docs/fixtures.
    fs: { allow: [resolve(web, "..")] },
    proxy: {
      "/app": { target: shim, ws: true, changeOrigin: true },
      "/emojis": { target: shim, changeOrigin: true },
      "/attachments": { target: shim, changeOrigin: true },
      "/bot": { target: shim, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(web, "dist-harness"),
    rollupOptions: { input: resolve(web, "discord-harness.html") },
  },
});
