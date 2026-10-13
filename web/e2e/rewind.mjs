// Rewind, then the bots go on: rewinds a live game (as a player in it) to just before a bot's action and asserts that
// a bot acts again (a new save pressed by a bot) within 30 s. Live 2026-10-12 (pbd252): a rewind while a bot was mid
// tactical action left the game waiting on that bot forever ("the rewind appears to be buggy… the bot is stuck").
//
// Usage: node e2e/rewind.mjs <baseUrl> <seatToken> <game> [--tactical] [--within 30]
//   default     rewind to before the newest bot action among the last 15 saves (in the strategy phase right after
//               setup-flow.mjs: across the phase boundary once the action phase began);
//   --tactical  wait (up to 10 min) for a bot's tactical move, rewind to just before it (mid tactical action) and
//               assert the bot finishes that action (a tactical step / conclude) and the game moves on.
// Exit 0 = PASS, 1 = FAIL (bots did not resume), 2 = could not run (no rewindable bot action, API error).
const [base, token, game] = process.argv.slice(2);
const tactical = process.argv.includes("--tactical");
const withinS = Number(process.argv[process.argv.indexOf("--within") + 1]) || 30;
if (!base || !token || !game) {
  console.error("usage: node e2e/rewind.mjs <baseUrl> <seatToken> <game> [--tactical] [--within 30]");
  process.exit(2);
}
const api = `${base}/bot/api`;
const auth = { authorization: `Bearer ${token}`, accept: "application/json" };
const t0 = Date.now();
const say = (s) => console.log(`[rewind +${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, init) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, init);
      const body = await r.json().catch(() => ({}));
      if (r.ok || i >= 5 || r.status < 500) return { ok: r.ok, status: r.status, body };
    } catch (e) {
      if (i >= 5) return { ok: false, status: 0, body: { error: e.message } };
    }
    await sleep(2000);
  }
}
const points = async () => {
  const r = await json(`${api}/game/${game}/undo-points`, { headers: auth });
  if (!r.ok) throw new Error(`undo-points: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.points; // newest first
};
const label = (p) => String(p?.label ?? "");
const byBot = (p) => /^Bot /.test(label(p)) && !/rewound|undid/.test(label(p));
const phase = async () => (await json(`${api}/public/game/${game}/web-data`)).body?.gameState?.phase ?? "?";

async function pickTarget() {
  if (!tactical) {
    const pts = (await points()).slice(0, 16);
    // pts[i] is newer than pts[i + 1]: rewind to pts[i + 1] when pts[i] (the action it undoes first) is a bot's.
    for (let i = 0; i + 1 < pts.length; i++) if (byBot(pts[i]) && !/rewound/.test(label(pts[i + 1]))) return { to: pts[i + 1], undone: pts[i], latest: pts[0] };
    return null;
  }
  const seen = (await points())[0]?.index ?? 0;
  const deadline = Date.now() + 10 * 60000;
  while (Date.now() < deadline) {
    const pts = await points();
    const i = pts.findIndex((p) => p.index > seen && byBot(p) && /tactical\.move|tactical move|“Move ships”|“Skip moving”/i.test(label(p)));
    if (i >= 0 && i + 1 < pts.length) return { to: pts[i + 1], undone: pts[i], latest: pts[0] };
    await sleep(1000);
  }
  return null;
}

const target = await pickTarget();
if (!target) {
  say(tactical ? "no bot tactical move within 10 min" : "no bot action among the last saves to rewind past");
  process.exit(2);
}
const bot = label(target.undone).replace(/^(Bot \S+(?: \d+)?) .*/, "$1");
say(`${game} (${await phase()}): rewinding from save ${target.latest.index} to ${target.to.index} (just before: ${label(target.undone)})`);
const r = await json(`${api}/game/${game}/rewind`, {
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify({ index: target.to.index }),
});
if (!r.ok) {
  say(`rewind refused: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  process.exit(2);
}
const after = r.body.latestIndex;
const at = Date.now();
say(`rewound (latest save now ${after}); phase ${await phase()}; waiting up to ${withinS}s for a bot to act`);

// PASS: a bot acts within the limit (tactical: the interrupted bot takes a step of that same action).
let first = null;
while (Date.now() - at < withinS * 1000) {
  const pts = await points();
  const fresh = pts.filter((p) => p.index > after && byBot(p));
  first = tactical ? fresh.find((p) => label(p).startsWith(bot)) : fresh.at(-1);
  if (first) break;
  await sleep(1000);
}
if (!first) {
  say(`FAIL: no bot acted within ${withinS}s of the rewind (game ${game}, phase ${await phase()})`);
  process.exit(1);
}
say(`bot acted ${((Date.now() - at) / 1000).toFixed(1)}s after the rewind: ${label(first)}`);
if (tactical) {
  // The interrupted action must finish: a landing / conclude / end of turn by that bot within 3 more minutes.
  const deadline = Date.now() + 180000;
  let done = null;
  while (Date.now() < deadline && !done) {
    done = (await points()).find((p) => p.index > after && label(p).startsWith(bot) && /land|Conclude|End Turn|Done/i.test(label(p)));
    if (!done) await sleep(2000);
  }
  if (!done) {
    say(`FAIL: ${bot} resumed but never finished the interrupted tactical action`);
    process.exit(1);
  }
  say(`${bot} finished the interrupted action: ${label(done)}`);
}
say("PASS");
process.exit(0);
