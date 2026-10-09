// Screenshots of the site's main routes against the live stack.
// Usage: node e2e/screens.mjs [baseUrl=http://127.0.0.1:5173] [outDir=/home/user/run/screenshots/web]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core",
);

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const out = process.argv[3] ?? "/home/user/run/screenshots/web";
const game = process.env.GAME ?? "pbd1";
const players = JSON.parse(readFileSync("/home/user/run/players.json", "utf8"));
const state = JSON.parse(
  readFileSync("/home/user/run/shim-data/state.json", "utf8"),
);
const token = players[0].token;

const browser = await chromium
  .launch({ executablePath: "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const problems = [];
page.on(
  "console",
  (m) => m.type() === "error" && problems.push(`console: ${m.text()}`),
);
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on(
  "response",
  (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`),
);

async function shot(name, url, waitFor, settle = 1500) {
  await page.goto(base + url, { waitUntil: "networkidle" }).catch(() => {});
  if (waitFor)
    await page
      .waitForSelector(waitFor, { timeout: 15000 })
      .catch(() => problems.push(`timeout waiting ${waitFor} on ${url}`));
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name}: ${page.url()}`);
}

await shot("landing", "/", "text=Have a seat");
await shot("admin", `/admin?key=${state.admin_token}`, "text=Players");
await shot("play", `/play?t=${token}`, "text=Your games");
console.log("token stripped:", !page.url().includes("t="));
await shot("game", `/game/${game}`, "[role=tablist]", 4000);
for (const tab of ["Hand", "Trade", "Threads", "Table talk"]) {
  await page.getByRole("tab", { name: tab }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: `${out}/game-${tab.replace(" ", "-").toLowerCase()}.png`,
  });
}
const draftTab = page.getByRole("tab", { name: "Draft" });
if (await draftTab.count()) {
  await draftTab.first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/game-draft.png` });
}
const setupGame = process.env.SETUP_GAME ?? "pbd3";
await shot("game-setup", `/game/${setupGame}`, "[role=tablist]", 3000);
await page.setViewportSize({ width: 420, height: 860 });
await shot("game-mobile", `/game/${game}`, "[role=tablist]", 2500);
await browser.close();
console.log(problems.length ? problems.join("\n") : "no problems");
