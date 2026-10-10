// Two human seats in a game made with the New game form: both draft, both see the table-wide setup steps as
// decisions; A deals the secret objectives and starts the game, both keep a secret objective.
// Usage: node e2e/two-humans-setup.mjs <baseUrl> <game> <tokenA> <tokenB> [outDir]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core");
const [base, game, tokA, tokB] = process.argv.slice(2);
const out = process.argv[6] ?? "/home/user/run/screenshots/setupfix";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const t0 = Date.now();
const say = (s) => console.log(`[2h +${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
async function open(tok, name) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const me = await (await fetch(`${base}/app/me?token=${tok}`)).json();
  await page.goto(`${base}/play?t=${tok}`);
  await page.waitForTimeout(1500);
  await page.goto(`${base}/game/${game}`);
  return { page, id: me.user.id, name, seen: new Set() };
}
const A = await open(tokA, "A");
const B = await open(tokB, "B");
const json = (p) => fetch(`${base}${p}`).then((r) => r.json());
const tableSeen = { A: [], B: [] };
async function step(s, mayPressTable) {
  const { page } = s;
  const d = await json(`/bot/api/public/game/${game}/draft`);
  if (d.status === "drafting") {
    if (String(d.currentPlayer) !== s.id) return;
    const ready = page.locator('button[class*="pickReady"]:enabled').first();
    const order = page.locator('button[class*="orderReady"]:enabled').first();
    if (await ready.count()) { say(`${s.name} pick: ${await ready.textContent()}`); await ready.click(); }
    else if (await order.count()) { say(`${s.name} pick: order`); await order.click(); }
    else {
      const cards = page.locator('[class*="sliceCard"], [class*="factionCard"]');
      const n = await cards.count();
      for (let i = 0; i < n && !(await ready.count()); i++) { await cards.nth(i).click().catch(() => {}); await page.waitForTimeout(300); }
      if (await ready.count()) { say(`${s.name} pick: ${await ready.textContent()}`); await ready.click(); }
    }
    await page.waitForTimeout(2500);
    return;
  }
  const dialog = page.locator("[role=dialog]").first();
  if (!(await dialog.count())) return;
  const title = (await dialog.locator("h2").first().textContent()) ?? "";
  if (/deal secret|start the game/i.test(title)) {
    if (!tableSeen[s.name].includes(title)) {
      tableSeen[s.name].push(title);
      await page.screenshot({ path: `${out}/2h-${s.name}-table-${tableSeen[s.name].length}.png` });
      say(`${s.name} sees table-wide step: ${title}`);
    }
    if (!mayPressTable) return;
    // Only once the other seat saw it too (for the evidence), and its own choices are done.
    const other = s.name === "A" ? "B" : "A";
    if (!tableSeen[other].includes(title)) return;
    const btn = dialog.getByRole("button", { name: /Deal 2|Reveal Objectives/ }).first();
    if (await btn.count()) { say(`${s.name} presses: ${title}`); await btn.click(); await page.waitForTimeout(4000); }
    return;
  }
  const options = dialog.locator("[role=option]");
  if (await options.count()) {
    await options.first().click();
    await page.waitForTimeout(400);
    const confirm = dialog.getByRole("button", { name: /^(Take|Keep|Start with|Research|Discard)\b/ }).first();
    if (await confirm.count()) {
      say(`${s.name} decision: ${title} -> ${(await confirm.textContent())?.trim()}`);
      await page.screenshot({ path: `${out}/2h-${s.name}-decision-${title.replace(/\W+/g, "_").slice(0, 30)}.png` });
      await confirm.click();
      await page.waitForTimeout(3000);
    }
  } else if (await dialog.getByRole("button", { name: "Get a Technology" }).count()) {
    say(`${s.name} decision: ${title} -> Get a Technology`);
    await dialog.getByRole("button", { name: "Get a Technology" }).click();
    await page.waitForTimeout(3000);
  } else {
    const next = dialog.getByLabel("Next decision");
    if (await next.count()) await next.click();
  }
}
const end = Date.now() + 15 * 60000;
let phase = "";
while (Date.now() < end) {
  await step(A, true);
  await step(B, false);
  const w = await json(`/bot/api/public/game/${game}/web-data`).catch(() => null);
  phase = w?.gameState?.phase ?? "";
  if (phase.startsWith("strategy") || phase.startsWith("action")) break;
  await A.page.waitForTimeout(1500);
}
say(`phase: ${phase}`);
await A.page.waitForTimeout(3000);
await A.page.screenshot({ path: `${out}/2h-A-end.png` });
await B.page.screenshot({ path: `${out}/2h-B-end.png` });
console.log(JSON.stringify({ game, phase, tableSeen }));
await browser.close();
