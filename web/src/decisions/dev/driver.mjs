// Interactive browser on the decisions harness, for driving a real game step by step.
// node src/decisions/dev/driver.mjs <query, e.g. "t=<token>&game=pbd9"> [port=8197]
// curl localhost:8197/shot?n=name  /click?text=Take%20Diplomacy[&nth=0][&exact=1]  /css?s=<selector>
//      /hover?s=<selector>  /text  /reload  POST /eval (js body)
import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core");
const [query, port = "8197"] = process.argv.slice(2);
const base = process.env.BASE ?? "http://127.0.0.1:5197/";
const out = process.env.OUT ?? "/home/user/run/screenshots/decisions";
const browser = await chromium
  .launch({ executablePath: "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());
const page = await browser.newPage({
  viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) },
});
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`${base}?${query}`);

createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const q = (k) => u.searchParams.get(k);
  try {
    let r = "ok";
    if (u.pathname === "/shot") {
      await page.screenshot({ path: `${out}/${q("n")}.png` });
      r = `${out}/${q("n")}.png`;
    } else if (u.pathname === "/click" || u.pathname === "/css") {
      const loc =
        u.pathname === "/css"
          ? page.locator(q("s"))
          : q("role")
            ? page.getByRole(q("role"), { name: q("text"), exact: q("exact") === "1" })
            : page.getByText(q("text"), { exact: q("exact") === "1" });
      const n = await loc.count();
      const order = q("nth") ? [Number(q("nth"))] : [...Array(n).keys()];
      r = `no clickable match (${n})`;
      for (const i of order) {
        try {
          await loc.nth(i).click({ timeout: 1500 });
          r = `clicked #${i} (${n} matches)`;
          break;
        } catch {
          /* next */
        }
      }
    } else if (u.pathname === "/hover") await page.hover(q("s"), { timeout: 3000 });
    else if (u.pathname === "/reload") await page.reload();
    else if (u.pathname === "/text") r = (await page.locator("body").innerText()).slice(0, Number(q("n") ?? 4000));
    else if (u.pathname === "/eval") {
      let b = "";
      for await (const c of req) b += c;
      r = JSON.stringify(await page.evaluate(b));
    }
    res.end(`${r}\n`);
  } catch (e) {
    res.end(`error: ${e.message}\n`);
  }
}).listen(Number(port), "127.0.0.1");
console.log(`driver on :${port}`);
