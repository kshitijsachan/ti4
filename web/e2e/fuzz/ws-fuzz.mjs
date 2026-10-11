// Protocol fuzzer (no browser): plays a Fuzz seat in a solo game over the shim's websocket — the protocol the web
// client speaks — choosing at random, from a seeded PRNG, among:
//   - answering my open engine decisions (op:"answer": option / select values / form inputs), mostly
//   - pressing the same prompts the legacy way (click / select / modal on the source message)
//   - pressing any enabled control in the game's channels (info buttons, other players' prompts, undo buttons)
//   - adversarial answers: someone else's decision, a decision I already answered (old expectedSeq), garbage payloads
//   - dropping the socket (resume from the last seq) and comparing the resumed engine view with a fresh snapshot
// After every press: the answer's status (status "error", timeouts, a foreign / stale answer accepted), bot-log ERROR
// blocks naming the game (shim.log), the state invariants of tests/engine/lib/invariants.ts on web data + save,
// an answered decision reopening, and stall (the game waits on me — I'm the active player in the strategy / action /
// agenda phase — but no actionable prompt of mine for --stall s).
//
// Usage: node ws-fuzz.mjs [--seed N] [--seat "Fuzz 1"] [--game pbdN] [--minutes 20] [--steps N] [--bots 3]
//                         [--stall 60] [--keep]
// A game the fuzzer created is ended at exit (end-game.mjs) unless --keep. Logs: <FUZZ_DIR>/runs/ws-<seed>/.
import { mkdirSync, writeFileSync } from "node:fs";
import {
  BotErrorTail,
  botDecisions,
  stackHealthy,
  waitForStack,
  FUZZ_DIR,
  ShimClient,
  controlsOf,
  createSoloGame,
  endGame,
  freshSeed,
  invariantViolations,
  loadSeat,
  makeLogger,
  makeRecorder,
  makeRng,
  myDecisions,
  now,
  optionsFor,
  parseArgs,
  sleep,
  snapshotOf,
} from "./lib.mjs";

const args = parseArgs();
const seed = Number(args.seed ?? freshSeed()) >>> 0;
const rng = makeRng(seed);
const seatName = args.seat ?? "Fuzz 1";
const minutes = Number(args.minutes ?? 20);
const maxSteps = Number(args.steps ?? Infinity);
const STALL_S = Number(args.stall ?? 60);
let deadline = Date.now() + minutes * 60000;
const runDir = `${FUZZ_DIR}/runs/ws-${seed}`;
mkdirSync(runDir, { recursive: true });
const say = makeLogger(`${runDir}/run.log`);
say(`ws-fuzz seed=${seed} seat="${seatName}" (replay: node web/e2e/fuzz/ws-fuzz.mjs --seed ${seed} --seat "${seatName}"${args.game ? ` --game ${args.game}` : ""})`);

const seat = await loadSeat(seatName);
const ME = String(seat.user_id);
let game = args.game;
let created = false;
if (!game) {
  game = await createSoloGame(seat.token, Number(args.bots ?? 3), say);
  created = true;
}
writeFileSync(`${runDir}/game`, `${game}\n${created ? "created" : "attached"}\n`);
if (created) deadline = Date.now() + minutes * 60000;
say(`game ${game} (${created ? "created" : "attached"})`);
const rec0 = makeRecorder("ws-fuzz", seed, () => game, { seat: seatName });
// Findings made while the stack is down / restarting are noise: re-check health before recording.
const rec = {
  list: rec0.list,
  async record(v) {
    if (!(await stackHealthy())) return say(`   (not recorded, stack restarting: ${v.kind})`);
    return rec0.record(v);
  },
};
const trace = [];
const tr = () => trace.slice(-12).map((t) => `#${t.step} ${t.what}${t.result ? ` -> ${t.result}` : ""}`);

// ---- connection ----
const answered = new Map(); // decision id -> {revision, seq, at, optionId}
let undoAt = 0;
const client = new ShimClient(seat.token, { game, label: "ws-fuzz", engine: true });
client.onReopen = (e) => {
  const a = answered.get(e.decision.id);
  const closed = client.closedIds.get(e.decision.id);
  if (!a || !closed || e.type !== "decision.opened") return;
  if (undoAt > a.at || e.decision.kind === "legacy") return;
  rec.record({
    kind: "engine:answered-decision-reopened",
    severity: "warn",
    detail: `${e.decision.kind} ${e.decision.id} answered (${a.optionId}) and closed (${closed.reason}) reopened at seq ${e.seq}`,
    trace: tr(),
  });
};
if (!(await client.connect())) throw new Error("could not connect to the shim");
for (let i = 0; i < 20 && client.view.status !== "live"; i++) await sleep(500);
say(`engine view: ${client.view.status}, ${Object.keys(client.view.decisions).length} decisions visible, seq ${client.view.seq}`);
const errTail = new BotErrorTail(game);

// ---- policy ----
const SKIP =
  /concede|eliminat|endGame|end_game|gameEnd|deleteGame|resign|leaveGame|kickPlayer|replacePlayer|forceAbort|startTFDraft|frankenDraft|^jmf|showGameAgain|searchMyGames|getStarted|newGame|createGame|offerPlayerPref|playerPref_|notepad|^setupStep|startPlayerSetup|^frankenSetup|^setupBaseGameMode|^chooseExp_|^enableDaneMode|^offerTEOptionButtons|^restartAllMiltyQueue|^miltyFactionInfo|genericModify|getModifyTiles|^modifyUnits|getDamageButtons_.*_remove|^addUnits|^removeUnits|setupHomebrew|getHomebrewButtons|^gameSetup|miltySetup|^draftSetup/i;
// "Done" / dismiss buttons on a required prompt throw the prompt away; a human rarely does it, the fuzzer would
// mostly dead-end the game, so they get a low weight (they are still tried).
// Read-only info buttons (Cards Info thread, map views, refreshes) are pressed rarely: they don't move the game.
const INFO = /^(cardsInfo|getModifyTiles|refresh|show|offerInfo|offerDeck|checkEmpty|checkTechSkip|chooseMapView|factionEmbedRefresh|getStarted|gameInfo|unitInfo|leaderInfo|showObj|showDeck|transaction$|newTransact|offerToTransact)/i;
const DISMISS = /^deleteButtons|^dismiss|^deleteMessage|^ignore|^done/i;
const UNDO = /^ultimateUndo_|undo/i;
const stateMe = () => client.view.state?.players?.find((p) => p.userId === ME);
const fam = (f) => (f?.startsWith("keleres") ? "keleres" : f);
const decisionByMessage = () => {
  const m = new Map();
  for (const d of Object.values(client.view.decisions)) m.set(d.source?.messageId, d);
  return m;
};

function legacyCandidates() {
  const byMsg = decisionByMessage();
  const mine = new Set(myDecisions(client.view, ME).map((d) => d.id));
  const myFaction = stateMe()?.faction;
  const out = [];
  for (const m of client.gameMessages().slice(-150)) {
    if (!m.author?.bot) continue;
    const cs = controlsOf(m.components).filter((c) => !SKIP.test(c.id));
    if (!cs.length) continue;
    const d = byMsg.get(m.id);
    const own = d ? mine.has(d.id) : cs.some((c) => fam(c.id.match(/^FFCC_([^_]+)_/)?.[1]) === fam(myFaction));
    const age = (Date.now() - Number((BigInt(m.id) >> 22n) + 1420070400000n)) / 60000;
    for (const c of cs) {
      const ff = c.id.match(/^FFCC_([^_]+)_/)?.[1];
      let w = own ? 6 : 0.4;
      if (ff && fam(ff) !== fam(myFaction)) w = 0.15; // someone else's locked buttons: the bot must refuse
      if (UNDO.test(c.id)) w = 0; // undo has its own weight
      if (DISMISS.test(c.id)) w *= 0.1;
      if (INFO.test(c.id.replace(/^FFCC_[^_]+_/, ""))) w *= 0.1;
      if (age > 20) w *= 0.3;
      out.push({ m, c, d, own, w });
    }
  }
  return out;
}

function randomValues(min, max, choices) {
  const lo = Math.max(0, min ?? 1);
  const hi = Math.max(lo, Math.min(max ?? 1, choices.length));
  const n = lo + rng.int(hi - lo + 1);
  return rng.shuffle(choices).slice(0, n);
}
function randomText(field) {
  if (field?.type === "choice") return randomValues(field.minValues, field.maxValues, (field.choices ?? []).map((c) => c.value)).join("\n");
  const pool = field?.type === "number" ? ["0", "1", "2", "3", "5", "-1", "99", "x", ""] : ["0", "1", "2", "", "x", "abc", "1,2", "-1", "99"];
  if (field?.value && rng.chance(0.3)) return field.value;
  return String(rng.pick(pool));
}
function randomModal(modal) {
  const leaf = (x, i) =>
    x.type === 4
      ? { type: 4, id: x.id ?? i, custom_id: x.custom_id, value: randomText({ type: "text" }) }
      : { type: x.type, id: x.id ?? i, custom_id: x.custom_id, values: x.options?.length ? [rng.pick(x.options).value] : [] };
  return (modal.components ?? []).map((row, i) =>
    row.type === 18 ? { type: 18, id: row.id ?? i, component: leaf(row.component, i) } : { type: 1, id: row.id ?? i, components: (row.components ?? []).map(leaf) },
  );
}

/** An engine answer for decision d from its options / inputs: {optionId} | {optionId, values} | {optionId:"submit", inputs}. */
function randomAnswer(d) {
  const opts = optionsFor(d, ME).filter((o) => !o.disabled && !SKIP.test(o.id));
  if (d.kind === "input.form" && d.inputs?.[0]) {
    if (rng.chance(0.15)) return { optionId: "cancel" };
    return { optionId: "submit", inputs: Object.fromEntries(d.inputs[0].fields.map((f) => [f.id, randomText(f)])) };
  }
  const selects = (d.inputs ?? []).filter((i) => i.kind === "select" && i.fields?.[0]?.choices?.length);
  if (selects.length && (!opts.length || rng.chance(0.4))) {
    const s = rng.pick(selects);
    const f = s.fields[0];
    return { optionId: s.id, values: randomValues(f.minValues, f.maxValues, f.choices.map((c) => c.value)) };
  }
  if (!opts.length) return null;
  const w = (o) => (UNDO.test(o.id) ? 0.1 : DISMISS.test(o.id) ? 0.08 : INFO.test(o.id.replace(/^FFCC_[^_]+_/, "")) ? 0.05 : 1);
  return { optionId: rng.weighted(opts.map((o) => [w(o), o])).id };
}

// ---- actions ----
const mineDiverge = new Map();
let step = 0;
const BENIGN = /starting up|no longer exists|not for you|These buttons are not|is not for you|not your|already|You are not|Unknown/i;

async function engineAnswer(d, a, label) {
  const op = {
    op: "answer",
    game,
    decisionId: d.id,
    ...a,
    expectedSeq: a.expectedSeq ?? d.seq,
    requestId: `fz${seed}-${step}-${d.id}`,
  };
  const entry = { step, at: now(), what: `${label} ${d.kind} ${d.id} ${JSON.stringify({ ...a, expectedSeq: undefined }).slice(0, 160)}` };
  trace.push(entry);
  const t0 = Date.now();
  const f = await client.send(op, 75000);
  const r = f.t === "engine" ? f.result : { ok: false, status: f.t };
  entry.result = `${r.status}${r.error ? `: ${String(r.error).slice(0, 120)}` : ""} (${Date.now() - t0} ms${r.path ? `, ${r.path}` : ""})`;
  say(`#${step} ${entry.what} -> ${entry.result}`);
  return r;
}

async function doMine() {
  const mine = myDecisions(client.view, ME);
  if (!mine.length) return false;
  const dw = (d) => (/preassign|pre_decline|queue|game_settings/.test(d.kind) ? 0.3 : d.kind === "legacy" ? 1 : 5);
  const d = rng.weighted(mine.map((x) => [dw(x), x]));
  const a = randomAnswer(d);
  if (!a) return false;
  const r = await engineAnswer(d, a, "answer");
  if (r.status === "timeout") rec.record({ kind: "engine:answer-timeout", detail: `${d.kind} ${a.optionId ?? ""}: no answer frame within 75 s`, step, trace: tr() });
  else if (r.status === "error") rec.record({ kind: "engine:answer-error", detail: `${d.kind} [${a.optionId}]: ${r.error}`, step, trace: tr() });
  if (r.status === "forbidden" || r.status === "stale") {
    // My view said it waits on me: what does the bot think? (stale view = stream problem; same view = refusal problem)
    const bot = (await botDecisions(game))?.decisions?.find((x) => x.id === d.id);
    const mineNow = client.view.decisions[d.id];
    const detail = `${d.kind} ${r.status}: my view rev ${d.revision} seq ${d.seq} target ${d.target?.faction ?? d.target?.userId}(${d.target?.resolvedBy}); view now ${mineNow ? `rev ${mineNow.revision} seq ${mineNow.seq} target ${mineNow.target?.faction ?? mineNow.target?.userId}` : "closed"}; bot ${bot ? `rev ${bot.revision} seq ${bot.seq} target ${bot.target?.faction ?? bot.target?.userId}(${bot.target?.resolvedBy})` : "closed"}`;
    say(`   ${detail}`);
    if (bot && mineNow && (bot.seq !== mineNow.seq || bot.revision !== mineNow.revision)) {
      mineDiverge.set(d.id, (mineDiverge.get(d.id) ?? 0) + 1);
      if (mineDiverge.get(d.id) >= 3) rec.record({ kind: "engine:view-behind-bot", detail, step, trace: tr() });
    } else if (r.status === "forbidden" && bot && bot.target?.userId === ME) rec.record({ kind: "engine:mine-refused", detail, step, trace: tr() });
  }
  if (r.ok) answered.set(d.id, { revision: d.revision, seq: d.seq, at: Date.now(), optionId: a.optionId, kind: d.kind, answer: a });
  if (UNDO.test(a.optionId ?? "")) undoAt = Date.now();
  return true;
}

async function pressLegacy(cands) {
  const pick = rng.weighted(cands.map((x) => [x.w, x]));
  if (!pick) return false;
  const { m, c } = pick;
  let op;
  if (c.kind === "select") op = { op: "select", channel_id: m.channel_id, message_id: m.id, custom_id: c.id, values: randomValues(c.min, c.max, c.options), component_type: c.type };
  else op = { op: "click", channel_id: m.channel_id, message_id: m.id, custom_id: c.id };
  if (UNDO.test(c.id)) undoAt = Date.now();
  const entry = { step, at: now(), what: `${pick.own ? "press-mine" : "press-other"} [${c.id}]${op.values ? `=${op.values.join(",")}` : ""} "${c.label}" in #${m._ch?.name}` };
  trace.push(entry);
  let res = await client.send(op, 45000);
  if (res.t === "modal") {
    const comps = randomModal(res.modal ?? {});
    entry.what += ` +modal ${JSON.stringify(comps).slice(0, 120)}`;
    res = await client.send({ op: "modal_submit", interaction_id: res.interaction_id, custom_id: res.modal?.custom_id, components: comps, channel_id: m.channel_id }, 45000);
  }
  entry.result = res.t === "interaction_done" ? (res.error ?? "ok") : res.t;
  say(`#${step} ${entry.what} -> ${entry.result}`);
  if (res.t === "timeout") rec.record({ kind: "press:timeout", detail: `no interaction_done for ${c.id.replace(/\d{6,}/g, "N")} within 45 s`, step, trace: tr() });
  else if (res.error && !BENIGN.test(res.error)) rec.record({ kind: "press:error", detail: `${c.id.replace(/\d{6,}/g, "N")}: ${res.error}`, step, trace: tr() });
  return true;
}

async function doForeign() {
  const theirs = Object.values(client.view.decisions).filter((d) => d.scope === "player" && d.target?.userId && d.target.userId !== ME && d.options.some((o) => !o.disabled));
  const d = rng.pick(theirs);
  if (!d) return false;
  const o = rng.pick(d.options.filter((x) => !x.disabled));
  const r = await engineAnswer(d, { optionId: o.id }, "foreign");
  if (r.ok) rec.record({ kind: "engine:foreign-answer-accepted", detail: `answered ${d.kind} targeted at ${d.target.faction ?? d.target.userId} (${d.target.resolvedBy}) as ${seatName}: ${r.status}`, step, trace: tr() });
  if (r.status === "error") rec.record({ kind: "engine:answer-error", detail: `foreign ${d.kind} [${o.id}]: ${r.error}`, step, trace: tr() });
  return true;
}

async function doStale() {
  // A decision I answered earlier, answered again with the seq it had then (a double click / a replayed request).
  const old = [...answered.entries()].filter(([, a]) => Date.now() - a.at < 10 * 60000 && !UNDO.test(a.optionId ?? ""));
  const pick = rng.pick(old);
  if (!pick) return false;
  const [id, a] = pick;
  const d = client.view.decisions[id] ?? { id, kind: a.kind, seq: a.seq };
  const r = await engineAnswer(d, { ...a.answer, expectedSeq: a.seq }, "stale-replay");
  const changed = !client.view.decisions[id] || client.view.decisions[id].seq !== a.seq;
  if (r.ok && changed) rec.record({ kind: "engine:stale-answer-accepted", detail: `re-answer of ${a.kind} with expectedSeq ${a.seq} (decision now ${client.view.decisions[id] ? `seq ${client.view.decisions[id].seq}` : "closed"}) -> ${r.status}`, step, trace: tr() });
  if (r.status === "error") rec.record({ kind: "engine:answer-error", detail: `stale ${a.kind}: ${r.error}`, step, trace: tr() });
  return true;
}

const GARBAGE = [{ payload: {} }, { payload: { planets: ["nowhere"], tg: -3 } }, { payload: { units: [{ unit: "warsun", count: 99, holder: "x" }] } }, { action: "move", body: {} }, { action: "land", body: { units: 5 } }, { action: "combat-plan", body: { plan: [{ unit: "dn", action: "sustain", count: 9 }] } }, { optionId: "nonexistent_option" }, { optionId: "submit", inputs: { x: "1" } }];
async function doGarbage() {
  const mine = myDecisions(client.view, ME);
  const d = rng.pick(mine.length ? mine : Object.values(client.view.decisions));
  if (!d) return false;
  const g = rng.pick(GARBAGE);
  const a = g.optionId === undefined && g.payload !== undefined && d.options[0] ? { ...g, optionId: d.options[0].id } : g;
  const r = await engineAnswer(d, a, "garbage");
  if (r.status === "error" || r.status === "timeout") rec.record({ kind: `engine:garbage-${r.status}`, detail: `${d.kind} ${JSON.stringify(g)}: ${r.error ?? "no answer frame"}`, step, trace: tr() });
  return true;
}

/** Drops the socket; after the client resumed (engine_sub after=seq), compares its view with a fresh snapshot. */
async function doReconnect() {
  trace.push({ step, at: now(), what: "drop socket" });
  say(`#${step} drop socket (resume from seq ${client.view.seq})`);
  const before = client.connects;
  client.drop();
  for (let i = 0; i < 40 && client.connects === before; i++) await sleep(500);
  if (client.connects === before) {
    rec.record({ kind: "ws:reconnect-failed", detail: "the shim did not take the reconnect within 20 s", step, trace: tr() });
    return true;
  }
  await sleep(3000);
  await compareWithFresh("resume");
  return true;
}
async function compareWithFresh(why) {
  const fresh = new ShimClient(seat.token, { game, label: "fresh", engine: true });
  await fresh.connect();
  for (let i = 0; i < 30 && fresh.view.status !== "live"; i++) await sleep(300);
  await sleep(500);
  fresh.close();
  if (fresh.view.status !== "live") return;
  if (Math.abs(fresh.view.seq - client.view.seq) > 0) {
    await sleep(1500); // let the resumed stream catch up
    if (fresh.view.seq > client.view.seq) return; // the game moved meanwhile: not comparable
  }
  const sig = (v) => Object.values(v.decisions).map((d) => `${d.id}@${d.revision}`).sort();
  const a = sig(client.view);
  const b = sig(fresh.view);
  const missing = b.filter((x) => !a.includes(x));
  const extra = a.filter((x) => !b.includes(x));
  if (missing.length || extra.length)
    rec.record({ kind: `engine:${why}-diverges`, detail: `after ${why} at seq ${client.view.seq}: resumed view lacks ${missing.length} (${missing.slice(0, 3).join(",")}), has ${extra.length} extra (${extra.slice(0, 3).join(",")}) vs a fresh snapshot (seq ${fresh.view.seq})`, step, trace: tr() });
}

// ---- checks ----
let prevSnap = null;
let undoChecked = 0;
let waitingSince = null;
let waitedSince = null;
let lastSeq = 0;
let lastSeqAt = Date.now();
let gameOver = false;
let behindSince = null;
let pollMode = false;
let lastPoll = 0;
let lastSave = null;
let lastSaveAt = Date.now();
/** The bot's registry moved on but no engine event reached me: the live stream is silent (resubscribe to keep going). */
async function checkStreamLive() {
  const bot = await botDecisions(game);
  if (!bot || client.view.status !== "live") return;
  const mine = new Map(Object.values(client.view.decisions).map((d) => [d.id, d.revision]));
  const differs = bot.decisions.filter((d) => d.visibility === "public" && mine.get(d.id) !== d.revision).length;
  if (bot.seq > client.view.seq && differs && Date.now() - client.lastEngineAt > 20000) {
    behindSince ??= Date.now();
    if (Date.now() - behindSince > 60000) {
      rec.record({ kind: "engine:stream-silent", detail: `no engine event over ws for ${Math.round((Date.now() - client.lastEngineAt) / 1000)} s while the bot's registry moved from seq ${client.view.seq} to ${bot.seq} (${differs} public decisions differ); resubscribing`, step, trace: tr() });
      behindSince = null;
      client.subscribeEngine(true);
      if (!pollMode) say("   live stream silent: re-snapshotting every 15 s from now on (like a user reloading)");
      pollMode = true;
    }
  } else behindSince = null;
}

async function checkAll(after) {
  await checkStreamLive();
  for (const e of errTail.poll())
    rec.record({ kind: "bot:handler-error", detail: `${e.handler}: ${e.exc}${e.who ? ` (pressed by ${e.who}${e.button ? ` [${e.button}]` : ""})` : ""}`, step, trace: tr(), botlog: e.text });
  const snap = await snapshotOf(game, `step${step}`);
  if (snap.save && snap.save !== lastSave) (lastSave = snap.save), (lastSaveAt = Date.now());
  if (!snap.web) return;
  const undoSince = undoAt > undoChecked;
  undoChecked = Date.now();
  for (const v of invariantViolations(prevSnap, snap, { undoSince }))
    rec.record({ kind: `invariant:${v.id}`, severity: v.severity, detail: `${v.player ? v.player + ": " : ""}${v.message}`, context: `round ${snap.web.gameRound} ${snap.web.gameState?.phase}; after ${after}; last save: ${snap.label ?? "?"}`, step, trace: tr() });
  prevSnap = { ...snap, save: snap.save };
  if (snap.web.gameState?.winner || /finished/.test(snap.web.gameState?.phase ?? "")) gameOver = true;
}

function checkStall() {
  const st = client.view.state;
  if (client.view.seq !== lastSeq) (lastSeq = client.view.seq), (lastSeqAt = Date.now());
  if (!st) return;
  const waitingList = [st.setup?.waitingOn, st.status?.waitingOn, st.agenda?.waitingOn].filter(Array.isArray).flat();
  const waitingOnMe = (st.activePlayer === ME && /^(strategy|action|agendaVoting|agenda)/.test(st.phase ?? "")) || waitingList.includes(ME);
  if (waitingOnMe) (waitedSince ??= Date.now());
  else waitedSince = null;
  if (waitedSince && Date.now() - waitedSince > 6 * 60000) {
    rec.record({ kind: "stall:waiting-on-me-long", severity: "warn", detail: `round ${st.round} ${st.phase}: the game has waited on me for ${Math.round((Date.now() - waitedSince) / 60000)} min (setup ${JSON.stringify(st.setup?.players?.find((p) => p.userId === ME) ?? null)}); my open decisions: ${myDecisions(client.view, ME).map((d) => d.kind).join(", ") || "none"}`, step, trace: tr() });
    waitedSince = Date.now();
  }
  const mine = myDecisions(client.view, ME);
  const legacyMine = legacyCandidates().filter((c) => c.own && c.w > 0);
  if (waitingOnMe && !mine.length && !legacyMine.length) {
    waitingSince ??= Date.now();
    if (Date.now() - waitingSince > STALL_S * 1000) {
      rec.record({ kind: "stall:my-turn-no-prompt", detail: `round ${st.round} ${st.phase}: I am the active player for ${Math.round((Date.now() - waitingSince) / 1000)} s with no decision awaiting me and no own button (open decisions: ${Object.values(client.view.decisions).map((d) => `${d.kind}->${d.target?.faction ?? d.scope}`).slice(0, 8).join(", ")})`, step, trace: tr() });
      waitingSince = Date.now();
    }
  } else waitingSince = null;
  if (Date.now() - lastSaveAt > 5 * 60000) {
    const active = st.players?.find((p) => p.userId === st.activePlayer);
    rec.record({ kind: "stall:game-idle", severity: "warn", detail: `the game was not saved for ${Math.round((Date.now() - lastSaveAt) / 60000)} min in round ${st.round} ${st.phase}; active ${active?.faction ?? st.activePlayer}${active?.userId === ME ? " (me)" : ""}`, step, trace: tr() });
    lastSaveAt = Date.now();
  }
}

// ---- main loop ----
await checkAll("start");
let idle = 0;
while (Date.now() < deadline && step < maxSteps && !gameOver) {
  await sleep(500 + rng.int(1200));
  if (!(await stackHealthy())) {
    await waitForStack(say);
    prevSnap = null; // no sequence check across a restart
    waitingSince = null;
    waitedSince = null;
    lastSaveAt = Date.now();
    client.subscribeEngine(true);
    await sleep(3000);
  }
  if (pollMode && Date.now() - lastPoll > 15000) {
    lastPoll = Date.now();
    client.subscribeEngine(true);
    await sleep(800);
  }
  checkStall();
  const mine = myDecisions(client.view, ME);
  const legacy = legacyCandidates();
  // Only the newest UNDO (one step back); older ones rewind further than a player usually would.
  const undoBtns = client.gameMessages().slice(-40).flatMap((m) => controlsOf(m.components).filter((c) => /^ultimateUndo_/.test(c.id)).map((c) => ({ m, c, own: true, w: 1 }))).slice(-1);
  const action = rng.weighted([
    [mine.length ? 55 : 0, "mine"],
    [mine.length ? 15 : 0, "mine-legacy"],
    [legacy.length ? (mine.length ? 8 : 25) : 0, "legacy"],
    [undoBtns.length ? 1.2 : 0, "undo"],
    [3, "foreign"],
    [answered.size ? 3 : 0, "stale"],
    [2, "garbage"],
    [2, "reconnect"],
    [mine.length || legacy.length ? 0 : 10, "wait"],
  ]);
  if (action === "wait") {
    if (++idle % 10 === 0) await checkAll("idle");
    continue;
  }
  idle = 0;
  step++;
  let did = false;
  if (action === "mine") did = await doMine();
  else if (action === "mine-legacy") {
    const ids = new Set(mine.map((d) => d.source?.messageId));
    did = await pressLegacy(legacy.filter((x) => ids.has(x.m.id)).map((x) => ({ ...x, w: 1 })));
  } else if (action === "legacy") did = await pressLegacy(legacy);
  else if (action === "undo") did = await pressLegacy(undoBtns);
  else if (action === "foreign") did = await doForeign();
  else if (action === "stale") did = await doStale();
  else if (action === "garbage") did = await doGarbage();
  else if (action === "reconnect") did = await doReconnect();
  if (!did) {
    step--;
    continue;
  }
  await sleep(1500);
  await checkAll(action);
  if (step % 25 === 0) await compareWithFresh("stream");
}

say(`done: ${step} steps, ${rec.list.length} violations, game ${game}${gameOver ? " (game over)" : ""}; round ${client.view.state?.round} ${client.view.state?.phase}`);
writeFileSync(`${runDir}/trace.json`, JSON.stringify({ seed, game, seat: seatName, steps: step, violations: rec.list, trace }, null, 1));
client.close();
if (created && !args.keep && endGame(game, seat.token, say)) writeFileSync(`${runDir}/game`, `${game}\ncreated\nended\n`);
process.exit(0);
