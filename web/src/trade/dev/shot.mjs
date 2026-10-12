// Screenshot the trade harness. Usage: node shot.mjs <out.png> <game> <token> [width] [height] [query]
// Needs the harness running (npx vite --config src/trade/dev/vite.config.mjs). Optional STEPS env: a JS
// snippet run with `page` in scope before the shot (e.g. clicking steppers).
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
const [out, game, token, w = "1100", h = "1000", query = ""] = process.argv.slice(2);
const port = process.env.TRADE_DEV_PORT ?? "5182";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on("response", (r) => r.status() >= 400 && console.log("HTTP", r.status(), r.url()));
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(`http://127.0.0.1:${port}/?game=${game}&t=${token}${query}`);
await page.waitForSelector("[role=radiogroup]", { timeout: 20000 }).catch(() => console.log("no seats rendered"));
await page.waitForTimeout(1500);
if (process.env.STEPS) await new Function("page", `return (async () => { ${process.env.STEPS} })()`)(page);
await page.screenshot({ path: out, fullPage: process.env.FULL !== "0" });
await browser.close();
