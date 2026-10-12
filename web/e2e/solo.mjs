// One-click solo game, end to end: from /play as a human seat, press "Play solo", land in the draft,
// let the autopilot bots draft, make our own picks, and wait for setup to continue past the draft.
// Usage: node e2e/solo.mjs <baseUrl> <seatToken> [outDir=/home/user/run/screenshots/solo] [tag=run1]
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core",
);

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const token = process.argv[3];
const out = process.argv[4] ?? "/home/user/run/screenshots/solo";
const tag = process.argv[5] ?? "run1";
const bots = Number(process.env.BOTS ?? 3);
mkdirSync(out, { recursive: true });

const browser = await chromium
  .launch({ executablePath: "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
const shot = (name) =>
  page.screenshot({ path: `${out}/${tag}-${name}.png` }).catch(() => {});
const t0 = Date.now();
const say = (s) => console.log(`[${tag} +${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

const me = await (await fetch(`${base}/app/me?token=${token}`)).json();
const myId = me.user.id;

await page.goto(`${base}/play?t=${token}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Quick solo game", { timeout: 30000 });
// Set the bot count with the stepper (default 3).
for (let n = 3; n < bots; n++) await page.getByLabel("More opponents").click();
for (let n = 3; n > bots; n--) await page.getByLabel("Fewer opponents").click();
await page.waitForTimeout(800);
await shot("1-play");
await page.getByRole("button", { name: "Play solo" }).click();
say("pressed Play solo");
await page.waitForTimeout(2500);
await shot("2-progress");

await page.waitForURL(/\/game\/[a-z]+\d+/, { timeout: 300000 }).catch(async () => {
  await shot("error");
  const err = await page.locator("text=/Timed out|refused|failed/i").allTextContents();
  throw new Error(`never reached the game page: ${err.join(" | ")}`);
});
const game = /\/game\/([a-z]+\d+)/.exec(page.url())[1];
say(`landed on /game/${game}`);
await page.waitForTimeout(5000);
await shot("3-draft");

const draft = async () =>
  (await fetch(`${base}/bot/api/public/game/${game}/draft`)).json();

let picks = 0;
const deadline = Date.now() + 15 * 60000;
for (;;) {
  if (Date.now() > deadline) throw new Error("draft did not finish in 15 minutes");
  const d = await draft();
  if (d.status === "finished") break;
  if (String(d.currentPlayer) !== myId) {
    await page.waitForTimeout(2000);
    continue;
  }
  // Our pick: a ready pick button, else a speaker-order token, else focus a card to reveal its pick button.
  const ready = page.locator('button[class*="pickReady"]:enabled').first();
  const order = page.locator('button[class*="orderReady"]:enabled').first();
  if (await ready.count()) {
    say(`my pick: ${await ready.textContent()}`);
    await ready.click();
  } else if (await order.count()) {
    say(`my pick: speaker order ${await order.getAttribute("title")}`);
    await order.click();
  } else {
    const cards = page.locator('[class*="sliceCard"], [class*="factionCard"]');
    const n = await cards.count();
    for (let i = 0; i < n && !(await ready.count()); i++) {
      await cards.nth(i).click().catch(() => {});
      await page.waitForTimeout(400);
    }
    if (!(await ready.count())) {
      await shot("stuck");
      throw new Error("my turn, but no pick button found");
    }
    say(`my pick: ${await ready.textContent()}`);
    await ready.click();
  }
  picks++;
  await page.waitForTimeout(1500);
  await shot(`4-pick${picks}`);
  await page.waitForTimeout(2000);
}
say(`draft finished after ${picks} picks of mine`);
await page.waitForTimeout(8000);
await shot("5-after-draft");

const web = await (await fetch(`${base}/bot/api/public/game/${game}/web-data`)).json();
const factions = web.playerData.map((p) => `${p.userName}:${p.faction}`).join(", ");
say(`setup: ${factions}; tiles on map ${web.tilePositions.length}`);
console.log(JSON.stringify({ game, picks, factions, problems: problems.slice(0, 10) }));
await browser.close();
