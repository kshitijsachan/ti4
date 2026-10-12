/*
 * Replays a recording against the live bot, in a fork game, and compares every resulting save with the recorded one.
 *
 * Determinism (see the README of the report / ENGINE notes): the bot's RNG cannot be seeded. Dice come from
 * ThreadLocalRandom (DiceHelper.Die) and decks / slices / objective reveals are shuffled with Collections.shuffle,
 * all unseeded. The only override is DiceHelper.withForcedResults, used by the developer-only /testbed press path,
 * which the shim cannot reach. Decks however live in the save in draw order, so any action whose randomness is "draw
 * the top card" replays exactly from the recorded save. Therefore:
 *
 *   mode "step"   every action k is replayed on top of the recorded save k-1 (the authoritative state), and the
 *                 fork's resulting save is compared with recorded save k. Each step is independent, so one
 *                 nondeterministic step (dice) cannot poison the rest. This is "replay from snapshot N" for every N.
 *   mode "chain"  the recorded save `from` is loaded once and the actions are pressed one after another on the fork's
 *                 own state, as a real replay would. On a divergence the report names the first one; with resync (the
 *                 default) the fork is reset to the recorded save and the chain continues, so dice steps act as
 *                 "replay with the recorded dice": the recorded post-roll state is used as the roll's outcome.
 */
import { readFileSync } from "node:fs";
import { gameFile, waitForStack, type Json } from "./env.ts";
import { clientFor, identityMap, latestUndo, loadSave, mapIdsInCustomId, mirrorUserSettings, seatMap, waitForSaves, type Fork } from "./fork.ts";
import { diffNormalized, normalizeSave, parseSave, type ForkMap, type SaveDiff } from "./savefile.ts";
import { recordingSaves, type Action, type Recording } from "./recording.ts";
import { controlsOf, type ShimClient } from "./shim.ts";
import { forkWebData, newNonce, unfork } from "./materialize.ts";
import { diffWeb, type WebDiff } from "./webdiff.ts";
import { answer, findDecision, type AnswerOutcome } from "./engine.ts";

export type StepStatus = "match" | "dice" | "random" | "reordered" | "diverged" | "skipped" | "error" | "resync" | "not_typed" | "refused";

/** --via engine: what the engine made of the step. */
export type EngineStep = {
  /** decision carrying the recorded button (null: none captured) */
  decision?: string | null;
  kind?: string | null;
  option?: string;
  target?: string | null;
  resolvedBy?: string | null;
  /** answered through the engine (else pressed like the original) */
  answered?: boolean;
  /** engine answer result */
  answerStatus?: string;
  path?: string | null;
  error?: string | null;
  /** not_typed steps: the outcome of the legacy press (match / diverged / dice ...) */
  legacyStatus?: StepStatus;
};
export type StepResult = {
  index: number;
  label: string;
  customId?: string;
  kind: string;
  status: StepStatus;
  why?: string;
  saves?: number;
  diffs?: SaveDiff[];
  recordedDice?: number[];
  replayDice?: number[];
  /** a recorded web-data checkpoint was compared too */
  webChecked?: boolean;
  webDiffs?: WebDiff[];
  /** what the bot posted in the fork during the step (non-matching steps) */
  botSaid?: string[];
  ms?: number;
  engine?: EngineStep;
};

/**
 * Actions whose outcome the bot draws at random (unseeded), besides dice. A divergence on them is "random", not a bug.
 *   jmfA_main_startMilty            Milty slices and faction pool (MiltyRandomSetupService, Collections.shuffle)
 *   milty_order_* / setupStep5_*    seat colour: PlayerColorService shuffles the faction's preferred colours
 *   startOfGameObjReveal, reveal_stage_*   only when the deck must be reshuffled (Game.revealStage1Random)
 */
export const KNOWN_RANDOM: RegExp[] = [/^jmfA_main_startMilty$/, /^milty_order_\d+$/, /^setupStep5_/, /^milty_faction_/];

const DIE = /<a?:d10(?:red|grey|green|blue|purple|gray)_(\d)\w*:\d+>/g;
const diceOf = (text: string) => [...text.matchAll(DIE)].map((d) => (d[1] === "0" ? 10 : Number(d[1])));

export type ReplayOptions = {
  mode: "step" | "chain";
  from?: number;
  to?: number;
  resync?: boolean;
  stopOnFirst?: boolean;
  /** compare web data at the recording's checkpoints (default true) */
  web?: boolean;
  /** extra normalized keys to ignore, e.g. "stored.warFundingRollssol" */
  ignore?: string[];
  log?: (s: string) => void;
  onStep?: (r: StepResult) => void;
  /** "press" (default): press the recorded button. "engine": answer the engine decision carrying it instead. */
  via?: "press" | "engine";
  /** via engine: also answer untyped ("legacy") decisions through the engine (status stays not_typed) */
  answerLegacy?: boolean;
};

/** Seat-mapped slash-command options (user ids of the original game -> replay seats). */
function mapOptions(opts: Json[] | undefined, map: ForkMap): Json[] {
  return (opts ?? []).map((o) => ({
    ...o,
    ...(o.options ? { options: mapOptions(o.options, map) } : {}),
    ...(o.type === 6 || o.type === 9 ? { value: map.users.get(String(o.value)) ?? o.value } : {}),
  }));
}

function carrierChannel(fork: Fork, map: ForkMap, a: Action, forkUser: string): { channelId: string; thread: boolean } {
  if (a.channel && /^Cards Info-/.test(a.channel.name)) {
    const t = map.playerChannels.get(forkUser)?.get("cards_info_thread_channel_id");
    if (t && t !== "null") return { channelId: t, thread: true };
  }
  return { channelId: fork.actionsId, thread: false };
}

/** Bot messages posted while `fn` runs, in the channels `client` can see. */
async function capturing<T>(client: ShimClient, fn: () => Promise<T>): Promise<{ result: T; texts: string[] }> {
  const texts: string[] = [];
  const off = client.onFrame((f) => {
    if (f.t === "message_create" || f.t === "message_update") texts.push(String(f.message.content ?? "") + JSON.stringify(f.message.embeds ?? []));
  });
  try {
    const result = await fn();
    return { result, texts };
  } finally {
    off();
  }
}

/** Stored values written only by engine display hooks (kinds/ExploreLog.java), absent from older recordings. */
const ENGINE_DISPLAY_STORED = ["stored.engineExploreLog"];

function compare(expected: string, actual: string, fork: Fork, map: ForkMap, ignore: string[]): SaveDiff[] {
  const reverse = new Map([...map.users].map(([o, f]) => [f, o]));
  const e = normalizeSave(expected, { extraVolatile: ignore });
  let a = normalizeSave(actual, { reverseUsers: reverse, forkGame: fork.game, origGame: map.game[0], extraVolatile: ignore });
  // Display-only stored values the engine hooks added after a recording was made (ExploreLog): a recording without
  // them cannot show them, so they are only compared when the recorded save has them.
  for (const k of ENGINE_DISPLAY_STORED) {
    if (!e.some((l) => l.startsWith(`${k} `))) a = a.filter((l) => !l.startsWith(`${k} `));
  }
  return diffNormalized(e, a);
}

/** Presses / runs one recorded action on the fork's current state. `msg`: the message carrying the button, if known. */
async function perform(fork: Fork, map: ForkMap, a: Action, forkUser: string, carrierMsg: Json | null): Promise<string | undefined> {
  const c = await clientFor(fork, forkUser);
  if (a.kind === "button" || a.kind === "hidden-button") {
    if (!carrierMsg) return "no message carries the button";
    const r = await c.click(carrierMsg.channel_id, carrierMsg.id, mapIdsInCustomId(a.customId!, map));
    return r.error;
  }
  if (a.kind === "command") {
    const r = await c.command(fork.actionsId, a.command!.name, mapOptions(a.command!.options, map));
    return r.error;
  }
  return `cannot perform a ${a.kind}`;
}

export async function replay(rec: Recording, fork: Fork, o: ReplayOptions): Promise<StepResult[]> {
  const log = o.log ?? (() => {});
  const saves = recordingSaves(rec);
  const byIndex = new Map(rec.actions.map((a) => [a.index, a]));
  const usernames = new Map(rec.players.map((p) => [p.userId, p.username]));
  const from = o.from ?? saves[0].index;
  const to = o.to ?? saves.at(-1)!.index;
  const pos = (index: number) => saves.findIndex((s) => s.index === index);
  const startPos = Math.max(0, pos(from));
  const endPos = pos(to) < 0 ? saves.length - 1 : pos(to);
  const ignore = o.ignore ?? [];
  const webAt = new Map(rec.checkpoints.filter((c) => c.index !== "live").map((c) => [c.index as number, c.web]));
  const results: StepResult[] = [];
  const mapFor = (text: string) => {
    const m = seatMap(fork, text, usernames);
    for (const id of Object.keys(rec.channels ?? {})) m.otherChannelIds!.add(id);
    return m;
  };
  const push = (r: StepResult) => {
    results.push(r);
    o.onStep?.(r);
  };

  let chainLoaded = false;
  let retried = -1;
  for (let i = startPos + 1; i <= endPos; i++) {
    const prev = saves[i - 1];
    const cur = saves[i];
    const a = byIndex.get(cur.index)!;
    await waitForStack(undefined, log);
    const t0 = Date.now();
    const base: StepResult = { index: cur.index, label: a.label, customId: a.customId, kind: a.kind, status: "skipped", recordedDice: a.dice };
    const map = mapFor(prev.text);
    mirrorUserSettings(map, rec.userSettings);
    const forkUser = a.user ? map.users.get(a.user.id) : undefined;
    const playable = a.replayable && (a.kind === "button" || a.kind === "hidden-button" || a.kind === "command") && !!forkUser;
    if (!playable) {
      const why = a.why ?? (!forkUser ? "the acting person is not seated in the saved state" : `not replayable (${a.kind})`);
      if (o.mode === "chain") {
        // Resynchronize: the recorded save becomes the fork's state.
        await loadSave(fork, cur.text, mapFor(cur.text));
        chainLoaded = true;
        push({ ...base, status: "resync", why });
      } else push({ ...base, why });
      continue;
    }
    try {
      const faction = parseSave(prev.text).players.find((p) => p.userId === a.user!.id)?.kv.get("faction");
      const isButton = a.kind === "button" || a.kind === "hidden-button";
      let carrierMsg: Json | null = null;
      const client = await clientFor(fork, forkUser!);
      if (o.mode === "step" || !chainLoaded) {
        const ch = carrierChannel(fork, map, a, forkUser!);
        carrierMsg = await loadSave(
          fork,
          prev.text,
          map,
          isButton ? { customId: mapIdsInCustomId(a.customId!, map), label: a.buttonLabel ?? a.customId!, faction, channelId: ch.channelId, thread: ch.thread, watcher: forkUser, message: carrierText(a, map) } : undefined,
          newNonce(),
        );
        chainLoaded = true;
      } else if (isButton) {
        // Chain: press the button the bot itself posted in the fork, else reload the fork's own state with a carrier.
        carrierMsg = latestCarrying(client, mapIdsInCustomId(a.customId!, map));
        if (!carrierMsg) {
          const ch = carrierChannel(fork, map, a, forkUser!);
          carrierMsg = await loadSave(fork, readFileSync(gameFile(fork.game), "utf8"), identityMap(fork), {
            customId: mapIdsInCustomId(a.customId!, map),
            label: a.buttonLabel ?? a.customId!,
            faction,
            channelId: ch.channelId,
            thread: ch.thread,
            watcher: forkUser,
            message: carrierText(a, map),
          });
        }
      }
      if (isButton && !carrierMsg) {
        push({ ...base, status: "error", why: "the bot did not post the carrier for the button", ms: Date.now() - t0 });
        continue;
      }
      // --via engine: find the decision the engine captured for the carrier and answer it instead of pressing.
      let eng: EngineStep | undefined;
      let ans: AnswerOutcome | undefined;
      if (o.via === "engine") {
        if (isButton && carrierMsg) {
          const cid = mapIdsInCustomId(a.customId!, map);
          const found = await findDecision(fork.game, cid, carrierMsg.id, 8000);
          eng = { decision: found?.d.id ?? null, kind: found?.d.kind ?? null, option: found?.option.id, target: found?.d.target?.userId ?? null, resolvedBy: found?.d.target?.resolvedBy ?? null, answered: false };
          if (found && (found.d.kind !== "legacy" || o.answerLegacy)) eng.answered = true;
        } else eng = { decision: null, kind: null, answered: false, error: a.kind === "command" ? "slash command (no decision)" : "no carrier" };
      }
      const since = latestUndo(fork.game);
      const { result: err, texts } = await capturing(client, async () => {
        if (eng?.answered) {
          ans = await answer(fork.game, eng.decision!, forkUser!, { optionId: eng.option });
          eng.answerStatus = ans.status ?? String(ans.httpStatus);
          eng.path = ans.path ?? null;
          eng.error = ans.error ?? null;
          const s = ans.ok ? await waitForSaves(fork.game, since) : await waitForSaves(fork.game, since, 2500);
          return { e: ans.ok ? undefined : `engine refused (${ans.httpStatus} ${ans.status ?? ""}): ${ans.error ?? ""}`, s };
        }
        const e = await perform(fork, map, a, forkUser!, carrierMsg);
        const s = await waitForSaves(fork.game, since);
        return { e, s };
      });
      const actual = readFileSync(gameFile(fork.game), "utf8");
      const diffs = compare(cur.text, actual, fork, map, ignore);
      const replayDice = texts.flatMap(diceOf);
      // At a recorded web-data checkpoint, also compare what the web client would render.
      let webDiffs: WebDiff[] | undefined;
      const checkpoint = o.web === false ? undefined : webAt.get(cur.index);
      if (checkpoint) {
        const nonce = parseSave(actual).game.get("game_custom_name");
        const fw = await forkWebData(fork, actual, identityMap(fork), nonce, 30000);
        if (fw && !fw._stale) {
          const w = unfork(fw, fork, map);
          w.gameCustomName = checkpoint.gameCustomName;
          webDiffs = diffWeb(checkpoint, w);
        }
      }
      let status: StepStatus = diffs.length || webDiffs?.length ? "diverged" : "match";
      if (diffs.length && diffs.every((d) => d.orderOnly)) status = "reordered";
      else if (diffs.length && KNOWN_RANDOM.some((r) => r.test(a.customId ?? ""))) status = "random";
      if ((diffs.length || webDiffs?.length) && (a.dice?.length || replayDice.length)) status = "dice";
      if (eng) {
        if (ans && !ans.ok && ans.status !== "needs_input") status = "refused";
        else if (!eng.kind || eng.kind === "legacy") {
          eng.legacyStatus = status;
          status = "not_typed";
        }
      }
      const r: StepResult = {
        ...base,
        status,
        saves: err.s.saves,
        diffs: diffs.length ? diffs : undefined,
        webChecked: !!checkpoint,
        webDiffs: webDiffs?.length ? webDiffs.slice(0, 30) : undefined,
        replayDice: replayDice.length ? replayDice : undefined,
        botSaid: status === "match" ? undefined : texts.map((t) => t.replace(/<a?(:\w+:)\d+>/g, "$1").replace(/<@\d+>/g, "@").slice(0, 300)).slice(0, 5),
        why: err.e ? `the shim answered: ${err.e}` : err.s.saves === 0 ? "the bot saved nothing" : undefined,
        ms: Date.now() - t0,
        engine: eng,
      };
      push(r);
      if (status !== "match" && o.mode === "chain" && o.resync !== false) {
        await loadSave(fork, cur.text, mapFor(cur.text));
      } else if (status === "match" && o.mode === "chain") {
        // Same state, but the bot drew new random card handles (dealt cards): later buttons name the recorded
        // handles (discardSecret_117), so take the recorded save, which differs from the fork's only in handles.
        const reverse = new Map([...map.users].map(([x, y]) => [y, x]));
        const withHandles = diffNormalized(
          normalizeSave(cur.text, { keepHandles: true, extraVolatile: ignore }),
          normalizeSave(actual, { keepHandles: true, reverseUsers: reverse, forkGame: fork.game, origGame: map.game[0], extraVolatile: ignore }),
        );
        if (withHandles.length) await loadSave(fork, cur.text, mapFor(cur.text));
      }
      if (status === "diverged" && o.stopOnFirst) break;
    } catch (e) {
      const msg = (e as Error).message;
      // The stack restarted under us: wait for it and run the same step again (once).
      if (/shim ws|fetch failed|ECONNREFUSED|-> 50\d/.test(msg) && retried !== cur.index) {
        retried = cur.index;
        log(`step ${cur.index}: ${msg}; retrying once the stack is back`);
        await waitForStack(undefined, log);
        if (o.mode === "chain") chainLoaded = false;
        results.length && results.at(-1)!.index === cur.index && results.pop();
        i--;
        continue;
      }
      push({ ...base, status: "error", why: msg, ms: Date.now() - t0 });
      if (o.mode === "chain") chainLoaded = false;
    }
  }
  return results;
}

/** The carrier repeats the original message's text on one line (the save format keeps one line of saved_message). */
function carrierText(a: Action, map: ForkMap): string | undefined {
  if (!a.messageContent) return undefined;
  return mapIdsInCustomId(a.messageContent, map).replace(/\s*\n\s*/g, " ").slice(0, 1800);
}

/** The newest message the client saw that carries a control with this custom id. */
function latestCarrying(c: ShimClient, customId: string): Json | null {
  let best: Json | null = null;
  for (const msgs of c.messages.values())
    for (const m of msgs.values())
      if (controlsOf(m.components).some((x) => x.id === customId) && (!best || BigInt(m.id) > BigInt(best.id))) best = m;
  return best;
}

export function summarizeReplay(results: StepResult[]) {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const firstDivergence = results.find((r) => r.status === "diverged") ?? null;
  const firstNonMatch = results.find((r) => r.status === "diverged" || r.status === "dice" || r.status === "error") ?? null;
  // --via engine: typed coverage of the recording's replayed presses, and the typed answers that disagree.
  const viaEngine = results.filter((r) => r.engine);
  let engine: Record<string, unknown> | undefined;
  if (viaEngine.length) {
    const typed = viaEngine.filter((r) => r.engine!.kind && r.engine!.kind !== "legacy");
    const kinds: Record<string, Record<string, number>> = {};
    for (const r of typed) {
      const k = (kinds[r.engine!.kind!] ??= {});
      k[r.status] = (k[r.status] ?? 0) + 1;
    }
    const legacy: Record<string, number> = {};
    const untypedPrefixes: Record<string, number> = {};
    for (const r of viaEngine.filter((r) => r.status === "not_typed")) {
      const ls = r.engine!.legacyStatus ?? "?";
      legacy[ls] = (legacy[ls] ?? 0) + 1;
      const p = String(r.engine!.option ?? r.kind).replace(/^FFCC_[^_]+_/, "").split(/[_~;]/)[0];
      untypedPrefixes[p] = (untypedPrefixes[p] ?? 0) + 1;
    }
    engine = {
      steps: viaEngine.length,
      typed: typed.length,
      typedCoverage: Math.round((1000 * typed.length) / viaEngine.length) / 10,
      typedMatch: typed.filter((r) => r.status === "match" || r.status === "reordered").length,
      typedDiceOrRandom: typed.filter((r) => r.status === "dice" || r.status === "random").length,
      mismatches: typed.filter((r) => r.status === "diverged").map((r) => ({ index: r.index, kind: r.engine!.kind, label: r.label, keys: (r.diffs ?? []).slice(0, 5).map((d) => d.key) })),
      refused: typed.filter((r) => r.status === "refused").map((r) => ({ index: r.index, kind: r.engine!.kind, label: r.label, error: r.engine!.error })),
      byKind: kinds,
      legacyOutcomes: legacy,
      topUntyped: Object.entries(untypedPrefixes).sort((x, y) => y[1] - x[1]).slice(0, 15),
    };
  }
  return { counts, firstDivergence, firstNonMatch, engine };
}
