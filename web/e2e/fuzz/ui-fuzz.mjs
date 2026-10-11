// Browser fuzzer (Playwright, one chromium): plays a Fuzz seat through the decision popup, choosing random enabled
// options from a seeded PRNG, with disruptions — reload (~20%), close + reopen the tab, context.setOffline toggles,
// and a second tab that answers a prompt. A ws side-client (engine stream, same seat) is the oracle for what waits
// on me. Checks:
//   - after a reload alone: the pending decisions (popup title + "N more" list) and the in-progress selections in the
//     panel are the same; my tokens / TG / commodities / VP / planets unchanged (only compared when the engine state
//     did not change during the reload)
//   - an answered decision (engine id, seen closing after my click) never reappears (unless an undo happened)
//   - when a decision waits on me (engine oracle), the popup shows one within 20 s
//   - no "No response from the game server" (outside an offline window), no page errors, no error alert in the popup
// Usage: node ui-fuzz.mjs [--seed N] [--seat "Fuzz 2"] [--game pbdN] [--engine 0|1] [--minutes 4.5] [--keep]
//        [--headed]
// Without --game a solo game is created (and ended at exit unless --keep). Run under `flock /tmp/ti4-heavy.lock`.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  FUZZ_DIR,
  SHIM,
  ShimClient,
  createSoloGame,
  endGame,
  engineState,
  freshSeed,
  loadSeat,
  makeLogger,
  makeRecorder,
  makeRng,
  myDecisions,
  now,
  parseArgs,
  seatSummary,
  sleep,
  webData,
} from "./lib.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE ?? "/opt/node-tools/node_modules/playwright-core");

const args = parseArgs();
const seed = Number(args.seed ?? freshSeed()) >>> 0;
const rng = makeRng(seed);
const ENGINE = String(args.engine ?? "1") === "1";
const seatName = args.seat ?? "Fuzz 2";
const deadline = Date.now() + Number(args.minutes ?? 4.5) * 60000;
const runDir = `${FUZZ_DIR}/runs/ui-${seed}`;
mkdirSync(runDir, { recursive: true });
const say = makeLogger(`${runDir}/run.log`);
say(`ui-fuzz seed=${seed} seat="${seatName}" engine=${ENGINE ? 1 : 0}`);

const seat = await loadSeat(seatName);
const ME = String(seat.user_id);
let game = args.game;
let created = false;
if (!game) {
  game = await createSoloGame(seat.token, Number(args.bots ?? 3), say);
  created = true;
}
console.log(`GAME=${game}`);
writeFileSync(`${runDir}/game`, `${game}\n${created ? "created" : "attached"}\n`);
const rec = makeRecorder("ui-fuzz", seed, () => game, { seat: seatName, engine: ENGINE });
const trace = [];
const note = (what) => {
  trace.push(`${now()} ${what}`);
  say(what);
};

// ---- oracle: the engine stream for this seat ----
const oracle = new ShimClient(seat.token, { game, label: "oracle", engine: true });
await oracle.connect();
for (let i = 0; i < 30 && oracle.view.status !== "live"; i++) await sleep(300);
let undoAt = 0;
const answered = new Map(); // decision id -> at
oracle.onReopen = (e) => {
  const at = answered.get(e.decision.id);
  if (!at || e.type !== "decision.opened" || undoAt > at || !oracle.closedIds.has(e.decision.id)) return;
  violation("answered-decision-reappeared", `${e.decision.kind} ${e.decision.id} closed after my answer and opened again (seq ${e.seq})`);
};

// ---- browser ----
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: !args.headed }).catch(() => chromium.launch({ headless: !args.headed }));
const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
let offlineUntil = 0;
const gameUrl = `${SHIM}/game/${game}?engine=${ENGINE ? 1 : 0}`;
let shotN = 0;
let page;
let page2 = null;

async function shot(tag) {
  const file = `${runDir}/${String(++shotN).padStart(3, "0")}-${tag}.png`;
  await page?.screenshot({ path: file }).catch(() => {});
  return file;
}
async function violation(kind, detail, extra = {}) {
  const file = await shot(kind.replace(/[^a-z0-9]+/gi, "-"));
  rec.record({ kind: `ui:${kind}`, detail, screenshot: file, trace: trace.slice(-10), ...extra });
}

function watch(p, label) {
  p.on("pageerror", (e) => void violation("page-error", `${label}: ${e.message.slice(0, 300)}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|net::ERR|WebSocket|favicon/i.test(m.text())) trace.push(`${now()} console.error ${label}: ${m.text().slice(0, 200)}`);
  });
}
async function openPage() {
  page = await context.newPage();
  watch(page, "tab1");
  await page.goto(`${SHIM}/play?t=${seat.token}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
}

// ---- popup reading ----
const dialogOf = (p) => p.locator("[role=dialog]").first();
/** Title, the "more waiting" list, the panel's selections and option labels of the popup (null when none). */
async function popupState(p = page) {
  const d = dialogOf(p);
  if (!(await d.count())) return null;
  try {
    const title = ((await d.locator("h2").first().textContent({ timeout: 3000 })) ?? "").trim();
    const more = d.locator("header button", { hasText: /more (after this|waiting)/ });
    let queue = [];
    if (await more.count()) {
      await more.first().click({ timeout: 3000 });
      queue = (await d.locator("[role=menuitem]").allTextContents()).map((s) => s.trim()).sort();
      await more.first().click({ timeout: 3000 }).catch(() => {});
    }
    const selected = (await d.locator('[aria-selected=true], [aria-pressed=true], [aria-checked=true], input:checked').allTextContents()).map((s) => s.trim().slice(0, 40)).sort();
    const inputs = await d.locator("input[type=number], input[type=text], textarea").evaluateAll((els) => els.map((e) => e.value));
    const alert = (await d.locator("[role=alert]").allTextContents()).join(" ").trim();
    return { title, queue, selected, inputs, alert };
  } catch {
    return { title: "?", queue: [], selected: [], inputs: [], alert: "", unstable: true };
  }
}
/** Waits until the popup reads the same twice in a row (renders settle after a reload). */
async function settledPopup(p = page, ms = 20000) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    const s = await popupState(p);
    if (s && !s.unstable && last && JSON.stringify(s) === JSON.stringify(last)) return s;
    last = s;
    await p.waitForTimeout(1500);
  }
  return last;
}

const BODY_CONTROLS = ":scope > :not(header) button:enabled, :scope > :not(header) [role=option]:not([aria-disabled=true])";
const AVOID = /^(Peek at map|Dismiss|Hide this prompt|Collapse|Expand|Close)$|concede|end game|eliminate/i;

async function mySeat() {
  const w = await webData(game);
  return { w, me: seatSummary(w?.playerData?.find((p) => String(p.discordId) === ME)) };
}

// ---- actions ----
async function act(p = page, label = "tab1") {
  const d = dialogOf(p);
  if (!(await d.count())) return false;
  const controls = d.locator(BODY_CONTROLS);
  const n = await controls.count();
  if (!n) return false;
  const choices = [];
  for (let i = 0; i < n; i++) {
    const t = ((await controls.nth(i).textContent().catch(() => "")) ?? "").trim().replace(/\s+/g, " ");
    if (AVOID.test(t)) continue;
    choices.push({ i, t, w: /undo/i.test(t) ? 0.15 : /^(Done|No thanks|Decline|Skip)/i.test(t) ? 0.3 : 1 });
  }
  const c = rng.weighted(choices.map((x) => [x.w, x]));
  if (!c) return false;
  if (/undo/i.test(c.t)) undoAt = Date.now();
  const before = new Set(myDecisions(oracle.view, ME).map((x) => x.id));
  const title = ((await d.locator("h2").first().textContent().catch(() => "")) ?? "").trim();
  note(`${label} click "${c.t.slice(0, 60)}" in "${title}"`);
  await controls.nth(c.i).click({ timeout: 5000 }).catch((e) => note(`  click failed: ${e.message.split("\n")[0]}`));
  // Selecting an option often enables a confirm button: press it most of the time.
  if (rng.chance(0.75)) {
    await p.waitForTimeout(400);
    const confirm = d.locator(":scope > :not(header) button:enabled", { hasText: /^(Take|Keep|Start with|Research|Discard|Pick|Confirm|Submit|Vote|Done|Play|Pay|Produce|Score|Use|Send|Accept|Follow)\b/ });
    if (await confirm.count()) {
      const t = ((await confirm.first().textContent()) ?? "").trim();
      note(`${label} confirm "${t.slice(0, 40)}"`);
      await confirm.first().click({ timeout: 5000 }).catch(() => {});
    }
  }
  await p.waitForTimeout(3500);
  const after = new Set(myDecisions(oracle.view, ME).map((x) => x.id));
  for (const id of before) if (!after.has(id) && oracle.closedIds.has(id)) answered.set(id, Date.now());
  return true;
}

async function doReload() {
  const s0 = await engineState(game);
  const mine0 = myDecisions(oracle.view, ME).map((d) => `${d.id}@${d.revision}`).sort().join();
  const before = await settledPopup(page, 6000);
  const seat0 = await mySeat();
  note(`reload (popup "${before?.title ?? "none"}", ${before?.queue.length ?? 0} queued, selected ${JSON.stringify(before?.selected ?? [])})`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const after = await settledPopup(page, 20000);
  const s1 = await engineState(game);
  const mine1 = myDecisions(oracle.view, ME).map((d) => `${d.id}@${d.revision}`).sort().join();
  const seat1 = await mySeat();
  const quiet = s0 && s1 && s0.stateVersion === s1.stateVersion && mine0 === mine1;
  if (!quiet) return note(`  (state moved during the reload: not compared)`);
  if (!!before !== !!after) return violation("reload-popup-changed", `popup ${before ? `"${before.title}"` : "none"} before the reload, ${after ? `"${after.title}"` : "none"} after (engine state unchanged)`);
  if (before && after) {
    const a = JSON.stringify({ q: before.queue, t: before.queue.length ? undefined : before.title });
    const b = JSON.stringify({ q: after.queue, t: after.queue.length ? undefined : after.title });
    if (a !== b) await violation("reload-pending-changed", `pending decisions before ${a} after ${b}`);
    if (before.title === after.title && (JSON.stringify(before.selected) !== JSON.stringify(after.selected) || JSON.stringify(before.inputs) !== JSON.stringify(after.inputs)))
      await violation("reload-selection-lost", `"${before.title}": selections ${JSON.stringify(before.selected)} inputs ${JSON.stringify(before.inputs)} before, ${JSON.stringify(after.selected)} / ${JSON.stringify(after.inputs)} after`);
  }
  if (JSON.stringify(seat0.me) !== JSON.stringify(seat1.me)) await violation("reload-changed-my-seat", `my seat ${JSON.stringify(seat0.me)} -> ${JSON.stringify(seat1.me)} across a reload alone`);
}

async function doReopen() {
  note("close tab + reopen");
  await page.close().catch(() => {});
  await openPage();
}

async function doOffline() {
  const secs = 3 + rng.int(8);
  note(`offline ${secs}s`);
  offlineUntil = Date.now() + (secs + 25) * 1000;
  await context.setOffline(true);
  await page.waitForTimeout(secs * 1000);
  await context.setOffline(false);
  await page.waitForTimeout(5000);
}

async function doSecondTab() {
  note("second tab acts");
  page2 = await context.newPage();
  watch(page2, "tab2");
  await page2.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page2.waitForTimeout(5000);
  const before = await popupState(page2);
  const did = await act(page2, "tab2");
  await page2.close().catch(() => {});
  page2 = null;
  if (!did || !before) return;
  // The prompt tab2 answered must not stay answerable in tab1 once the engine closed it.
  await page.waitForTimeout(4000);
  const gone = [...answered.entries()].filter(([, at]) => Date.now() - at < 15000).map(([id]) => id);
  if (!gone.length) return;
  const cur = await popupState(page);
  const stillMine = myDecisions(oracle.view, ME).some((d) => gone.includes(d.id));
  if (cur && !stillMine && cur.title === before.title && cur.queue.join() === before.queue.join() && (await oracle.view.decisions[gone[0]]) === undefined && ENGINE)
    await violation("other-tab-answer-not-reflected", `tab2 answered "${before.title}" (closed in the engine) but tab1 still shows it with the same queue after 4 s`);
}

// ---- checks every loop ----
let waitingSince = null;
async function checks() {
  const mine = myDecisions(oracle.view, ME);
  const pop = await popupState(page);
  if (mine.length && !pop) {
    waitingSince ??= Date.now();
    if (Date.now() - waitingSince > 20000 && Date.now() > offlineUntil) {
      await violation("my-move-not-shown", `${mine.length} decision(s) wait on me (${mine.map((d) => d.kind).join(", ")}) but no popup for ${Math.round((Date.now() - waitingSince) / 1000)} s`);
      waitingSince = Date.now() + 60000; // don't repeat at once
    }
  } else waitingSince = null;
  const noResp = await page.locator("text=No response from the game server").count().catch(() => 0);
  if (noResp && Date.now() > offlineUntil) await violation("no-response", `"No response from the game server" shown (popup "${pop?.title}")`);
  if (pop?.alert && Date.now() > offlineUntil && !/No response/.test(pop.alert)) trace.push(`${now()} popup alert: ${pop.alert.slice(0, 160)}`);
  if (pop?.alert && /error|failed|exception/i.test(pop.alert) && Date.now() > offlineUntil) await violation("popup-error", `popup "${pop.title}" shows: ${pop.alert.slice(0, 200)}`);
}

// ---- main ----
await openPage();
await shot("start");
let steps = 0;
try {
  while (Date.now() < deadline) {
    steps++;
    await checks();
    const action = rng.weighted([
      [60, "act"],
      [20, "reload"],
      [7, "reopen"],
      [7, "offline"],
      [6, "tab2"],
    ]);
    if (action === "act") {
      if (!(await act())) await page.waitForTimeout(2500);
    } else if (action === "reload") await doReload();
    else if (action === "reopen") await doReopen();
    else if (action === "offline") await doOffline();
    else if (action === "tab2") await doSecondTab();
  }
} catch (e) {
  note(`fuzzer error: ${e.message.split("\n")[0]}`);
}
await shot("end");
const st = await engineState(game);
say(`done: ${steps} steps, ${rec.list.length} violations, game ${game} round ${st?.round} ${st?.phase}`);
writeFileSync(`${runDir}/trace.json`, JSON.stringify({ seed, game, engine: ENGINE, steps, violations: rec.list, trace }, null, 1));
await browser.close().catch(() => {});
oracle.close();
if (created && !args.keep && endGame(game, seat.token, say)) writeFileSync(`${runDir}/game`, `${game}\ncreated\nended\n`);
process.exit(0);
