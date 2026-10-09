// Drives the rollback harness against the live stack.
// Usage: node src/rollback/dev/screens.mjs <step> [match]   (base http://127.0.0.1:5193, game pbd8 as Solo)
//   look            screenshot the harness (timeline + top bar) and list rows with their rewind state
//   rewind <text>   rewind to the newest live row whose text contains <text> (hover icon → dialog → confirm)
//   undo            press the top-bar Undo (and "Undo anyway" if asked)
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core");

const [step = "look", match = ""] = process.argv.slice(2);
const base = process.env.BASE ?? "http://127.0.0.1:5193";
const game = process.env.GAME ?? "pbd8";
const token = process.env.TOKEN ?? "nE7mY_dJKjIu4fegz2PRZFs1";
const out = process.env.OUT ?? "/home/user/run/screenshots/rollback";
const tag = process.env.TAG ?? step;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`${base}/?t=${token}&g=${game}`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForSelector("[aria-label='Game log'] [data-rewind]", { timeout: 30000 }).catch(() => problems.push("no rewind-classified rows"));
await page.waitForFunction(() => !document.body.innerText.includes("Loading older history"), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);

const rows = page.locator("[aria-label='Game log'] [data-rewind]");
async function listRows(n = 14) {
  const all = await rows.evaluateAll((els) => els.map((e) => `${e.getAttribute("data-rewind").padEnd(8)} ${e.innerText.replace(/\s+/g, " ").slice(0, 110)}`));
  console.log(all.slice(0, n).join("\n"));
}

if (step === "look") {
  await listRows(Number(match) || 14);
  await page.screenshot({ path: `${out}/${tag}.png` });
}

if (step === "rewind") {
  const target = rows.filter({ hasText: match }).and(page.locator("[data-rewind=live]")).last();
  if (!(await target.count())) throw new Error(`no live row matching ${match}`);
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  await page.screenshot({ path: `${out}/${tag}-hover.png` });
  await target.locator("button[aria-label^='Rewind']").click();
  const dialog = page.locator(".mantine-Modal-content");
  await dialog.waitFor();
  await page.waitForTimeout(500);
  console.log("dialog:", (await dialog.innerText()).replace(/\s+/g, " "));
  await page.screenshot({ path: `${out}/${tag}-dialog.png` });
  await dialog.locator("button", { hasText: "Rewind" }).last().click();
  await dialog.waitFor({ state: "detached", timeout: 30000 });
  await page.waitForTimeout(4000);
  await listRows();
  await page.screenshot({ path: `${out}/${tag}-after.png` });
}

if (step === "undo") {
  const btn = page.locator("button[aria-label^='Undo']").first();
  await btn.hover();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${tag}-tooltip.png` });
  await btn.click();
  const pop = page.locator(".mantine-Popover-dropdown");
  await pop.waitFor();
  await page.waitForTimeout(400);
  console.log("popover:", (await pop.innerText()).replace(/\s+/g, " "));
  await page.screenshot({ path: `${out}/${tag}-popover.png` });
  await pop.locator("button", { hasText: /^Undo/ }).click();
  await page.waitForTimeout(2500);
  if (await pop.locator("button", { hasText: "Undo anyway" }).count()) {
    console.log("asked:", (await pop.innerText()).replace(/\s+/g, " "));
    await page.screenshot({ path: `${out}/${tag}-force.png` });
    await pop.locator("button", { hasText: "Undo anyway" }).click();
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(2500);
  await listRows();
  await page.screenshot({ path: `${out}/${tag}-after.png` });
}

console.log(problems.length ? problems.join("\n") : "no problems");
await browser.close();
