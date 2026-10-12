#!/usr/bin/env node
// Runs declarative engine scenarios (tests/engine/scenarios/*.json|*.mjs) on fork games of the live bot.
//
//   node tests/engine/scenario.mjs <scenario file|name> [--diff] [--via engine|press] [--forks pbdA,pbdB] [--keep]
//        [--json] [--out report.json] [--quiet]
//   node tests/engine/scenario.mjs --list            scenarios in tests/engine/scenarios/
//   node tests/engine/scenario.mjs --commands ac     the bot's slash commands (sub-commands, options) matching "ac"
//
// A scenario (see tests/engine/BACKTEST.md for the full format):
//   { name, description,
//     base:    { recording: "pbd75", index: 640 } | { game: "pbd113", index?: 50 } | { save: "path.txt" } | "fresh6p",
//     setup:   [ "/tech add tech:gd faction_or_color:${seat1}", { command: "ac draw_specific_ac", options: {...}, as: "seat1" } ],
//     trigger: { press: "<custom id>", as } | { command: "/…" } | { answer: {...} },
//     steps:   [ { answer: { kind: "strategy_card.pick", option: "regex on option id/label", value: { strategyCard: 3 } }, as },
//                { answer: { kind: "payment.spend", payload: {...} }, as, legacy: [ { press: "…" } ] }, { press }, { command } ],
//     expect:  { invariants: true, state: [ { path: "players[faction=xxcha].tg", eq: 3 } ], save: [ { key: "game.phase_of_game", eq: "action" } ] } }
//   "as": "seat1".."seat8" | a faction | a user id (default seat1). Strings may use ${seat1}…${seat8}, ${fork},
//   ${faction:xxcha} (that faction's user id), ${color:red}.
//
// Default (no --diff): one fork, answers through the engine (--via press: through button presses).
// --diff: TWO forks run the same scenario, one with legacy button presses (the original code's behaviour = ground
//   truth) and one with engine answers; after every step the normalized saves are diffed (first divergence reported).
// Invariants (lib/invariants.ts) are checked on the fork's save after every step. Exit 1 on any failure.
// Forks: --forks reuses existing forks (comma-separated, 1 or 2); otherwise forks are created and their names
// printed (pass them back with --forks next time: forks are reusable; the bot is shared).
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ENGINE_DIR, RECORDINGS_DIR, ensureRunDir, gameFile, shimState, sleep, undoFile, waitForStack } from "./lib/env.ts";
import { createFork, openFork, closeFork, clientFor, identityMap, latestUndo, loadSave, mapIdsInCustomId, mirrorUserSettings, seatMap, waitForSaves } from "./lib/fork.ts";
import { gameChannels, loadRecording, recordingSaves } from "./lib/recording.ts";
import { parseSave, normalizeSave, diffNormalized } from "./lib/savefile.ts";
import { controlsOf } from "./lib/shim.ts";
import { checkSnapshot } from "./lib/invariants.ts";
import { answer, act, openDecisions, optionFor, engineState } from "./lib/engine.ts";
import { newNonce } from "./lib/materialize.ts";

const SCEN_DIR = join(ENGINE_DIR, "scenarios");
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const short = (s, n = 110) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

/* ------------------------------------------------------------------ slash commands from the shim's registry */

function commandSchema() {
  const cmds = shimState().commands;
  return Array.isArray(cmds) ? cmds : Object.values(cmds ?? {});
}

if (flag("--commands")) {
  const q = new RegExp(opt("--commands", "") || ".", "i");
  for (const c of commandSchema()) {
    const subs = (c.options ?? []).filter((o) => o.type === 1 || o.type === 2);
    const describe = (o) => `${o.name}${o.required ? "" : "?"}:${{ 3: "str", 4: "int", 5: "bool", 6: "user", 7: "channel", 8: "role", 10: "num", 11: "file" }[o.type] ?? o.type}`;
    if (!subs.length) {
      if (q.test(c.name)) console.log(`/${c.name} ${(c.options ?? []).map(describe).join(" ")}`);
      continue;
    }
    for (const s of subs) {
      const leaves = s.type === 2 ? (s.options ?? []).map((x) => [`${s.name} ${x.name}`, x]) : [[s.name, s]];
      for (const [n, x] of leaves) if (q.test(`${c.name} ${n}`)) console.log(`/${c.name} ${n} ${(x.options ?? []).map(describe).join(" ")}`);
    }
  }
  process.exit(0);
}

if (flag("--list")) {
  for (const f of existsSync(SCEN_DIR) ? readdirSync(SCEN_DIR).filter((f) => /\.(json|mjs)$/.test(f)) : []) {
    const s = await loadScenario(join(SCEN_DIR, f)).catch((e) => ({ description: `(unreadable: ${e.message})` }));
    console.log(`${f.padEnd(40)} ${short(s.description ?? s.name ?? "", 100)}`);
  }
  process.exit(0);
}

/** "/ac draw_specific_ac ac_id:sabo1 faction_or_color:red" | {command: "ac draw_specific_ac", options: {…}} → [name, discord options]. */
function buildCommand(spec, ctx) {
  let path, values;
  if (typeof spec === "string") {
    const toks = [...spec.replace(/^\//, "").matchAll(/(\w+):"([^"]*)"|(\w+):(\S+)|(\S+)/g)];
    path = toks.filter((t) => t[5]).map((t) => t[5]);
    values = Object.fromEntries(toks.filter((t) => !t[5]).map((t) => (t[1] ? [t[1], t[2]] : [t[3], t[4]])));
  } else {
    path = spec.command.replace(/^\//, "").split(/\s+/);
    values = spec.options ?? {};
  }
  const [name, ...subs] = path;
  const root = commandSchema().find((c) => c.name === name);
  if (!root) throw new Error(`unknown slash command /${name} (see --commands)`);
  let node = root;
  const chain = [];
  for (const s of subs) {
    const n = (node.options ?? []).find((o) => o.name === s && (o.type === 1 || o.type === 2));
    if (!n) throw new Error(`/${name}: unknown sub-command ${s} (have: ${(node.options ?? []).filter((o) => o.type <= 2).map((o) => o.name).join(", ")})`);
    chain.push(n);
    node = n;
  }
  const leaf = [];
  for (const [k, raw] of Object.entries(values)) {
    const o = (node.options ?? []).find((x) => x.name === k);
    if (!o) throw new Error(`/${path.join(" ")}: unknown option ${k} (have: ${(node.options ?? []).map((x) => x.name).join(", ")})`);
    let v = typeof raw === "string" ? interp(raw, ctx) : raw;
    if (o.type === 4 || o.type === 10) v = Number(v);
    if (o.type === 5) v = v === true || v === "true" || v === "yes";
    if (o.type === 6) v = userOf(String(v), ctx);
    leaf.push({ type: o.type, name: k, value: v });
  }
  let options = leaf;
  for (const n of chain.reverse()) options = [{ type: n.type, name: n.name, options }];
  return [name, options];
}

/* ------------------------------------------------------------------ seats, interpolation */

function players(fork) {
  return parseSave(readFileSync(gameFile(fork.game), "utf8")).players;
}

function userOf(who, ctx) {
  if (!who) return ctx.fork.seats[0].user_id;
  const m = /^seat(\d)$/.exec(who);
  if (m) return ctx.fork.seats[Number(m[1]) - 1].user_id;
  if (/^\d{15,20}$/.test(who)) return who;
  const p = players(ctx.fork).find((x) => x.kv.get("faction") === who || x.kv.get("color") === who);
  if (!p) throw new Error(`no seat with faction/colour ${who} in ${ctx.fork.game}`);
  return p.userId;
}

function interp(s, ctx) {
  return s
    .replace(/\$\{seat(\d)\}/g, (_, n) => ctx.fork.seats[Number(n) - 1].user_id)
    .replace(/\$\{fork\}/g, ctx.fork.game)
    .replace(/\$\{(faction|color):([\w-]+)\}/g, (_, k, v) => userOf(v, ctx));
}

/* ------------------------------------------------------------------ base */

async function loadScenario(path) {
  if (path.endsWith(".mjs")) return (await import(pathToFileURL(resolve(path)).href)).default;
  return JSON.parse(readFileSync(path, "utf8"));
}

function findFresh6p() {
  // First action-phase round-1 save of a recorded 6-player Thunder's Edge game.
  for (const f of readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const rec = loadRecording(join(RECORDINGS_DIR, f));
    if (rec.players.length !== 6) continue;
    for (const s of recordingSaves(rec)) {
      if (/^phase_of_game action$/m.test(s.text) && /^round 1$/m.test(s.text) && /thunders|te_/i.test(s.text)) return { text: s.text, from: `${rec.game}@${s.index}`, rec };
    }
  }
  throw new Error("no recorded 6p TE game reaches the action phase (base fresh6p); use { game, index } instead");
}

function baseSave(base) {
  if (base === "fresh6p" || base?.fresh) return findFresh6p();
  if (base.recording) {
    const p = existsSync(base.recording) ? base.recording : join(RECORDINGS_DIR, `${base.recording.replace(/\.json$/, "")}.json`);
    const rec = loadRecording(p);
    const saves = recordingSaves(rec);
    const s = base.index == null ? saves.at(-1) : saves.find((x) => x.index === base.index);
    if (!s) throw new Error(`${rec.game} has no save ${base.index} (saves ${saves[0].index}..${saves.at(-1).index})`);
    const next = saves[saves.indexOf(s) + 1];
    return { text: s.text, from: `${rec.game}@${s.index}`, rec, next: next?.text };
  }
  if (base.game) {
    const f = base.index == null ? gameFile(base.game) : undoFile(base.game, base.index);
    const nf = base.index == null ? null : undoFile(base.game, base.index + 1);
    return { text: readFileSync(f, "utf8"), from: `${base.game}@${base.index ?? "live"}`, next: nf && existsSync(nf) ? readFileSync(nf, "utf8") : undefined };
  }
  if (base.save) return { text: readFileSync(base.save, "utf8"), from: base.save };
  throw new Error(`bad base ${JSON.stringify(base)}`);
}

/* ------------------------------------------------------------------ one fork running the scenario */

class Runner {
  constructor(fork, via, label) {
    this.fork = fork;
    this.via = via; // "engine" | "press"
    this.label = label;
    this.ctx = { fork };
    this.violations = [];
  }

  async load(base) {
    const map = seatMap(this.fork, base.text, new Map((base.rec?.players ?? []).map((p) => [p.userId, p.username])));
    mirrorUserSettings(map, base.rec?.userSettings);
    // Re-post the prompt that was on screen at this save: the next save's saved_buttons are the prompt its action
    // pressed (what an undo would re-post). Set base.repost: false to load without it.
    let carrier;
    const saved = base.next && base.repost !== false ? /^saved_buttons (.+)$/m.exec(base.next)?.[1] : undefined;
    if (saved) {
      const raw = mapIdsInCustomId(saved, map);
      const msg = /^saved_message (.*)$/m.exec(base.next)?.[1];
      carrier = { raw, customId: raw.split(",")[0].split(";")[1], label: "", channelId: this.fork.actionsId, watcher: this.fork.seats[0].user_id, message: msg ? mapIdsInCustomId(msg, map).slice(0, 1800) : undefined };
    }
    const m = await loadSave(this.fork, base.text, map, carrier, newNonce());
    if (carrier) log(`${this.label}: ${m ? "re-posted" : "could NOT re-post"} the prompt of the next save (${short(carrier.raw, 80)})`);
    await waitForSaves(this.fork.game, latestUndo(this.fork.game) - 1, 8000, 1000);
  }

  async settle(since) {
    return waitForSaves(this.fork.game, since, 15000, 1200);
  }

  save() {
    return readFileSync(gameFile(this.fork.game), "utf8");
  }

  /** Runs one step; returns {ok, error?, detail}. */
  async step(st) {
    const since = latestUndo(this.fork.game);
    // legacy presses act as the step's seat unless they name their own
    const r = await this.perform(this.via === "press" && st.legacy ? st.legacy.map((l) => ({ as: st.as, ...l })) : [st]);
    const s = await this.settle(since);
    return { ...r, saves: s.saves };
  }

  async perform(list) {
    let last = { ok: true };
    for (const st of list) {
      last = await this.one(st);
      if (!last.ok) return last;
    }
    return last;
  }

  async one(st) {
    const user = userOf(st.as, this.ctx);
    const c = await clientFor(this.fork, user);
    if (st.wait) {
      await sleep(st.wait);
      return { ok: true };
    }
    if (st.command) {
      const [name, options] = buildCommand(typeof st.command === "string" && !st.options ? st.command : { command: st.command, options: st.options }, this.ctx);
      const r = await c.command(this.fork.actionsId, name, options);
      return r.error ? { ok: false, error: `/${name}: ${r.error}` } : { ok: true, detail: `/${name}` };
    }
    if (st.press) return this.press(interp(st.press, this.ctx), user, st);
    if (st.answer) return this.answerStep(st.answer, user);
    return { ok: false, error: `unknown step ${JSON.stringify(st)}` };
  }

  /** A recorded/known custom id: engine → answer the decision carrying it; press → click the message carrying it. */
  async press(customId, user, st) {
    let carrier = this.carrying(customId, user);
    if (this.via === "engine") {
      const ds = await openDecisions(this.fork.game);
      let hit = ds.sort((a, b) => b.seq - a.seq).map((d) => ({ d, o: optionFor(d, customId) })).find((x) => x.o);
      if (!hit) {
        const m = await this.carrier(customId, user, st);
        if (!m) return { ok: false, error: `no prompt carries ${customId}` };
        for (let i = 0; i < 20 && !hit; i++) {
          const d = (await openDecisions(this.fork.game)).find((x) => x.id === `d${m.id}`);
          if (d) hit = { d, o: optionFor(d, customId) };
          else await sleep(300);
        }
        if (!hit?.o) return { ok: false, error: `the engine did not capture the carrier of ${customId}` };
      }
      const a = await answer(this.fork.game, hit.d.id, user, { optionId: hit.o.id });
      return a.ok || a.status === "needs_input" ? { ok: true, detail: `${hit.d.kind}/${hit.o.id} ${a.path ?? ""}`, kind: hit.d.kind } : { ok: false, error: `engine refused ${hit.d.kind}/${hit.o.id}: ${a.httpStatus} ${a.status} ${a.error}`, refused: true };
    }
    if (!carrier) carrier = await this.carrier(customId, user, st);
    if (!carrier) return { ok: false, error: `no message carries ${customId}` };
    const c = await clientFor(this.fork, user);
    const r = await c.click(carrier.channel_id, carrier.id, customId);
    return r.error ? { ok: false, error: `press ${customId}: ${r.error}` } : { ok: true, detail: `press ${customId}` };
  }

  carrying(customId, user) {
    const c = this.fork.clients.get(user);
    // Only this fork's channels: with --diff both forks seat the same users, so a client also sees the other
    // fork's messages (a legacy press must never click the engine fork's copy of a button, or vice versa).
    const mine = gameChannels({ channels: Object.fromEntries(c?.channels ?? []) }, this.fork.game);
    let best = null;
    for (const [chId, msgs] of c?.messages.entries() ?? []) {
      if (mine.size && !mine.has(chId)) continue;
      for (const m of msgs.values()) if (controlsOf(m.components).some((x) => x.id === customId) && (!best || BigInt(m.id) > BigInt(best.id))) best = m;
    }
    return best;
  }

  /** Re-load the fork's own state with a carrier message holding the button (like replay chain mode). */
  async carrier(customId, user, st) {
    const faction = players(this.fork).find((p) => p.userId === user)?.kv.get("faction");
    return loadSave(this.fork, this.save(), identityMap(this.fork), { customId, label: st.label ?? customId, faction, channelId: this.fork.actionsId, watcher: user });
  }

  /** {kind, option?, value?, payload?, values?, inputs?, action?, body?} */
  async findDecision(spec, user, timeoutMs = 8000) {
    const kind = spec.kind instanceof RegExp ? spec.kind : spec.kind?.startsWith("/") ? new RegExp(spec.kind.slice(1, -1)) : spec.kind;
    const end = Date.now() + timeoutMs;
    while (true) {
      const ds = (await openDecisions(this.fork.game))
        .filter((d) => !kind || (typeof kind === "string" ? d.kind === kind : kind.test(d.kind)))
        .filter((d) => (d.scope === "table" ? !d.window || d.window.eligible?.includes(user) : !d.target?.userId || d.target.userId === user))
        .sort((a, b) => b.seq - a.seq);
      if (ds.length) return ds;
      if (Date.now() > end) return [];
      await sleep(400);
    }
  }

  pickOption(d, spec) {
    const opts = d.options.filter((o) => !o.disabled);
    if (spec.option) {
      const re = new RegExp(spec.option, "i");
      return opts.find((o) => o.id === spec.option) ?? opts.find((o) => re.test(o.id) || re.test(o.label ?? ""));
    }
    if (spec.value) return opts.find((o) => o.value && Object.entries(spec.value).every(([k, v]) => JSON.stringify(o.value[k]) === JSON.stringify(v)));
    return undefined;
  }

  async answerStep(spec, user) {
    const ds = await this.findDecision(spec, user);
    if (!ds.length) return { ok: false, error: `no open ${spec.kind ?? "decision"} for ${user}` };
    if (spec.payload || spec.inputs || spec.values || spec.action) {
      if (this.via === "press") return { ok: false, error: `${spec.kind}: payload/inputs/action answers have no button equivalent; give the step a "legacy": [presses] list` };
      const d = ds[0];
      const a = spec.action
        ? await act(this.fork.game, d.id, spec.action, user, spec.body ?? {})
        : await answer(this.fork.game, d.id, user, { ...(spec.optionId ? { optionId: spec.optionId } : {}), ...(spec.payload ? { payload: spec.payload } : {}), ...(spec.values ? { values: spec.values } : {}), ...(spec.inputs ? { inputs: spec.inputs, optionId: spec.optionId ?? "submit" } : {}) });
      return a.ok || a.status === "needs_input" ? { ok: true, detail: `${d.kind} ${a.status} ${a.path ?? ""}`, kind: d.kind } : { ok: false, refused: true, error: `engine refused ${d.kind}: ${a.httpStatus} ${a.status} ${a.error}` };
    }
    for (const d of ds) {
      const o = this.pickOption(d, spec);
      if (!o) continue;
      if (this.via === "engine") {
        const a = await answer(this.fork.game, d.id, user, { optionId: o.id });
        return a.ok || a.status === "needs_input" ? { ok: true, detail: `${d.kind}/${o.id} ${a.path ?? ""}`, kind: d.kind } : { ok: false, refused: true, error: `engine refused ${d.kind}/${o.id}: ${a.httpStatus} ${a.status} ${a.error}` };
      }
      // Legacy: press the same component on the prompt message, as a player would.
      const c = await clientFor(this.fork, user);
      const [menu, value] = String(o.id).split("#");
      const r = value != null ? await c.select(d.source.channelId, d.source.messageId, menu, [value]) : await c.click(d.source.channelId, d.source.messageId, o.id);
      return r.error ? { ok: false, error: `press ${o.id}: ${r.error}` } : { ok: true, detail: `press ${d.kind}/${o.id}`, kind: d.kind };
    }
    return { ok: false, error: `no ${spec.kind} option matches ${JSON.stringify(spec.option ?? spec.value)} (options: ${ds[0].options.map((o) => o.id).slice(0, 12).join(", ")})` };
  }

  invariants(id, label) {
    const vs = checkSnapshot({ id, label, save: this.save(), web: null }).filter((v) => v.severity === "error");
    this.violations.push(...vs);
    return vs;
  }
}

/* ------------------------------------------------------------------ expectations */

function getPath(obj, path) {
  let cur = obj;
  for (const part of path.match(/[^.[\]]+|\[[^\]]*\]/g) ?? []) {
    if (cur == null) return undefined;
    if (part.startsWith("[")) {
      const inner = part.slice(1, -1);
      const eq = /^(\w+)=(.*)$/.exec(inner);
      cur = eq ? (Array.isArray(cur) ? cur : Object.values(cur)).find((x) => String(x?.[eq[1]]) === eq[2]) : cur[Number(inner)];
    } else cur = cur[part];
  }
  return cur;
}

function checkValue(actual, e) {
  if ("eq" in e && JSON.stringify(actual) !== JSON.stringify(e.eq)) return `expected ${JSON.stringify(e.eq)}, got ${JSON.stringify(actual)}`;
  if ("ne" in e && JSON.stringify(actual) === JSON.stringify(e.ne)) return `expected not ${JSON.stringify(e.ne)}`;
  if ("gte" in e && !(Number(actual) >= e.gte)) return `expected >= ${e.gte}, got ${JSON.stringify(actual)}`;
  if ("lte" in e && !(Number(actual) <= e.lte)) return `expected <= ${e.lte}, got ${JSON.stringify(actual)}`;
  if ("includes" in e && !(Array.isArray(actual) ? actual.some((x) => JSON.stringify(x) === JSON.stringify(e.includes) || x === e.includes) : String(actual ?? "").includes(e.includes))) return `expected to include ${JSON.stringify(e.includes)}, got ${short(JSON.stringify(actual), 200)}`;
  if ("excludes" in e && (Array.isArray(actual) ? actual.includes(e.excludes) : String(actual ?? "").includes(e.excludes))) return `expected not to include ${JSON.stringify(e.excludes)}`;
  if ("match" in e && !new RegExp(e.match).test(String(actual ?? ""))) return `expected /${e.match}/, got ${short(JSON.stringify(actual), 200)}`;
  if (e.exists === true && actual === undefined) return "expected to exist";
  if (e.exists === false && actual !== undefined) return `expected not to exist, got ${short(JSON.stringify(actual), 120)}`;
  return null;
}

async function checkExpect(run, expect) {
  const fails = [];
  if (!expect) return fails;
  if (expect.state?.length) {
    const st = await engineState(run.fork.game);
    for (const e of expect.state) {
      const err = checkValue(getPath(st, interp(e.path, run.ctx)), e);
      if (err) fails.push(`state ${e.path}: ${err}`);
    }
  }
  if (expect.save?.length) {
    const lines = normalizeSave(run.save(), { forkGame: run.fork.game, origGame: "fork" });
    for (const e of expect.save) {
      const key = interp(e.key, run.ctx);
      const line = lines.find((l) => l.startsWith(`${key} `) || l === key);
      const err = checkValue(line == null ? undefined : line.slice(key.length + 1), e);
      if (err) fails.push(`save ${e.key}: ${err}`);
    }
  }
  if (expect.decision) {
    // { kind, as?, open: true|false }
    for (const e of [].concat(expect.decision)) {
      const ds = (await openDecisions(run.fork.game)).filter((d) => d.kind === e.kind && (!e.as || d.target?.userId === userOf(e.as, run.ctx)));
      if ((e.open ?? true) !== ds.length > 0) fails.push(`decision ${e.kind}${e.as ? ` for ${e.as}` : ""}: expected ${(e.open ?? true) ? "open" : "closed"}`);
    }
  }
  return fails;
}

/* ------------------------------------------------------------------ main */

const target = argv.find((a, i) => !a.startsWith("--") && !["--forks", "--via", "--out"].includes(argv[i - 1]));
if (!target) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(2);
}
const file = existsSync(target) ? target : [join(SCEN_DIR, target), join(SCEN_DIR, `${target}.json`), join(SCEN_DIR, `${target}.mjs`)].find(existsSync);
if (!file) throw new Error(`no scenario ${target}`);
const sc = await loadScenario(file);
const diffMode = flag("--diff");
const quiet = flag("--quiet");
await waitForStack(undefined, log);

const base = baseSave(sc.base ?? "fresh6p");
const forkNames = (opt("--forks", "") || "").split(",").filter(Boolean);
const need = diffMode ? 2 : 1;
const forks = [];
for (let i = 0; i < need; i++) forks.push(forkNames[i] ? await openFork(forkNames[i]) : await createFork(8, log));
log(`scenario ${sc.name ?? basename(file)} from ${base.from} on ${forks.map((f) => f.game).join(" + ")}${diffMode ? " (diff: legacy vs engine)" : ""}`);
const runs = diffMode ? [new Runner(forks[0], "press", "legacy"), new Runner(forks[1], "engine", "engine")] : [new Runner(forks[0], opt("--via", "engine"), opt("--via", "engine"))];

const report = { scenario: sc.name ?? basename(file), file, base: base.from, forks: forks.map((f) => f.game), diff: diffMode, steps: [], failures: [] };
const fail = (m) => {
  report.failures.push(m);
  console.log(`  FAIL ${m}`);
};

for (const r of runs) await r.load({ ...base, repost: sc.base?.repost });
const all = [...(sc.setup ?? []).map((s) => ({ phase: "setup", st: typeof s === "string" ? { command: s } : s })), ...(sc.trigger ? [{ phase: "trigger", st: sc.trigger }] : []), ...(sc.steps ?? []).map((s) => ({ phase: "step", st: s }))];
let n = 0;
let firstDiff = null;
for (const { phase, st } of all) {
  n++;
  const res = [];
  for (const r of runs) {
    // setup commands are the same on every fork (always commands / presses, never "the thing under test")
    const out = await r.step(st).catch((e) => ({ ok: false, error: e.message }));
    const vs = r.invariants(`${phase}${n}`, JSON.stringify(st));
    res.push({ fork: r.fork.game, via: r.label, ...out, invariants: vs.map((v) => `${v.id}: ${v.message}`) });
  }
  let diffs;
  if (diffMode) {
    const [a, b] = runs.map((r) => normalizeSave(r.save(), { forkGame: r.fork.game, origGame: "fork" }));
    diffs = diffNormalized(a, b);
    if (diffs.length && !firstDiff) firstDiff = { step: n, phase, st, diffs: diffs.slice(0, 20) };
  }
  report.steps.push({ n, phase, step: st, results: res, diffs: diffs?.slice(0, 20) });
  const desc = st.command ? `/${String(st.command).replace(/^\//, "")}` : st.press ? `press ${st.press}` : st.answer ? `answer ${st.answer.kind ?? ""} ${JSON.stringify(st.answer.option ?? st.answer.value ?? st.answer.payload ?? st.answer.action ?? "")}` : JSON.stringify(st);
  const status = res.map((x) => `${x.via}:${x.ok ? "ok" : x.refused ? "REFUSED" : "ERR"}${x.saves != null ? `(${x.saves} saves)` : ""}`).join(" ");
  if (!quiet || res.some((x) => !x.ok) || diffs?.length) console.log(`${String(n).padStart(3)} ${phase.padEnd(7)} ${short(desc, 70).padEnd(70)} ${status}${diffs ? (diffs.length ? ` DIFF ${diffs.length}` : " same") : ""}`);
  for (const x of res) {
    if (!x.ok) fail(`${phase} ${n} (${x.via}): ${x.error}`);
    for (const v of x.invariants) fail(`${phase} ${n} (${x.via}) invariant ${v}`);
  }
  if (diffs?.length) for (const d of diffs.slice(0, 6)) console.log(`        ${d.key}${d.orderOnly ? " (order)" : ""}: legacy ${short(d.expected, 60)}  |  engine ${short(d.actual, 60)}`);
}
if (firstDiff) fail(`legacy and engine saves differ from step ${firstDiff.n ?? firstDiff.step} (${firstDiff.phase}) on: ${firstDiff.diffs.slice(0, 5).map((d) => d.key).join(", ")}`);
for (const r of runs) for (const f of await checkExpect(r, sc.expect)) fail(`expect (${r.label}): ${f}`);
report.firstDiff = firstDiff;

const out = opt("--out", join(ensureRunDir(), "reports", `scenario-${(sc.name ?? basename(file)).replace(/[^\w.-]+/g, "_")}${diffMode ? "-diff" : ""}.json`));
mkdirSync(join(ensureRunDir(), "reports"), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1));
for (const f of forks) closeFork(f);
console.log(`\n${report.scenario}: ${report.failures.length ? `FAILED (${report.failures.length})` : "PASSED"} in ${((Date.now() - t0) / 1000).toFixed(0)}s; forks ${forks.map((f) => f.game).join(",")} (reuse with --forks); report ${out}`);
if (flag("--json")) console.log(JSON.stringify(report));
process.exit(report.failures.length ? 1 : 0);
