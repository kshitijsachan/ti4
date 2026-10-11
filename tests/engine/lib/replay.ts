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
import { gameFile, type Json } from "./env.ts";
import { clientFor, identityMap, latestUndo, loadSave, seatMap, waitForSaves, type Fork } from "./fork.ts";
import { diffNormalized, normalizeSave, parseSave, type ForkMap, type SaveDiff } from "./savefile.ts";
import { recordingSaves, type Action, type Recording } from "./recording.ts";
import { controlsOf, type ShimClient } from "./shim.ts";

export type StepStatus = "match" | "dice" | "diverged" | "skipped" | "error" | "resync";
export type StepResult = {
  index: number;
  label: string;
  kind: string;
  status: StepStatus;
  why?: string;
  saves?: number;
  diffs?: SaveDiff[];
  recordedDice?: number[];
  replayDice?: number[];
  ms?: number;
};

const DIE = /<a?:d10(?:red|grey|green|blue|purple|gray)_(\d)\w*:\d+>/g;
const diceOf = (text: string) => [...text.matchAll(DIE)].map((d) => (d[1] === "0" ? 10 : Number(d[1])));

export type ReplayOptions = {
  mode: "step" | "chain";
  from?: number;
  to?: number;
  resync?: boolean;
  stopOnFirst?: boolean;
  /** extra normalized keys to ignore, e.g. "stored.warFundingRollssol" */
  ignore?: string[];
  log?: (s: string) => void;
  onStep?: (r: StepResult) => void;
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

function compare(expected: string, actual: string, fork: Fork, map: ForkMap, ignore: string[]): SaveDiff[] {
  const reverse = new Map([...map.users].map(([o, f]) => [f, o]));
  const e = normalizeSave(expected, { extraVolatile: ignore });
  const a = normalizeSave(actual, { reverseUsers: reverse, forkGame: fork.game, origGame: map.game[0], extraVolatile: ignore });
  return diffNormalized(e, a);
}

/** Presses / runs one recorded action on the fork's current state. `msg`: the message carrying the button, if known. */
async function perform(fork: Fork, map: ForkMap, a: Action, forkUser: string, carrierMsg: Json | null): Promise<string | undefined> {
  const c = await clientFor(fork, forkUser);
  if (a.kind === "button" || a.kind === "hidden-button") {
    if (!carrierMsg) return "no message carries the button";
    const r = await c.click(carrierMsg.channel_id, carrierMsg.id, a.customId!);
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
  for (let i = startPos + 1; i <= endPos; i++) {
    const prev = saves[i - 1];
    const cur = saves[i];
    const a = byIndex.get(cur.index)!;
    const t0 = Date.now();
    const base: StepResult = { index: cur.index, label: a.label, kind: a.kind, status: "skipped", recordedDice: a.dice };
    const map = mapFor(prev.text);
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
          isButton ? { customId: a.customId!, label: a.buttonLabel ?? a.customId!, faction, channelId: ch.channelId, thread: ch.thread, watcher: forkUser } : undefined,
        );
        chainLoaded = true;
      } else if (isButton) {
        // Chain: press the button the bot itself posted in the fork, else reload the fork's own state with a carrier.
        carrierMsg = latestCarrying(client, a.customId!);
        if (!carrierMsg) {
          const ch = carrierChannel(fork, map, a, forkUser!);
          carrierMsg = await loadSave(fork, readFileSync(gameFile(fork.game), "utf8"), identityMap(fork), {
            customId: a.customId!,
            label: a.buttonLabel ?? a.customId!,
            faction,
            channelId: ch.channelId,
            thread: ch.thread,
            watcher: forkUser,
          });
        }
      }
      if (isButton && !carrierMsg) {
        push({ ...base, status: "error", why: "the bot did not post the carrier for the button", ms: Date.now() - t0 });
        continue;
      }
      const since = latestUndo(fork.game);
      const { result: err, texts } = await capturing(client, async () => {
        const e = await perform(fork, map, a, forkUser!, carrierMsg);
        const s = await waitForSaves(fork.game, since);
        return { e, s };
      });
      const actual = readFileSync(gameFile(fork.game), "utf8");
      const diffs = compare(cur.text, actual, fork, map, ignore);
      const replayDice = texts.flatMap(diceOf);
      let status: StepStatus = diffs.length ? "diverged" : "match";
      if (diffs.length && (a.dice?.length || replayDice.length)) status = "dice";
      const r: StepResult = {
        ...base,
        status,
        saves: err.s.saves,
        diffs: diffs.length ? diffs : undefined,
        replayDice: replayDice.length ? replayDice : undefined,
        why: err.e ? `the shim answered: ${err.e}` : err.s.saves === 0 ? "the bot saved nothing" : undefined,
        ms: Date.now() - t0,
      };
      push(r);
      if (status !== "match" && o.mode === "chain" && o.resync !== false) {
        await loadSave(fork, cur.text, mapFor(cur.text));
      }
      if (status === "diverged" && o.stopOnFirst) break;
    } catch (e) {
      push({ ...base, status: "error", why: (e as Error).message, ms: Date.now() - t0 });
      if (o.mode === "chain") chainLoaded = false;
    }
  }
  return results;
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
  return { counts, firstDivergence, firstNonMatch };
}
