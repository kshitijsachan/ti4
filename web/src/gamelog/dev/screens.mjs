// Screenshots of the game-log harness against the live stack.
// Usage: node src/gamelog/dev/screens.mjs [base=http://127.0.0.1:5191] [out=/home/user/run/screenshots/gamelog]
// Seats: SEATS="pbd1:<token>,pbd9:<token>" (defaults to Alice for pbd1, Tess for pbd9).
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core");

const base = process.argv[2] ?? "http://127.0.0.1:5191";
const out = process.argv[3] ?? "/home/user/run/screenshots/gamelog";
mkdirSync(out, { recursive: true });
const seats = (process.env.SEATS ?? "pbd1:hSNvax-7FDUue0vjCwLOzy5t,pbd9:XzoGTBgjyDFpVpDJ1h3rOJln,pbd8:nE7mY_dJKjIu4fegz2PRZFs1")
  .split(",")
  .map((s) => s.split(":"));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

async function load(game, token, view) {
  await page.goto(`${base}/?t=${token}&g=${game}&view=${view}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForSelector("[aria-label='Game log'] [class*=groupHead], [aria-label='Game log'] [class*=row]", { timeout: 20000 }).catch(() => problems.push(`${game}: no rows`));
  await page.waitForFunction(() => !document.body.innerText.includes("loading…"), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

for (const [game, token] of seats) {
  await load(game, token, "phases");
  await page.screenshot({ path: `${out}/${game}-phases.png` });
  // expand an older group to show the hierarchy
  const heads = page.locator("[aria-label='Game log'] button[aria-expanded=false]");
  if (await heads.count()) {
    await heads.first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${game}-phases-expanded.png` });
  }
  await load(game, token, "timeline");
  await page.screenshot({ path: `${out}/${game}-timeline.png` });
  const withSystem = page.locator("[aria-label='Game log'] [role=button][title^='Show system']");
  if (await withSystem.count()) {
    await withSystem.first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${game}-focus.png` });
  }
  await load(game, token, "players");
  await page.screenshot({ path: `${out}/${game}-players.png` });
  await page.locator("[aria-label='Latest game events']").screenshot({ path: `${out}/${game}-ticker.png` }).catch(() => {});
  console.log(`${game}: done`);
}
console.log(problems.length ? problems.join("\n") : "no problems");
await browser.close();
