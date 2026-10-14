#!/usr/bin/env node
// Runs declarative engine scenarios (tests/engine/scenarios/*.json|*.mjs) on fork games of the live bot.
//
//   node tests/engine/scenario.mjs <scenario file|name> [--diff] [--via engine|press] [--forks pbdA,pbdB] [--keep]
//        [--json] [--out report.json] [--quiet]
//   --buttons [--values]: after every step print the prompts (decisions) it opened: kind, target, option ids (+ typed values)
//   node tests/engine/scenario.mjs --list            scenarios in tests/engine/scenarios/
//   node tests/engine/scenario.mjs --commands ac     the bot's slash commands (sub-commands, options) matching "ac"
//
// A scenario (see tests/engine/BACKTEST.md for the full format):
//   { name, description,
//     base:    { recording: "pbd75", index: 640 } | { game: "pbd113", index?: 50 } | { save: "path.txt", next?: "path.txt" } | "fresh6p",
//     setup:   [ "/tech add tech:gd faction_or_color:${seat1}", { command: "ac draw_specific_ac", options: {...}, as: "seat1" } ],
//     trigger: { press: "<custom id>", as } | { command: "/…" } | { answer: {...} },
//     steps:   [ { answer: { kind: "strategy_card.pick", option: "regex on option id/label", value: { strategyCard: 3 } }, as },
//                { answer: { kind: "payment.spend", payload: {...} }, as, legacy: [ { press: "…" } ] }, { press }, { command },
//                { mark: "name" } (remember the latest save), { rewind: "name" | N } (the web rewind to a mark / N saves back),
//                { engine: "rebuild" | "recover" } (the engine's restart-time rebuild / prompt recovery),
//                { answerOn: "<custom id>", pick?: "oldest" } (answer the on-screen message carrying it, no re-post) ],
//     diffIgnore: [ "stored.violatedSystems" ]   (save keys --diff skips: game.<k> | stored.<k> | player.<k>)
//     invariantsIgnore: [ "content.no-homebrew" ]  (invariant ids the base game violates anyway)
//     expect:  { invariants: true, state: [ { path: "players[faction=xxcha].tg", eq: 3 } ], save: [ { key: "game.phase_of_game", eq: "action" } ],
//                channels: { archived: true|false } } }
//   A step may carry its own "expect" (same shape), checked right after it (e.g. a prompt closed mid-flow).
//   A press step with "click": true clicks the button on every fork (a legacy press), never an engine answer.
//   A step with "refused": true expects the engine to refuse it (the legacy fork must still end in the same state).
//   "as": "seat1".."seat8" | a faction | a user id (default seat1). Strings may use ${seat1}…${seat8}, ${fork},
//   ${faction:xxcha} (that faction's user id), ${color:red}.
//
// Default (no --diff): one fork, answers through the engine (--via press: through button presses).
// --diff: TWO forks run the same scenario, one with legacy button presses (the original code's behaviour = ground
//   truth) and one with engine answers; after every step the normalized saves are diffed (first divergence reported).
// Invariants (lib/invariants.ts) are checked on the fork's save after every step. Exit 1 on any failure.
// Forks: by default every run creates fresh forks (one, two with --diff) and ends them when it finishes (or dies;
//   --keep leaves them running for inspection). Concurrent harness-created forks are capped machine-wide
//   (SCEN_MAX_FORKS, default 4; a run waits for a free lease). --forks pbdA[,pbdB] reuses existing forks instead:
//   every message with buttons in them is deleted first (no prompt of an earlier run stays answerable; --no-reset
//   skips this), then the scenario's base save is loaded as usual. Reused forks are never ended.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BOT_URL, SHIM_URL, botToken, ENGINE_DIR, RECORDINGS_DIR, engineApi, ensureRunDir, gameFile, readGameFile, shimState, sleep, undoFile, waitForStack } from "./lib/env.ts";
import { acquireForkLease, createFork, endFork, openFork, closeFork, clientFor, resetFork, identityMap, latestUndo, loadSave, mapIdsInCustomId, mirrorUserSettings, seatMap, waitForSaves } from "./lib/fork.ts";
import { loadRecording, recordingSaves } from "./lib/recording.ts";
import { parseSave, normalizeSave, diffNormalized } from "./lib/savefile.ts";
import { controlsOf } from "./lib/shim.ts";
import { checkSnapshot } from "./lib/invariants.ts";
import { answer, act, openDecisions, optionFor, engineState, timingSummary } from "./lib/engine.ts";
import { newNonce } from "./lib/materialize.ts";

const SCEN_DIR = join(ENGINE_DIR, "scenarios");
/** A kind pattern: exact, or "/regex/". */
const kindMatches = (kind, pat) => (typeof pat === "string" && pat.startsWith("/") && pat.endsWith("/") ? new RegExp(pat.slice(1, -1)).test(kind ?? "") : kind === pat);
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const short = (s, n = 110) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

/* ------------------------------------------------------------------ slash commands from the shim's registry */

let commandCache = null;
function commandSchema() {
  // The registry does not change during a run; the full shim state is large and re-read after every shim save.
  if (commandCache) return commandCache;
  const cmds = shimState().commands;
  return (commandCache = Array.isArray(cmds) ? cmds : Object.values(cmds ?? {}));
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
  return parseSave(readGameFile(fork.game)).players;
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
  if (base.save) {
    // A path, or a file under tests/engine/scenarios/ (saves/…): pinned copies of saves that undo pruning would drop.
    const at = (p) => (existsSync(p) ? p : join(SCEN_DIR, p));
    return { text: readFileSync(at(base.save), "utf8"), from: base.save, next: base.next ? readFileSync(at(base.next), "utf8") : undefined };
  }
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
    return readGameFile(this.fork.game);
  }

  /** Runs one step; returns {ok, error?, detail}. */
  async step(st) {
    const since = latestUndo(this.fork.game);
    if (flag("--buttons")) this.seenSeq = Math.max(0, ...(await openDecisions(this.fork.game).catch(() => [])).map((d) => d.seq ?? 0));
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
    if (st.mark) {
      // Remembers the fork's latest save under a name, for a later { rewind: name }.
      (this.marks ??= {})[st.mark] = latestUndo(this.fork.game);
      return { ok: true, detail: `mark ${st.mark} = save ${this.marks[st.mark]}` };
    }
    if (st.rewind != null) {
      // The web's rewind (POST /api/game/<game>/rewind as a seat of the game) to a mark, or N saves back.
      const index = typeof st.rewind === "number" ? latestUndo(this.fork.game) - st.rewind : this.marks?.[st.rewind];
      if (index == null) return { ok: false, error: `rewind: no mark ${st.rewind}` };
      const seat = this.fork.seats.find((x) => x.user_id === user) ?? this.fork.seats[0];
      const r = await fetch(`${BOT_URL}/api/game/${this.fork.game}/rewind`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${seat.token}` },
        body: JSON.stringify({ index }),
      });
      return r.ok ? { ok: true, detail: `rewind to ${index}` } : { ok: false, error: `rewind to ${index}: ${r.status} ${(await r.text()).slice(0, 200)}` };
    }
    if (st.engine) {
      // { engine: "rebuild" | "recover" }: the engine's restart-time rebuild (re-captures every prompt still on
      // screen) / prompt recovery, as after a bot restart.
      const r = await engineApi(`/${encodeURIComponent(this.fork.game)}/${st.engine}`, {});
      return r.status === 200 ? { ok: true, detail: `${st.engine} ${JSON.stringify(r.body)}` } : { ok: false, error: `${st.engine}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}` };
    }
    if (st.deleteDecision) {
      // { deleteDecision: { kind }, as }: delete the message of the newest open decision of that kind targeted at the
      // step's seat (Bot DELETE through the shim), as if the bot's post had never landed (soak pbd1204: a lost turn prompt).
      const ds = (await openDecisions(this.fork.game)).filter((d) => kindMatches(d.kind, st.deleteDecision.kind) && (!d.target || d.target.userId === user));
      const d = ds.sort((a, b) => b.seq - a.seq)[0];
      if (!d?.source?.messageId) return { ok: false, error: `deleteDecision: no open ${st.deleteDecision.kind} for ${user}` };
      const r = await fetch(`${SHIM_URL}/api/v10/channels/${d.source.channelId}/messages/${d.source.messageId}`, {
        method: "DELETE",
        headers: { authorization: `Bot ${botToken()}` },
      });
      return r.ok ? { ok: true, detail: `deleted ${d.kind} ${d.id}` } : { ok: false, error: `deleteDecision: ${r.status}` };
    }
    if (st.waitDecision) {
      // { waitDecision: { kind, timeoutMs, open? }, as }: wait until a decision of that kind is open for the step's
      // seat (open: false — until none is).
      const t = Date.now();
      const timeout = st.waitDecision.timeoutMs ?? 30000;
      const wantOpen = st.waitDecision.open !== false;
      while (Date.now() - t < timeout) {
        const ds = await openDecisions(this.fork.game).catch(() => null);
        const d = ds?.find((x) => kindMatches(x.kind, st.waitDecision.kind) && (!x.target || x.target.userId === user));
        const secs = ((Date.now() - t) / 1000).toFixed(0);
        if (ds && wantOpen && d) return { ok: true, detail: `${d.kind} ${d.id} open after ${secs} s` };
        if (ds && !wantOpen && !d) return { ok: true, detail: `no ${st.waitDecision.kind} open after ${secs} s` };
        await sleep(2000);
      }
      return { ok: false, error: `waitDecision: ${wantOpen ? "no" : "still a"} ${st.waitDecision.kind} for ${user} after ${timeout / 1000} s` };
    }
    if (st.answerOn) {
      // { answerOn: "<custom id>", pick?: "oldest" | "newest" }: answer the decision of a message already on screen
      // carrying this id (d<message id>) with that option, without re-posting it: a stale prompt (an earlier round's)
      // must not be open, so the engine refuses (give the step "refused": true).
      const id = interp(st.answerOn, this.ctx);
      const m = await this.onScreen(id, st.pick === "oldest");
      if (!m) return { ok: false, error: `no message on screen carries ${id}` };
      const a = await answer(this.fork.game, `d${m.id}`, user, { optionId: id });
      return a.ok || a.status === "needs_input" ? { ok: true, detail: `d${m.id}/${id} ${a.path ?? ""}` } : { ok: false, refused: true, error: `engine refused d${m.id}/${id}: ${a.httpStatus} ${a.status} ${a.error}` };
    }
    if (st.press) return this.press(interp(st.press, this.ctx), user, st);
    if (st.answer) return this.answerStep(st.answer, user);
    if (st.gameAction) {
      // Game-level engine action (e.g. trade.propose): engine side only; the legacy fork runs the step's "legacy" presses.
      if (this.via === "press") return { ok: false, error: `${st.gameAction}: game actions have no button equivalent; give the step a "legacy": [presses] list` };
      const r = await engineApi(`/${encodeURIComponent(this.fork.game)}/actions/${st.gameAction}`, { userId: user, ...JSON.parse(interp(JSON.stringify(st.body ?? {}), this.ctx)) });
      const ok = r.status === 200 && r.body?.ok !== false;
      return ok ? { ok: true, detail: `${st.gameAction} ${r.body?.status ?? ""}` } : { ok: false, refused: true, error: `engine refused ${st.gameAction}: ${r.status} ${r.body?.status ?? ""} ${r.body?.error ?? JSON.stringify(r.body).slice(0, 200)}` };
    }
    return { ok: false, error: `unknown step ${JSON.stringify(st)}` };
  }

  /** A recorded/known custom id: engine → answer the decision carrying it; press → click the message carrying it. */
  async press(customId, user, st) {
    let carrier = this.carrying(customId, user);
    // "click": true clicks the button even on the engine fork (a legacy press: the original handler's own guards).
    if (this.via === "engine" && !st.click) {
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
    // A press chain (legacy: [...]) clicks the next button as soon as the previous click returns; give the bot's reply
    // message a moment to arrive before falling back to a carrier reload (which reloads the fork's save and would undo
    // a press whose save is still being written).
    for (let i = 0; i < 20 && !carrier && st.carrier !== true; i++) {
      await sleep(300);
      carrier = this.carrying(customId, user);
    }
    if (!carrier) carrier = await this.carrier(customId, user, st);
    if (!carrier) return { ok: false, error: `no message carries ${customId}` };
    const c = await clientFor(this.fork, user);
    const r = await c.click(carrier.channel_id, carrier.id, customId);
    return r.error ? { ok: false, error: `press ${customId}: ${r.error}` } : { ok: true, detail: `press ${customId}` };
  }

  /** The oldest / newest message carrying this id in the fork's actions channel or its threads, read from the shim. */
  async onScreen(customId, oldest) {
    const get = async (path) => {
      const r = await fetch(`${SHIM_URL}/api/v10${path}`, { headers: { authorization: `Bot ${botToken()}` } });
      return r.ok ? r.json() : [];
    };
    const threads = ((await get(`/guilds/0/threads/active`)).threads ?? []).filter((t) => t.parent_id === this.fork.actionsId);
    let best = null;
    for (const ch of [this.fork.actionsId, ...threads.map((t) => t.id)]) {
      for (const m of await get(`/channels/${ch}/messages?limit=100`)) {
        if (!controlsOf(m.components).some((x) => x.id === customId)) continue;
        if (!best || (oldest ? BigInt(m.id) < BigInt(best.id) : BigInt(m.id) > BigInt(best.id))) best = m;
      }
    }
    return best;
  }

  carrying(customId, user) {
    const c = this.fork.clients.get(user);
    // Only this fork's channels: with --diff both forks seat the same users, so a client also sees the other
    // fork's messages (a legacy press must never click the engine fork's copy of a button, or vice versa).
    // A channel is skipped only when it is known to belong to ANOTHER game (its name or its parent's name carries
    // that game's pbdN); channels/threads of unknown ownership stay eligible.
    const chans = new Map(c?.channels ?? []);
    // The client may not have been sent every thread; the shim's state file knows all channels.
    try {
      for (const ch of Object.values(shimState().channels ?? {})) if (ch?.id && !chans.has(ch.id)) chans.set(ch.id, ch);
    } catch {}
    const gameOf = (ch) => String(ch?.name ?? "").match(/(?:^|[^a-z0-9])(pbd\d+)(?![0-9])/i)?.[1]?.toLowerCase() ?? null;
    const owner = (id) => {
      const ch = chans.get(id);
      return gameOf(ch) ?? (ch?.parent_id ? gameOf(chans.get(ch.parent_id)) : null);
    };
    const me = String(this.fork.game).toLowerCase();
    let best = null;
    for (const [chId, msgs] of c?.messages.entries() ?? []) {
      const o = owner(chId);
      if (o && o !== me) continue;
      for (const m of msgs.values()) if (controlsOf(m.components).some((x) => x.id === customId) && (!best || BigInt(m.id) > BigInt(best.id))) best = m;
    }
    return best;
  }

  /** Re-load the fork's own state with a carrier message holding the button (like replay chain mode). */
  async carrier(customId, user, st) {
    const faction = players(this.fork).find((p) => p.userId === user)?.kv.get("faction");
    return loadSave(this.fork, this.save(), identityMap(this.fork), { customId, label: st.label ?? customId, faction, channelId: this.fork.actionsId, watcher: user });
  }

  /** The holder of a played strategy card answers its primary outside the follow window (shim types.ts answersOutsideWindow). */
  answersOutsideWindow(d, user) {
    if (d.kind !== "strategy_card.resolve" || !d.window?.subject?.holder) return false;
    return players(this.fork).find((p) => p.userId === user)?.kv.get("faction") === d.window.subject.holder;
  }

  /** {kind, option?, value?, payload?, values?, inputs?, action?, body?} */
  async findDecision(spec, user, timeoutMs = 8000) {
    const kind = spec.kind instanceof RegExp ? spec.kind : spec.kind?.startsWith("/") ? new RegExp(spec.kind.slice(1, -1)) : spec.kind;
    const end = Date.now() + timeoutMs;
    while (true) {
      const ds = (await openDecisions(this.fork.game))
        .filter((d) => !kind || (typeof kind === "string" ? d.kind === kind : kind.test(d.kind)))
        .filter((d) => (d.scope === "table" ? !d.window || d.window.eligible?.includes(user) || this.answersOutsideWindow(d, user) : !d.target?.userId || d.target.userId === user))
        // A reaction window this seat already answered (an earlier card's Sabotage window whose message keeps its
        // buttons, re-captured with a newer seq) sorts after the open ones: ac-combat-shields-direct-hit answered
        // Shields Holding's finished window for Direct Hit's ("You already responded to this window").
        .sort((a, b) => Number(!!a.window?.responded?.includes(user)) - Number(!!b.window?.responded?.includes(user)) || b.seq - a.seq);
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

  /** --buttons: decisions opened by the last step (kind, target, every option id + typed value). */
  async newPrompts() {
    const ds = (await openDecisions(this.fork.game)).filter((d) => (d.seq ?? 0) > (this.seenSeq ?? 0)).sort((a, b) => a.seq - b.seq);
    return ds.map((d) => ({ id: d.id, kind: d.kind, target: d.target?.faction ?? d.target?.userId ?? d.scope, options: d.options.map((o) => ({ id: o.id, label: o.label, value: o.value })) }));
  }

  invariants(id, label) {
    // invariantsIgnore: invariant ids a scenario's base game violates anyway (e.g. content.no-homebrew on an old recording).
    const ignore = new Set(sc.invariantsIgnore ?? []);
    const vs = checkSnapshot({ id, label, save: this.save(), web: null }).filter((v) => v.severity === "error" && !ignore.has(v.id));
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
      // Expected values may name seats too (${faction:sol} = that seat's user id on the fork).
      const ev = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, typeof v === "string" ? interp(v, run.ctx) : v]));
      const err = checkValue(getPath(st, interp(e.path, run.ctx)), ev);
      if (err) fails.push(`state ${e.path}: ${err}`);
    }
  }
  if (expect.save?.length) {
    const lines = normalizeSave(run.save(), { forkGame: run.fork.game, origGame: "fork", keepEngineOnly: true });
    for (const e of expect.save) {
      const key = interp(e.key, run.ctx);
      const line = lines.find((l) => l.startsWith(`${key} `) || l === key);
      const err = checkValue(line == null ? undefined : line.slice(key.length + 1), e);
      if (err) fails.push(`save ${e.key}: ${err}`);
    }
  }
  if (expect.channels) {
    // { archived: true|false }: the fork's tabletalk / actions channels in the shim (archived = in the archive
    // category and hidden from the bot, as after /game end archive_channels). Polled: the bot moves them 15 s after
    // the end and the shim saves its store within 30 s.
    const ids = ["table_talk_channel", "main_game_channel"].map((k) => run.fork.channels.get(k)).filter(Boolean);
    const want = !!expect.channels.archived;
    const archived = (ch) => !!ch?._archived || shimState().channels?.[ch?.parent_id]?.name === "The in-limbo PBD Archive";
    let got;
    for (const end = Date.now() + (expect.channels.withinMs ?? 75000); ; ) {
      got = ids.map((id) => shimState().channels?.[id]);
      if (got.every((ch) => ch && archived(ch) === want) || Date.now() > end) break;
      await sleep(2000);
    }
    const bad = got.filter((ch) => !ch || archived(ch) !== want);
    if (!ids.length || bad.length)
      fails.push(`channels: expected ${want ? "archived" : "restored"}, got ${got.map((ch) => (ch ? `${ch.name} archived=${!!ch._archived} parent=${shimState().channels?.[ch.parent_id]?.name}` : "missing")).join("; ")}`);
  }
  if (expect.decision) {
    // { kind, as?, scope?: "player"|"table", value?: {partial option value or window subject}, open: true|false, count?: n }
    const like = (o, v) => !!o && Object.entries(v).every(([k, x]) => JSON.stringify(o[k]) === JSON.stringify(x));
    for (const e of [].concat(expect.decision)) {
      const ds = (await openDecisions(run.fork.game)).filter(
        // as: the player's own decision, or a table decision whose window lists them as eligible.
        (d) => d.kind === e.kind && (!e.as || d.target?.userId === userOf(e.as, run.ctx) || (d.scope === "table" && !d.target?.userId && !!d.window?.eligible?.includes(userOf(e.as, run.ctx)))) && (!e.scope || d.scope === e.scope)
          && (!e.value || like(d.window?.subject, e.value) || d.options.some((o) => like(o.value, e.value))),
      );
      if (e.count != null) {
        // count: exactly this many such decisions open (e.g. only the newest copy of a re-posted tray / menu).
        if (ds.length !== e.count)
          fails.push(`decision ${e.kind}${e.as ? ` for ${e.as}` : ""}${e.value ? ` ${JSON.stringify(e.value)}` : ""}: expected ${e.count} open, got ${ds.length} (${ds.map((d) => d.id).join(", ")})`);
      } else if ((e.open ?? true) !== ds.length > 0)
        fails.push(`decision ${e.kind}${e.as ? ` for ${e.as}` : ""}${e.scope ? ` (scope ${e.scope})` : ""}: expected ${(e.open ?? true) ? "open" : "closed"}`);
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
// Forks this run created (fresh by default): ended when the run finishes or dies, unless --keep.
const created = [];
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const c of created) {
    if (!flag("--keep")) await endFork(c.fork, log);
    c.lease.release();
  }
  for (const f of forks) closeFork(f);
}
const die = (code) => (e) => {
  if (e) console.error(e?.stack ?? e);
  cleanup().finally(() => process.exit(code));
};
process.on("SIGINT", die(130));
process.on("SIGTERM", die(143));
process.on("uncaughtException", die(1));
process.on("unhandledRejection", die(1));
for (let i = 0; i < need; i++) {
  if (forkNames[i]) {
    // A reused fork: drop every prompt an earlier run left on screen (open windows, payments, turn menus) before the
    // base save is loaded over it (--no-reset skips this).
    const f = await openFork(forkNames[i]);
    forks.push(f);
    if (!flag("--no-reset")) await resetFork(f, log);
    continue;
  }
  const lease = await acquireForkLease(log);
  let f;
  try {
    f = await createFork(8, log);
  } catch (e) {
    lease.release();
    throw e;
  }
  lease.note(f.game);
  created.push({ fork: f, lease });
  forks.push(f);
}
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
    const out = await r.step(st).catch((e) => ({ ok: false, error: `${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message ?? e.cause})` : ""}${process.env.SCEN_STACK ? `\n${e.stack}` : ""}` }));
    if (flag("--buttons")) out.prompts = await r.newPrompts().catch((e) => [`(prompts: ${e.message})`]);
    const vs = r.invariants(`${phase}${n}`, JSON.stringify(st));
    res.push({ fork: r.fork.game, via: r.label, ...out, invariants: vs.map((v) => `${v.id}: ${v.message}`) });
  }
  let diffs;
  if (diffMode) {
    const [a, b] = runs.map((r) => normalizeSave(r.save(), { forkGame: r.fork.game, origGame: "fork", extraVolatile: sc.diffIgnore ?? [] }));
    diffs = diffNormalized(a, b);
    if (diffs.length && !firstDiff) firstDiff = { step: n, phase, st, diffs: diffs.slice(0, 20) };
  }
  report.steps.push({ n, phase, step: st, results: res, diffs: diffs?.slice(0, 20) });
  const desc = st.command ? `/${String(st.command).replace(/^\//, "")}` : st.press ? `press ${st.press}` : st.answer ? `answer ${st.answer.kind ?? ""} ${JSON.stringify(st.answer.option ?? st.answer.value ?? st.answer.payload ?? st.answer.action ?? "")}` : JSON.stringify(st);
  const status = res.map((x) => `${x.via}:${x.ok ? "ok" : x.refused ? "REFUSED" : "ERR"}${x.saves != null ? `(${x.saves} saves)` : ""}`).join(" ");
  if (!quiet || res.some((x) => !x.ok) || diffs?.length) console.log(`${String(n).padStart(3)} ${phase.padEnd(7)} ${short(desc, 70).padEnd(70)} ${status}${diffs ? (diffs.length ? ` DIFF ${diffs.length}` : " same") : ""}`);
  for (const x of res) {
    // "refused": true — the engine is expected to refuse this answer (stricter than the original code, which must then
    // have left the same state: the --diff check below still compares both forks).
    if (st.refused && x.via === "engine") {
      if (!x.refused) fail(`${phase} ${n} (${x.via}): expected the engine to refuse, it answered`);
    } else if (!x.ok) fail(`${phase} ${n} (${x.via}): ${x.error}`);
    for (const v of x.invariants) fail(`${phase} ${n} (${x.via}) invariant ${v}`);
  }
  if (flag("--buttons")) for (const x of res) for (const pr of x.prompts ?? []) {
    if (typeof pr === "string") { console.log(`        [${x.via}] ${pr}`); continue; }
    console.log(`        [${x.via}] ${pr.id} ${pr.kind} -> ${pr.target}: ${pr.options.map((o) => o.id).join(" | ")}`);
    if (flag("--values")) for (const o of pr.options) if (o.value) console.log(`            ${o.id} = ${JSON.stringify(o.value)}`);
  }
  // A step's own "expect" (same shape as the scenario's) is checked right after it, on every fork.
  if (st.expect) for (const r of runs) for (const f of await checkExpect(r, st.expect)) fail(`${phase} ${n} expect (${r.label}): ${f}`);
  if (diffs?.length) for (const d of diffs.slice(0, 6)) console.log(`        ${d.key}${d.orderOnly ? " (order)" : ""}: legacy ${short(d.expected, 60)}  |  engine ${short(d.actual, 60)}`);
}
if (firstDiff) fail(`legacy and engine saves differ from step ${firstDiff.n ?? firstDiff.step} (${firstDiff.phase}) on: ${firstDiff.diffs.slice(0, 5).map((d) => d.key).join(", ")}`);
for (const r of runs) for (const f of await checkExpect(r, sc.expect)) fail(`expect (${r.label}): ${f}`);
report.firstDiff = firstDiff;
// Engine answer latency (bot HTTP + its REST round trips to the shim, game lock): the click-latency benchmark.
const timings = timingSummary();
if (timings) {
  report.answerTimings = { answer: timingSummary("answer"), act: timingSummary("act") };
  console.log(`engine answers: ${timings}${timingSummary("act") ? ` (direct actions ${timingSummary("act")})` : ""}`);
}

const out = opt("--out", join(ensureRunDir(), "reports", `scenario-${(sc.name ?? basename(file)).replace(/[^\w.-]+/g, "_")}${diffMode ? "-diff" : ""}.json`));
mkdirSync(join(ensureRunDir(), "reports"), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1));
await cleanup();
const forkNote = created.length && !flag("--keep") ? `fresh fork${forks.length > 1 ? "s" : ""} ${forks.map((f) => f.game).join(",")} (ended)` : `forks ${forks.map((f) => f.game).join(",")} (reuse with --forks)`;
console.log(`\n${report.scenario}: ${report.failures.length ? `FAILED (${report.failures.length})` : "PASSED"} in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${forkNote}; report ${out}`);
if (flag("--json")) console.log(JSON.stringify(report));
process.exit(report.failures.length ? 1 : 0);
