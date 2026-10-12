// Standalone harness for the trade panel. From web/:  npx vite --config src/trade/dev/vite.config.mjs
// Open http://127.0.0.1:5182/?game=pbd1&t=<player token>. Everything backend goes to the shim.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SHIM = process.env.SHIM_URL ?? "http://127.0.0.1:8090";

export default defineConfig({
  root: here,
  publicDir: resolve(here, "../../../public"),
  plugins: [react()],
  resolve: { alias: { "@": resolve(here, "../..") } },
  server: {
    port: Number(process.env.TRADE_DEV_PORT ?? 5182),
    host: "127.0.0.1",
    proxy: {
      "/bot": { target: SHIM, changeOrigin: true, ws: true },
      "/app": { target: SHIM, changeOrigin: true, ws: true },
      "/emojis": { target: SHIM, changeOrigin: true },
      "/attachments": { target: SHIM, changeOrigin: true },
      "/art": { target: SHIM, changeOrigin: true },
    },
  },
});
