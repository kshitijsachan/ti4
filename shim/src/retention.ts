import { appendFileSync, existsSync, linkSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { Json, State, StoredMessage } from "./store.js";

/**
 * Attachment retention (shim-data/files/<id>/<name>). The bot re-renders the whole map as a fresh ~1.6 MB image after
 * almost every action (posted to <game>-bot-map-updates and sometimes the actions channel) and re-renders the Milty
 * draft image on every pick (an edit that replaces the old file): live 2026-10-12 that was ~6 GB/day, 7.4 GB in all,
 * of which only the newest render per channel is ever looked at. So:
 * - a render (map / milty image) is kept only while it is among the newest KEEP_RENDERS of its kind in its channel;
 *   older ones are deleted the moment a newer one lands (Retention.onPost) and by the sweep;
 * - a render an edit drops from its message is deleted at once (nothing else refers to it);
 * - an ended game (its channels archived, Hub.sweepEndedGames) keeps only its final map render;
 * - identical bytes are stored once (hard link), e.g. the same banner or an unchanged map posted again.
 * A deleted file is served as 410 with a placeholder image (index.ts), which the web shows in the image's place; the
 * message keeps its attachment metadata (the game log only reads file names). Each removal is logged (path, bytes).
 */

/** Map renders ("pbd233_2026.10.12_-_17.05.22.webp") and Milty draft renders ("pbd1_miltydraft_…webp"). */
const RENDER_RE = /^([a-z]+\d+)_(miltydraft_)?\d{4}\.\d\d\.\d\d_-_\d\d\.\d\d\.\d\d\.(?:webp|png|jpe?g)$/i;

export function renderKind(filename: unknown): "map" | "milty" | null {
  const m = RENDER_RE.exec(String(filename ?? ""));
  return m ? (m[2] ? "milty" : "map") : null;
}

/** Renders kept per channel and kind (the newest; the web shows the latest, the rest is scroll-back). */
export const KEEP_RENDERS = Number(process.env.SHIM_KEEP_RENDERS ?? 3);
/** Unreferenced renders younger than this are left alone (an upload whose message is still being stored). */
const ORPHAN_GRACE_MS = 3600_000;

export type Removal = { id: string; path: string; bytes: number; reason: string; game: string | null };
export type Plan = { removals: Removal[]; bytes: number; byReason: Record<string, { files: number; bytes: number }> };

/** The game a channel belongs to (its name or a parent's: pbd12-actions, its threads, Cards Info-pbd12-… threads). */
export function gameOfChannel(ch: Json | undefined, channels: Record<string, Json>): string | null {
  let c = ch;
  for (let i = 0; i < 3 && c; i++) {
    const m = /^(pbd\d+)-/i.exec(String(c.name ?? ""));
    if (m) return m[1].toLowerCase();
    c = c.parent_id ? channels[c.parent_id] : undefined;
  }
  return null;
}

/** Attachment ids a message links to by url (embeds, components, content; not its own attachments list). */
function urlRefsOf(msg: StoredMessage): string[] {
  const out: string[] = [];
  const walk = (v: any) => {
    if (typeof v === "string") {
      if (v.includes("/attachments/")) for (const m of v.matchAll(/\/attachments\/(\d+)\//g)) out.push(m[1]);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(msg.content);
  walk(msg.embeds);
  walk(msg.components);
  return out;
}

function fileOf(filesDir: string, id: string): { path: string; bytes: number; shared: boolean } | null {
  const dir = join(filesDir, id);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  let bytes = 0;
  let shared = false;
  for (const n of names) {
    try {
      const st = statSync(join(dir, n));
      if (st.nlink > 1) shared = true;
      else bytes += st.size;
    } catch {
      /* gone meanwhile */
    }
  }
  return { path: names.length === 1 ? join(dir, names[0]) : dir, bytes, shared };
}

/**
 * What a sweep removes. `ended`: superseded renders of every game, everything of ended games (archived actions
 * channel) except the final map render, and unreferenced renders (Milty images an edit replaced). Nothing else of a
 * game still in play is touched. Yields to the event loop every few channels when `yieldEvery` is set.
 */
export async function planRetention(
  state: State,
  filesDir: string,
  opts: { keep?: number; now?: number; yieldEvery?: number; messagesOf?: (channelId: string) => StoredMessage[] } = {},
): Promise<Plan> {
  const keep = opts.keep ?? KEEP_RENDERS;
  const now = opts.now ?? Date.now();
  const channels = state.channels;
  const ended = new Set<string>();
  for (const ch of Object.values(channels)) {
    const m = /^(pbd\d+)-actions$/i.exec(String(ch.name ?? ""));
    if (m && ch._archived) ended.add(m[1].toLowerCase());
  }
  const owner = new Map<string, { channel: string; game: string | null; kind: "map" | "milty" | null; msgId: string }>();
  const urlRefs = new Set<string>(); // attachment ids some message links to by url
  const drop = new Map<string, string>(); // id -> reason
  const finalMap = new Map<string, { id: string; msgId: string }>(); // ended game -> newest map render
  let n = 0;
  // messagesOf: read archived channels from disk without keeping them in memory (Store.peekMessages).
  for (const channelId of Object.keys(state.messages)) {
    const msgs = opts.messagesOf ? opts.messagesOf(channelId) : state.messages[channelId];
    if (opts.yieldEvery && ++n % opts.yieldEvery === 0) await new Promise((r) => setImmediate(r));
    const ch = channels[channelId];
    const game = gameOfChannel(ch, channels);
    const seen: Record<string, number> = {};
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      for (const r of urlRefsOf(msg)) urlRefs.add(r);
      for (const a of msg.attachments ?? []) {
        const id = String(a.id);
        const kind = renderKind(a.filename);
        owner.set(id, { channel: channelId, game, kind, msgId: msg.id });
        if (game && ended.has(game)) {
          drop.set(id, "ended-game");
          if (kind === "map") {
            const cur = finalMap.get(game);
            if (!cur || BigInt(msg.id) > BigInt(cur.msgId)) finalMap.set(game, { id, msgId: msg.id });
          }
        } else if (kind) {
          seen[kind] = (seen[kind] ?? 0) + 1;
          if (seen[kind] > keep) drop.set(id, `superseded-${kind}`);
        }
      }
    }
  }
  for (const { id } of finalMap.values()) drop.delete(id);
  // Files on disk that no stored message has: renders an edit replaced (or whose message was deleted).
  let ids: string[] = [];
  try {
    ids = readdirSync(filesDir);
  } catch {
    /* no files yet */
  }
  for (const id of ids) {
    if (owner.has(id) || urlRefs.has(id) || !/^\d+$/.test(id)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(join(filesDir, id));
    } catch {
      continue;
    }
    if (!names.length || !names.every((nm) => renderKind(nm))) continue;
    try {
      if (now - statSync(join(filesDir, id, names[0])).mtimeMs < ORPHAN_GRACE_MS) continue;
    } catch {
      continue;
    }
    drop.set(id, `unreferenced-${renderKind(names[0])}`);
  }
  const plan: Plan = { removals: [], bytes: 0, byReason: {} };
  for (const [id, reason] of drop) {
    // (A superseded render is removed even when another message links to it: the bot's "Open in browser" button under
    // each map post does. Such a link then gets the 410 placeholder, like the image itself.)
    const f = fileOf(filesDir, id);
    if (!f) continue;
    const game = owner.get(id)?.game ?? gameFromName(f.path);
    plan.removals.push({ id, path: f.path, bytes: f.bytes, reason, game });
    plan.bytes += f.bytes;
    const r = (plan.byReason[reason] ??= { files: 0, bytes: 0 });
    r.files++;
    r.bytes += f.bytes;
  }
  return plan;
}

function gameFromName(path: string): string | null {
  const m = /\/(pbd\d+)_[^/]*$/i.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/** Deletes the planned files (only files/<digits> dirs) and appends one line per removal to the log. */
export function applyRemovals(filesDir: string, removals: Removal[], logFile?: string): number {
  let freed = 0;
  const lines: string[] = [];
  const at = new Date().toISOString();
  for (const r of removals) {
    if (!/^\d+$/.test(r.id)) continue;
    try {
      rmSync(join(filesDir, r.id), { recursive: true, force: true });
      freed += r.bytes;
      lines.push(`${at}\t${r.reason}\t${r.game ?? "-"}\t${r.bytes}\t${r.path}`);
    } catch {
      /* skip */
    }
  }
  if (logFile && lines.length) {
    try {
      appendFileSync(logFile, lines.join("\n") + "\n");
    } catch {
      /* log dir missing: removal still done */
    }
  }
  return freed;
}

/** Live retention for the running shim (see the top of this file). */
export class Retention {
  private byHash = new Map<string, string>();
  readonly filesDir: string;
  readonly logFile: string;

  constructor(
    private state: () => State,
    dataDir: string,
    private keep = KEEP_RENDERS,
    private messagesOf?: (channelId: string) => StoredMessage[],
  ) {
    this.filesDir = join(dataDir, "files");
    this.logFile = process.env.SHIM_FREED_LOG ?? join(dirname(dataDir), "freed-files.log");
  }

  /** Writes an upload, hard-linking to an earlier identical file when there is one. */
  write(dir: string, name: string, data: Buffer) {
    mkdirSync(dir, { recursive: true });
    const target = join(dir, name);
    const hash = createHash("sha1").update(data).digest("hex");
    const prev = this.byHash.get(hash);
    if (prev && prev !== target) {
      try {
        if (statSync(prev).size === data.length) {
          linkSync(prev, target);
          return;
        }
      } catch {
        /* the earlier copy was removed: write a fresh one */
      }
    }
    writeFileSync(target, data);
    if (this.byHash.size > 50_000) this.byHash.clear();
    this.byHash.set(hash, target);
  }

  /** A message with attachments landed: older renders of the same kind in its channel beyond `keep` go. */
  onPost(msg: StoredMessage) {
    const kinds = new Set((msg.attachments ?? []).map((a: Json) => renderKind(a.filename)).filter(Boolean));
    if (!kinds.size) return;
    const msgs = this.state().messages[msg.channel_id] ?? [];
    const seen: Record<string, number> = {};
    const removals: Removal[] = [];
    const game = gameFromName("/" + String(msg.attachments?.[0]?.filename ?? ""));
    for (let i = msgs.length - 1; i >= 0; i--) {
      for (const a of msgs[i].attachments ?? []) {
        const kind = renderKind(a.filename);
        if (!kind || !kinds.has(kind)) continue;
        seen[kind] = (seen[kind] ?? 0) + 1;
        if (seen[kind] <= this.keep) continue;
        const id = String(a.id);
        const f = fileOf(this.filesDir, id);
        if (f) removals.push({ id, path: f.path, bytes: f.bytes, reason: `superseded-${kind}`, game });
      }
    }
    if (removals.length) applyRemovals(this.filesDir, removals, this.logFile);
  }

  /** An edit replaced a message's files: renders it dropped are deleted (nothing links to them). */
  onEdit(before: Json[], after: Json[]) {
    const kept = new Set(after.map((a) => String(a.id)));
    const removals: Removal[] = [];
    for (const a of before) {
      const id = String(a.id);
      const kind = renderKind(a.filename);
      if (kept.has(id) || !kind) continue;
      const f = fileOf(this.filesDir, id);
      if (f) removals.push({ id, path: f.path, bytes: f.bytes, reason: `replaced-${kind}`, game: gameFromName("/" + a.filename) });
    }
    if (removals.length) applyRemovals(this.filesDir, removals, this.logFile);
  }

  /** Periodic sweep (after the archive sweep): see planRetention. Returns the bytes freed. */
  async sweep(): Promise<{ files: number; bytes: number; byReason: Plan["byReason"] }> {
    const plan = await planRetention(this.state(), this.filesDir, { keep: this.keep, yieldEvery: 50, messagesOf: this.messagesOf });
    const bytes = applyRemovals(this.filesDir, plan.removals, this.logFile);
    return { files: plan.removals.length, bytes, byReason: plan.byReason };
  }
}
