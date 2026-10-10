import type { Message, Component } from "../../discord/types.ts";
import type { Actor, EventKind, GameEvent, Phase } from "../types.ts";
import { classify, combatThread, roundThread, type LogMessage, type ParseContext } from "./classify.ts";
import { actorLabel, b, segText, txt } from "./markup.ts";

const PHASE_ORDER: Phase[] = ["setup", "strategy", "action", "status", "agenda"];
export const PHASE_LABEL: Record<Phase, string> = {
  setup: "Setup",
  strategy: "Strategy phase",
  action: "Action phase",
  status: "Status phase",
  agenda: "Agenda phase",
};

export type ParseStats = {
  total: number;
  events: Partial<Record<EventKind, number>>;
  noise: Record<string, number>;
  other: number;
  duplicates: number;
  otherSamples: string[];
};

export type Timeline = { events: GameEvent[]; stats: ParseStats };

function componentText(cs: Component[] | undefined): string[] {
  if (!cs) return [];
  return cs.flatMap((c) => [...(c.type === 10 && c.content ? [c.content] : []), ...componentText(c.components), ...componentText(c.accessory ? [c.accessory] : [])]);
}

function hasControls(cs: Component[] | undefined): boolean {
  return !!cs?.some((c) => c.type === 2 || c.type === 3 || (c.type >= 5 && c.type <= 8) || hasControls(c.components));
}

/** Flatten a Discord message into what the rules read. */
export function toLogMessage(m: Message, channelName: string): LogMessage {
  const v2 = componentText(m.components);
  return {
    id: m.id,
    channelId: m.channel_id,
    channelName,
    content: [m.content ?? "", ...v2].filter(Boolean).join("\n"),
    embeds: (m.embeds ?? []).map((e) => ({ title: e.title, description: e.description, fields: e.fields })),
    attachments: (m.attachments ?? []).map((a) => a.filename),
    hasComponents: hasControls(m.components),
    bot: m.author?.bot === true,
    ephemeral: !!m.ephemeral || ((m.flags ?? 0) & 64) === 64,
    time: m.timestamp,
  };
}

export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

const later = (r1: number, p1: Phase, r2: number, p2: Phase) =>
  r2 > r1 || (r2 === r1 && PHASE_ORDER.indexOf(p2) > PHASE_ORDER.indexOf(p1));

/**
 * Messages (any order, any of the game's channels) → chronological game events with round and phase,
 * plus coverage stats. Pure; safe to run in node.
 */
export function buildTimeline(
  messages: LogMessage[],
  nameOf: (userId: string) => string | undefined = () => undefined,
  exploreText?: (cardName: string) => string | undefined,
): Timeline {
  const sorted = [...messages].sort((x, y) => compareIds(x.id, y.id));
  const ctx: ParseContext = { nameOf, exploreText };
  const stats: ParseStats = { total: 0, events: {}, noise: {}, other: 0, duplicates: 0, otherSamples: [] };
  const events: GameEvent[] = [];
  const seen = new Set<string>();
  const recent = new Map<string, number>();
  const replaced = new Map<string, string>();
  const channelOf = new Map<string, string>();
  const artByChannel = new Map<string, string>();
  let round = 0;
  let phase: Phase = "setup";

  const advance = (r: number | undefined, p: Phase | undefined, m: LogMessage) => {
    const nr = r ?? round;
    const np = p ?? (nr !== round ? "strategy" : phase);
    if (!later(round, phase, nr, np)) return;
    round = nr;
    phase = np;
    events.push({
      id: `${m.id}~phase`,
      messageId: m.id,
      channelId: m.channelId,
      time: m.time,
      round,
      phase,
      kind: "phase",
      importance: 3,
      summary: [b(`Round ${round}`), txt(" · "), txt(PHASE_LABEL[phase])],
      text: `Round ${round} ${PHASE_LABEL[phase]}`,
    });
  };

  for (const m of sorted) {
    stats.total++;
    const art = m.content.match(/^\/art\/strat_cards\/([\w-]+)\.png$/);
    if (art && !artByChannel.has(m.channelName)) artByChannel.set(m.channelName, art[1]);
    const result = classify(m, ctx);
    if (result.cls.type === "noise") stats.noise[result.cls.rule] = (stats.noise[result.cls.rule] ?? 0) + 1;
    if (result.cls.type === "other") {
      stats.other++;
      if (stats.otherSamples.length < 400) stats.otherSamples.push(m.content.slice(0, 160).replace(/\n/g, " ⏎ "));
    }
    if (result.marker) advance(result.marker.round, result.marker.phase, m);

    const combat = combatThread(m.channelName);
    const thread = combat ?? roundThread(m.channelName);
    let kept = 0;
    result.drafts.forEach((d, i) => {
      const dedupe = d.dedupe?.replace("{round}", String(round));
      if (dedupe && seen.has(dedupe)) return void stats.duplicates++;
      if (dedupe) seen.add(dedupe);
      const replaceKey = d.replaceKey?.replace("{round}", String(round));
      if (replaceKey) {
        const at = events.findIndex((e) => replaced.get(e.id) === replaceKey);
        if (at >= 0) {
          events.splice(at, 1);
          stats.duplicates++;
        }
      }
      const text = [actorLabel(d.actor), segText(d.summary), ...(d.details ?? []).map(segText)].filter(Boolean).join(" ");
      const key = `${d.kind}|${text}`;
      const t = Date.parse(m.time);
      const prev = recent.get(key);
      recent.set(key, t);
      if (prev !== undefined && Math.abs(t - prev) < 15000) return void stats.duplicates++;
      kept++;
      const id = i ? `${m.id}#${i}` : m.id;
      if (replaceKey) replaced.set(id, replaceKey);
      channelOf.set(id, m.channelName);
      events.push({
        id,
        messageId: m.id,
        channelId: m.channelId,
        time: m.time,
        round: thread && round === 0 ? thread.round : Math.max(round, 0),
        phase: thread && phase === "setup" ? "action" : phase,
        kind: d.kind,
        importance: d.importance ?? 2,
        actor: d.actor,
        target: d.target,
        summary: d.summary,
        details: d.details,
        systemPosition: d.systemPosition ?? combat?.position,
        vp: d.vp,
        text,
      });
    });
    if (result.cls.type === "event" && kept) {
      const k = result.cls.kind;
      stats.events[k] = (stats.events[k] ?? 0) + 1;
    } else if (result.cls.type === "event") {
      stats.noise["duplicate"] = (stats.noise["duplicate"] ?? 0) + 1;
    }
  }
  enrichActors(events, nameOf);
  linkStrategyCards(events, channelOf, artByChannel);
  return { events, stats };
}

const scCardName = (e: GameEvent) => {
  const label = e.summary.find((s) => s.t === "b");
  return label?.t === "b" ? label.v.replace(/^\d+ · /, "") : "";
};
const sameActor = (a: GameEvent, b: GameEvent) =>
  !!a.actor && !!b.actor && (a.actor.faction ? a.actor.faction === b.actor.faction : a.actor.userId === b.actor.userId);
const ENDS_PRIMARY: ReadonlySet<EventKind> = new Set(["turn", "pass", "sc_play", "phase", "activate", "edit"]);
const PRIMARY_WINDOW_MS = 10 * 60_000;

/**
 * Fold what a strategy card play caused under it (`parentId`): the player's own effects posted right after it
 * in the same channel (the primary), and everything in the card's round thread (who followed, with what, or
 * declined). Also records the card's art (`scImage`), which names the exact card variant.
 */
function linkStrategyCards(events: GameEvent[], channelOf: Map<string, string>, artByChannel: Map<string, string>) {
  const playsByThread = new Map<string, GameEvent[]>();
  const threadKey = (round: number, card: string) => `${round}:${card.toLowerCase()}`;
  events.forEach((play, i) => {
    if (play.kind !== "sc_play") return;
    const card = scCardName(play);
    playsByThread.set(threadKey(play.round, card), [...(playsByThread.get(threadKey(play.round, card)) ?? []), play]);
    const channel = channelOf.get(play.id);
    const start = Date.parse(play.time);
    for (const e of events.slice(i + 1)) {
      if (Date.parse(e.time) - start > PRIMARY_WINDOW_MS) break;
      if (channelOf.get(e.id) !== channel) continue;
      if (ENDS_PRIMARY.has(e.kind) || !sameActor(play, e)) break;
      e.parentId = play.id;
    }
  });
  for (const e of events) {
    const thread = roundThread(channelOf.get(e.id) ?? "");
    if (!thread?.card || e.kind === "sc_play") continue;
    const plays = playsByThread.get(threadKey(thread.round, thread.card));
    if (!plays) continue;
    const t = Date.parse(e.time);
    const play = [...plays].reverse().find((p) => Date.parse(p.time) <= t) ?? plays[0];
    e.parentId = play.id;
  }
  for (const plays of playsByThread.values())
    for (const play of plays) {
      const thread = [...artByChannel.keys()].find((name) => {
        const r = roundThread(name);
        return r?.card && threadKey(r.round, r.card) === threadKey(play.round, scCardName(play));
      });
      if (thread) play.scImage = artByChannel.get(thread);
    }
}

/** Fill gaps (bare faction emoji, user-only draft lines) from fuller mentions of the same player elsewhere. */
function enrichActors(events: GameEvent[], nameOf: (userId: string) => string | undefined) {
  const byFaction = new Map<string, Actor>();
  const byUser = new Map<string, Actor>();
  const byName = new Map<string, Actor>();
  const note = (a: Actor | undefined) => {
    if (!a?.faction || !a.color) return;
    const cur = byFaction.get(a.faction) ?? {};
    const merged = { ...a, ...cur, name: cur.name ?? a.name ?? (a.userId ? nameOf(a.userId) : undefined), userId: cur.userId ?? a.userId };
    byFaction.set(a.faction, merged);
  };
  for (const e of events) {
    note(e.actor);
    note(e.target);
  }
  for (const a of byFaction.values()) {
    if (a.userId) byUser.set(a.userId, a);
    if (a.name) byName.set(a.name.toLowerCase(), a);
  }
  const fill = (a: Actor | undefined): Actor | undefined => {
    if (!a) return a;
    const known: Actor | undefined =
      (a.faction ? byFaction.get(a.faction) : undefined) ??
      (a.userId ? byUser.get(a.userId) : undefined) ??
      (a.name ? byName.get(a.name.toLowerCase()) : undefined);
    const merged: Actor = known ? { ...known, ...stripUndefined(a) } : { ...a };
    if (!merged.name && merged.userId) merged.name = nameOf(merged.userId);
    return merged;
  };
  for (const e of events) {
    e.actor = fill(e.actor);
    e.target = fill(e.target);
    for (const s of e.summary) if (s.t === "actor") s.actor = fill(s.actor)!;
    for (const line of e.details ?? []) for (const s of line) if (s.t === "actor") s.actor = fill(s.actor)!;
    e.text = [actorLabel(e.actor), segText(e.summary), ...(e.details ?? []).map(segText)].filter(Boolean).join(" ");
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
