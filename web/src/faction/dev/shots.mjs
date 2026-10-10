// Screenshots of the faction harness. From web/ (harness running):  node src/faction/dev/shots.mjs [base] [outDir]
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core");
const base = process.argv[2] ?? "http://127.0.0.1:5211";
const out = process.argv[3] ?? "/home/user/run/screenshots/faction";
const shots = (process.env.SHOTS ?? "arborec,naalu,keleresa,bastion,crimson,nekro,mahact")
  .split(",")
  .map((s) => s.split("|"));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
for (const [name, query] of shots) {
  await page.goto(`${base}/?${query ?? `faction=${name}`}`);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: process.env.FULL !== "0" });
  console.log("shot", name);
}
if (process.env.INTERACT !== "0") {
  await page.goto(`${base}/?faction=${process.env.TOOLTIP_FACTION ?? "naaz"}`);
  await page.waitForTimeout(1500);
  await page.getByText("hover: mech tooltip").hover();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/tooltip.png`, clip: { x: 0, y: 0, width: 900, height: 520 } });
  await page.mouse.move(1200, 700);
  await page.getByText("Faction sheet").first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/modal.png` });
  console.log("shot tooltip, modal");
}
await page.goto(`${base}/?gallery=1&all=${process.env.ALL ?? "0"}`);
await page.waitForTimeout(3000);
const gapText = await page.locator("#gaps").innerText();
writeFileSync(`${out}/gaps.txt`, gapText);
await page.locator("#gaps").screenshot({ path: `${out}/gallery-gaps.png` });
console.log(problems.join("\n") || "no console errors");
await browser.close();
