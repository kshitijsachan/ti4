// Screenshot the decisions harness.
// node src/decisions/dev/shot.mjs <out.png> <query> [width=1440] [height=900]
// STEPS env: JSON list of {click: "<selector>"} / {hover: "<selector>"} / {wait: ms} applied before the shot.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core");

const [out, query = "fixtures=1", width = "1440", height = "900"] = process.argv.slice(2);
const base = process.env.BASE ?? "http://127.0.0.1:5197/";
const browser = await chromium
  .launch({ executablePath: "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(`${base}?${query}`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(Number(process.env.SETTLE ?? 2500));
for (const step of JSON.parse(process.env.STEPS ?? "[]")) {
  if (step.click) await page.click(step.click, { timeout: 8000 }).catch((e) => problems.push(`click ${step.click}: ${e.message}`));
  if (step.hover) await page.hover(step.hover, { timeout: 8000 }).catch((e) => problems.push(`hover ${step.hover}: ${e.message}`));
  if (step.wait) await page.waitForTimeout(step.wait);
}
await page.screenshot({ path: out });
console.log(`shot ${out}`);
if (problems.length) console.log(problems.join("\n"));
await browser.close();
