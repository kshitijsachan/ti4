// New game form, end to end: seat A opens /play, picks seat B, presses Create game; both land in the draft.
// Usage: node e2e/new-game.mjs <baseUrl> <tokenA> <tokenB> [outDir] [tag]
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core");
const [base, tokA, tokB] = process.argv.slice(2);
const out = process.argv[5] ?? "/home/user/run/screenshots/setupfix";
const tag = process.argv[6] ?? "newgame";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const b = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const t0 = Date.now();
const say = (s) => console.log(`[${tag} +${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
const meB = await (await fetch(`${base}/app/me?token=${tokB}`)).json();
await a.goto(`${base}/play?t=${tokA}`);
await b.goto(`${base}/play?t=${tokB}`);
await a.waitForSelector("text=New game", { timeout: 30000 });
await a.waitForTimeout(1500);
const lobbyShown = await a.locator("text=# lobby").count();
say(`lobby chat visible: ${lobbyShown > 0}`);
await a.getByRole("button", { name: meB.user.global_name ?? meB.user.username, exact: true }).click();
await a.screenshot({ path: `${out}/${tag}-1-form.png` });
await a.getByRole("button", { name: "Create game" }).click();
say("pressed Create game");
await a.waitForTimeout(2000);
await a.screenshot({ path: `${out}/${tag}-2-progress.png` });
await Promise.all([
  a.waitForURL(/\/game\/[a-z]+\d+/, { timeout: 300000 }),
  b.waitForURL(/\/game\/[a-z]+\d+/, { timeout: 300000 }),
]);
const game = /\/game\/([a-z]+\d+)/.exec(a.url())[1];
say(`A landed on ${a.url()}, B landed on ${b.url()}`);
for (let i = 0; i < 60; i++) {
  const d = await (await fetch(`${base}/bot/api/public/game/${game}/draft`)).json().catch(() => ({}));
  if (d.status === "drafting") break;
  await a.waitForTimeout(2000);
}
await a.waitForTimeout(6000);
await a.screenshot({ path: `${out}/${tag}-3-A-draft.png` });
await b.screenshot({ path: `${out}/${tag}-3-B-draft.png` });
const d = await (await fetch(`${base}/bot/api/public/game/${game}/draft`)).json();
console.log(JSON.stringify({ game, draft: d.status, players: d.players?.map((p) => p.name) }));
await browser.close();
