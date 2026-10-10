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
await page.goto(`${base}/?gallery=1&all=${process.env.ALL ?? "0"}`);
await page.waitForTimeout(3000);
const gapText = await page.locator("#gaps").innerText();
writeFileSync(`${out}/gaps.txt`, gapText);
await page.locator("#gaps").screenshot({ path: `${out}/gallery-gaps.png` });
console.log(problems.join("\n") || "no console errors");
await browser.close();
