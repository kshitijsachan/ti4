import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Game-log harness: `npx vite --config src/gamelog/dev/vite.config.mjs` from web/, then open
 * http://127.0.0.1:5191/?t=<seat token>&g=<game>  (SHIM_URL / PORT override the defaults).
 */
const shim = process.env.SHIM_URL ?? "http://127.0.0.1:8090";
const web = resolve(__dirname, "../../..");

export default defineConfig({
  root: __dirname,
  plugins: [react({ babel: { plugins: [["babel-plugin-react-compiler", { target: "19" }]] } })],
  resolve: { alias: { "@": resolve(web, "src") } },
  server: {
    port: Number(process.env.PORT ?? 5191),
    host: "127.0.0.1",
    fs: { allow: [web] },
    proxy: {
      "/app": { target: shim, ws: true, changeOrigin: true },
      "/emojis": { target: shim, changeOrigin: true },
      "/attachments": { target: shim, changeOrigin: true },
      "/art": { target: shim, changeOrigin: true },
      "/bot": { target: shim, ws: true, changeOrigin: true },
    },
  },
});
