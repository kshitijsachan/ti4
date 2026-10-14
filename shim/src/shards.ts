import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Json, State, StoredMessage } from "./store.js";

/**
 * Sharded persistence for the Store (format 2), so a save costs about what changed instead of the whole state:
 *
 *   <data>/store/global.json         users, members, roles, commands, emojis, seats, webhooks, ids, and the key order
 *                                    of the per-channel maps (a load rebuilds byte-identical objects)
 *   <data>/store/shards/<key>.json   one per game (game-pbd95), non-game channel tree (chan-<root id>), DM (dm-<id>),
 *                                    "categories", "orphans": channel objects, thread members, and per channel the
 *                                    names of its message segments
 *   <data>/store/segments/<name>.json  a channel's messages: sealed chunks of CHUNK older messages, then its tail
 *
 * Segment files are immutable: a changed segment is written under a new name, then the shard naming it, then the old
 * file is removed. So the shard file is the commit point, and a crash at any moment leaves a consistent store.
 * New messages go to the tail; a tail of TAIL_MAX messages has its oldest CHUNK sealed into a chunk, which is
 * rewritten only if one of its messages changes. So ended / archived games and old history are cold files that
 * are never rewritten, and a save writes the touched tails and chunks plus their (small) shards.
 *
 * Changes are marked by channel (channel object / thread members), by message (finds its segment), or as global.
 * As a safety net against a mutation nobody marked, `verifySome` re-serializes a few files per call (round robin)
 * and rewrites those that no longer match the disk; `save({ all: true })` checks everything (used at exit).
 */

export const GLOBAL = "global";
const PER_CHANNEL = ["channels", "thread_members", "messages"] as const;
/** A tail this long has its oldest CHUNK messages sealed into a chunk. */
export const TAIL_MAX = 60;
export const CHUNK = 40;

/** Which shard a channel id (and its messages / thread members) is stored in. Pure function of the channel tree. */
export function shardKeyOf(channels: Record<string, Json>, id: string): string {
  const ch = channels[id];
  if (!ch) return "orphans";
  let base = ch;
  if (ch.type === 10 || ch.type === 11 || ch.type === 12) {
    const parent = ch.parent_id ? channels[ch.parent_id] : undefined;
    if (!parent) return `chan-${ch.parent_id ?? ch.id}`;
    base = parent;
  }
  if (base.type === 1) return `dm-${base.id}`;
  if (base.type === 4) return "categories";
  // Same rule as autopilot's gameOf: a game channel lives in a category and is named "<game>-…".
  const m = base.parent_id ? /^([a-z]+\d+)-/i.exec(String(base.name ?? "")) : null;
  if (m) return `game-${m[1].toLowerCase()}`;
  return `chan-${base.id}`;
}

export type SaveStats = { ms: number; written: string[]; bytes: number; checked: number; removed: string[] };

/** Key order of the state's own keys and of the per-channel maps. */
type Order = { top?: string[]; channels: string[]; thread_members: string[]; messages: string[] };

/** A segment file: a sealed chunk or a tail. */
type Seg = { name: string; channel: string; hash: string; size: number };

/** How a shard names a channel's messages. */
type SegRef = { chunks: string[]; tail: string | null };

function digest(s: string): string {
  return createHash("sha1").update(s).digest("base64");
}

function writeAtomic(file: string, data: string) {
  writeFileSync(file + ".tmp", data);
  renameSync(file + ".tmp", file);
}

function unlinkQuiet(file: string) {
  try {
    unlinkSync(file);
  } catch {}
}

/** Shard files start with `{"seq":N,` (see save); the rest is the content that is hashed. */
function stripSeq(raw: string): { seq: number; body: string } {
  const m = /^\{"seq":(\d+),/.exec(raw);
  return m ? { seq: Number(m[1]), body: "{" + raw.slice(m[0].length) } : { seq: 0, body: raw };
}

const CHUNK_LABEL = "chunk:";
/** ShardStore.detached: how long an evicted list is kept for holders of it. */
const DETACHED_MS = 5 * 60_000;
const TAIL_LABEL = "tail:";

export class ShardStore {
  readonly root: string;
  readonly shardDir: string;
  readonly segDir: string;
  /** Content hash and size of each shard file as last written / read. */
  private shardHash = new Map<string, { hash: string; size: number }>();
  private globalHash = "";
  /** Shard each channel id was in at the last save / load. */
  private assigned = new Map<string, string>();
  /** Per channel: sealed chunks in order, the tail segment, and which chunk holds a message. */
  private chunksOf = new Map<string, Seg[]>();
  private tailOf = new Map<string, Seg>();
  private messageChunk = new Map<string, Map<string, Seg>>();
  private segByName = new Map<string, Seg>();
  // Marks.
  private dirtyMeta = new Set<string>();
  private dirtyTails = new Set<string>();
  private dirtyChunks = new Set<Seg>();
  private globalDirty = false;
  private allDirty = false;
  /** Shards to rewrite on the next save (held a duplicate copy of a channel at load, or named a missing segment). */
  private forced = new Set<string>();
  private orderSig = "";
  /** Save counter: in each shard file (which copy of a duplicated channel is newer) and in new segment names. */
  private seq = 0;
  /** Round-robin position of the verifier. */
  private cursor = 0;
  /** Files whose content changed without a mark (found by a verify): for the caller to log. */
  unmarked: string[] = [];
  /**
   * Cold channels: their messages stay on disk (segments are immutable) until something reads them. In the state they
   * are a getter that loads them (materialize) and turns into the plain list; evict turns an unchanged list back.
   */
  private cold = new Set<string>();
  /** When a cold channel's messages were last loaded (materialize), for the eviction sweep. */
  private loadedAt = new Map<string, number>();
  /**
   * Lists evicted in the last DETACHED_MS: a caller may still hold one (or a message of it) across an await and change
   * it. Reading the channel again brings back that same list, and a save marked for it in the meantime takes it.
   */
  private detached = new Map<string, { list: StoredMessage[]; byId: Map<string, Seg> | undefined; at: number }>();

  constructor(dataDir: string) {
    this.root = join(dataDir, "store");
    this.shardDir = join(this.root, "shards");
    this.segDir = join(this.root, "segments");
  }

  exists(): boolean {
    return existsSync(join(this.root, "global.json"));
  }

  /**
   * The channel object or its thread members changed (no id: global state changed). Its tail is re-checked too
   * (rewritten only if it changed), so a recent message changed without its own mark is still saved.
   */
  markChannel(id: string | undefined | null) {
    if (!id) {
      this.globalDirty = true;
      return;
    }
    this.dirtyMeta.add(String(id));
    this.dirtyTails.add(String(id));
  }

  /** A message was added, edited or is about to be deleted. */
  markMessage(channelId: string, messageId: string) {
    const chunk = this.messageChunk.get(channelId)?.get(messageId);
    if (chunk) this.dirtyChunks.add(chunk);
    else this.dirtyTails.add(channelId);
  }

  /** If the message is in a sealed chunk, that chunk changed (e.g. the thread it embeds was updated). */
  markIfChunked(channelId: string, messageId: string) {
    const chunk = this.messageChunk.get(channelId)?.get(messageId);
    if (chunk) this.dirtyChunks.add(chunk);
  }

  markGlobal() {
    this.globalDirty = true;
  }

  /** Next save checks (and writes if changed) every file. */
  markAll() {
    this.allDirty = true;
  }

  get pending(): boolean {
    return this.allDirty || this.globalDirty || this.forced.size > 0 || this.dirtyMeta.size > 0 || this.dirtyTails.size > 0 || this.dirtyChunks.size > 0;
  }

  /** Number of sealed chunks. */
  get chunkCount() {
    let n = 0;
    for (const list of this.chunksOf.values()) n += list.length;
    return n;
  }

  // ---- load ----

  /** `cold(id, channels)`: keep that channel's messages on disk until read (see `cold`). */
  load(opts: { cold?: (id: string, channels: Record<string, Json>) => boolean } = {}): State {
    const globalRaw = readFileSync(join(this.root, "global.json"), "utf8");
    const g = JSON.parse(globalRaw) as Json;
    const order: Order = g.order ?? { channels: [], thread_members: [], messages: [] };
    type Cand = { key: string; seq: number; value: any };
    // Candidates per channel id: normally one; two only if a crash hit between writing a channel's new shard and
    // rewriting the one it moved out of. The copy with the higher seq is the newer one.
    const found: Record<(typeof PER_CHANNEL)[number], Map<string, Cand[]>> = { channels: new Map(), thread_members: new Map(), messages: new Map() };
    const files = existsSync(this.shardDir) ? readdirSync(this.shardDir).filter((f) => f.endsWith(".json")).sort() : [];
    for (const f of files) {
      const key = f.slice(0, -".json".length);
      const { seq, body } = stripSeq(readFileSync(join(this.shardDir, f), "utf8"));
      this.seq = Math.max(this.seq, seq);
      this.shardHash.set(key, { hash: digest(body), size: body.length });
      const shard = JSON.parse(body) as Json;
      for (const part of PER_CHANNEL) {
        for (const [id, value] of Object.entries(shard[part] ?? {})) {
          const list = found[part].get(id);
          if (list) list.push({ key, seq, value });
          else found[part].set(id, [{ key, seq, value }]);
        }
      }
    }
    const state: Json = {};
    for (const [k, v] of Object.entries(g)) if (k !== "order" && k !== "format") state[k] = v;
    const referenced = new Set<string>();
    const readSeg = (name: string, id: string, key: string): { seg: Seg; msgs: StoredMessage[] } | null => {
      try {
        const raw = readFileSync(join(this.segDir, `${name}.json`), "utf8");
        const seg: Seg = { name, channel: id, hash: digest(raw), size: raw.length };
        referenced.add(name);
        this.segByName.set(name, seg);
        return { seg, msgs: JSON.parse(raw) };
      } catch {
        // Cannot happen with save's write order (segments before the shard naming them).
        console.error(`store: segment ${name} of channel ${id} is missing`);
        this.forced.add(key);
        return null;
      }
    };
    for (const part of PER_CHANNEL) {
      const out: Record<string, any> = {};
      const pick = (id: string) => {
        const list = found[part].get(id)!;
        let chosen = list[0];
        if (list.length > 1) {
          for (const c of list) if (c.seq > chosen.seq) chosen = c;
          for (const c of list) this.forced.add(c.key);
        }
        this.assigned.set(id, chosen.key);
        if (part !== "messages") {
          out[id] = chosen.value;
          return;
        }
        const ref = chosen.value as SegRef;
        if (opts.cold && state.channels && opts.cold(id, state.channels)) {
          // Named only: hash and size are read with the messages (materialize); nothing compares them before.
          const chunks: Seg[] = [];
          for (const name of ref.chunks ?? []) chunks.push(this.coldSeg(name, id, referenced));
          if (chunks.length) this.chunksOf.set(id, chunks);
          if (ref.tail) this.tailOf.set(id, this.coldSeg(ref.tail, id, referenced));
          this.cold.add(id);
          this.defineCold(out, id);
          return;
        }
        const all: StoredMessage[] = [];
        const chunks: Seg[] = [];
        const byId = new Map<string, Seg>();
        for (const name of ref.chunks ?? []) {
          const r = readSeg(name, id, chosen.key);
          if (!r) continue;
          chunks.push(r.seg);
          for (const m of r.msgs) {
            byId.set(m.id, r.seg);
            all.push(m);
          }
        }
        if (chunks.length) {
          this.chunksOf.set(id, chunks);
          this.messageChunk.set(id, byId);
        }
        if (ref.tail) {
          const r = readSeg(ref.tail, id, chosen.key);
          if (r) {
            this.tailOf.set(id, r.seg);
            for (const m of r.msgs) all.push(m);
          }
        }
        out[id] = all;
      };
      for (const id of order[part]) if (found[part].has(id) && !(id in out)) pick(id);
      for (const id of found[part].keys()) if (!(id in out)) pick(id);
      state[part] = out;
    }
    // Segments no shard names: written by a save that died before its shard, or replaced by one that died before
    // removing them.
    if (existsSync(this.segDir)) {
      for (const f of readdirSync(this.segDir)) {
        if (f.endsWith(".tmp") || (f.endsWith(".json") && !referenced.has(f.slice(0, -".json".length)))) unlinkQuiet(join(this.segDir, f));
      }
    }
    if (g.order) this.globalHash = digest(globalRaw);
    const ordered: Json = {};
    for (const k of order.top ?? []) if (k in state) ordered[k] = state[k];
    for (const k of Object.keys(state)) if (!(k in ordered)) ordered[k] = state[k];
    this.orderSig = orderSignature(ordered as State);
    return ordered as State;
  }

  // ---- save ----

  /**
   * Writes what was marked changed. `all` (or a pending markAll) re-serializes every file and writes those whose
   * content changed; `verify` names extra files to check that way (shard keys, "chunk:<name>", "tail:<channel>",
   * GLOBAL).
   */
  save(state: State, opts: { all?: boolean; verify?: string[] } = {}): SaveStats {
    const started = Date.now();
    const all = opts.all || this.allDirty;
    this.allDirty = false;
    const seq = ++this.seq;
    let fresh = 0;
    const newName = (ch: string, suffix = "") => `${ch}.${seq}.${fresh++}${suffix}`;
    const stats: SaveStats = { ms: 0, written: [], bytes: 0, checked: 0, removed: [] };
    /** Shards that must be checked because something changed (vs. only verified: a change there is "unmarked"). */
    const dirty = new Set<string>();
    const drop: Seg[] = [];

    // Where every channel id lives now; a channel that moved (renamed, re-parented, deleted) dirties both shards.
    const now = new Map<string, string>();
    const members = new Map<string, string[]>();
    for (const part of PER_CHANNEL) {
      for (const id of Object.keys(state[part])) {
        if (now.has(id)) continue;
        const key = shardKeyOf(state.channels, id);
        now.set(id, key);
        const list = members.get(key);
        if (list) list.push(id);
        else members.set(key, [id]);
        const prev = this.assigned.get(id);
        if (prev !== key) {
          dirty.add(key);
          if (prev) dirty.add(prev);
        }
      }
    }
    for (const [id, prev] of this.assigned) {
      if (now.has(id)) continue;
      dirty.add(prev);
      // A deleted channel's segments go once its shard no longer names them.
      drop.push(...(this.chunksOf.get(id) ?? []));
      const tail = this.tailOf.get(id);
      if (tail) drop.push(tail);
      this.forgetChannel(id);
    }
    this.assigned = now;
    for (const id of this.dirtyMeta) {
      const key = now.get(id);
      if (key) dirty.add(key);
    }
    this.dirtyMeta.clear();
    for (const k of this.forced) dirty.add(k);
    this.forced.clear();

    // What to check.
    // A cold channel's messages are what its segments hold: nothing to check (a channel mark re-checks the tail),
    // unless it was evicted moments ago and marked since: a holder of its list changed it; take that list back.
    // (Its chunk marks were lost with the eviction: check every chunk.)
    for (const id of this.dirtyTails) {
      if (!this.cold.has(id) || !this.detached.has(id)) continue;
      void state.messages[id];
      for (const c of this.chunksOf.get(id) ?? []) this.dirtyChunks.add(c);
    }
    const markedTails = new Set<string>([...this.dirtyTails].filter((id) => id in state.messages && !this.cold.has(id)));
    const markedChunks = new Set<Seg>([...this.dirtyChunks].filter((s) => this.segByName.get(s.name) === s));
    this.dirtyTails.clear();
    this.dirtyChunks.clear();
    const checkTails = new Set(markedTails);
    const checkChunks = new Set(markedChunks);
    const checkShards = new Set(dirty);
    if (all) {
      for (const id of Object.keys(state.messages)) if (!this.cold.has(id)) checkTails.add(id);
      for (const [id, list] of this.chunksOf) if (!this.cold.has(id)) for (const s of list) checkChunks.add(s);
      for (const k of members.keys()) checkShards.add(k);
      for (const k of this.shardHash.keys()) checkShards.add(k);
    }
    for (const v of opts.verify ?? []) {
      if (v.startsWith(CHUNK_LABEL)) {
        const s = this.segByName.get(v.slice(CHUNK_LABEL.length));
        if (s && this.chunksOf.get(s.channel)?.includes(s) && !this.cold.has(s.channel)) checkChunks.add(s);
      } else if (v.startsWith(TAIL_LABEL)) {
        const id = v.slice(TAIL_LABEL.length);
        if (id in state.messages && !this.cold.has(id)) checkTails.add(id);
      } else if (v !== GLOBAL) checkShards.add(v);
    }
    const touch = (id: string) => {
      const key = now.get(id)!;
      dirty.add(key);
      checkShards.add(key);
    };

    // Split each affected channel's messages into its sealed chunks and its tail.
    const groups = new Map<Seg, StoredMessage[]>();
    const tails = new Map<string, StoredMessage[]>();
    const affected = new Set<string>(checkTails);
    for (const s of checkChunks) affected.add(s.channel);
    for (const id of affected) {
      const list = state.messages[id] ?? [];
      const chunks = this.chunksOf.get(id) ?? [];
      const byId = this.messageChunk.get(id);
      for (const s of chunks) groups.set(s, []);
      const tail: StoredMessage[] = [];
      let at = 0;
      let inOrder = true;
      for (const m of list) {
        const s = byId?.get(m.id);
        if (!s) {
          tail.push(m);
          at = chunks.length;
          continue;
        }
        const i = chunks.indexOf(s, at);
        if (i < 0) {
          inOrder = false;
          break;
        }
        at = i;
        groups.get(s)!.push(m);
      }
      if (!inOrder) {
        // Messages no longer in chunk order (nothing reorders a channel today): store the channel afresh.
        for (const s of chunks) {
          drop.push(s);
          checkChunks.delete(s);
          groups.delete(s);
        }
        this.chunksOf.delete(id);
        this.messageChunk.delete(id);
        tails.set(id, list.slice());
        checkTails.add(id);
        touch(id);
        continue;
      }
      // A chunk whose messages were all deleted goes.
      const keep = chunks.filter((s) => groups.get(s)!.length > 0);
      if (keep.length !== chunks.length) {
        for (const s of chunks) {
          if (groups.get(s)!.length) continue;
          drop.push(s);
          checkChunks.delete(s);
          groups.delete(s);
          for (const [mid, x] of byId!) if (x === s) byId!.delete(mid);
        }
        if (keep.length) this.chunksOf.set(id, keep);
        else {
          this.chunksOf.delete(id);
          this.messageChunk.delete(id);
        }
        touch(id);
      }
      tails.set(id, tail);
    }

    const writeSeg = (name: string, text: string) => {
      writeAtomic(join(this.segDir, `${name}.json`), text);
      stats.written.push(name);
      stats.bytes += text.length;
    };
    if (checkChunks.size || checkTails.size) mkdirSync(this.segDir, { recursive: true });

    // 1. Changed chunks: written under a new name.
    for (const s of checkChunks) {
      const msgs = groups.get(s)!;
      const text = JSON.stringify(msgs);
      const hash = digest(text);
      stats.checked++;
      if (hash === s.hash) continue;
      if (!markedChunks.has(s) && !all) this.unmarked.push(CHUNK_LABEL + s.name);
      const next: Seg = { name: newName(s.channel), channel: s.channel, hash, size: text.length };
      writeSeg(next.name, text);
      this.segByName.set(next.name, next);
      const list = this.chunksOf.get(s.channel)!;
      list[list.indexOf(s)] = next;
      const byId = this.messageChunk.get(s.channel)!;
      for (const [mid, x] of byId) if (x === s) byId.delete(mid);
      for (const m of msgs) byId.set(m.id, next);
      drop.push(s);
      touch(s.channel);
    }

    // 2. Tails: seal their oldest messages once long enough, then write the rest under a new name if it changed.
    for (const id of checkTails) {
      let tail = tails.get(id)!;
      if (tail.length >= TAIL_MAX) {
        tail = tail.slice();
        let chunks = this.chunksOf.get(id);
        let byId = this.messageChunk.get(id);
        if (!chunks) this.chunksOf.set(id, (chunks = []));
        if (!byId) this.messageChunk.set(id, (byId = new Map()));
        while (tail.length >= TAIL_MAX) {
          const part = tail.splice(0, CHUNK);
          const text = JSON.stringify(part);
          const seg: Seg = { name: newName(id), channel: id, hash: digest(text), size: text.length };
          writeSeg(seg.name, text);
          this.segByName.set(seg.name, seg);
          chunks.push(seg);
          for (const m of part) byId.set(m.id, seg);
        }
        touch(id);
      }
      const old = this.tailOf.get(id);
      stats.checked++;
      if (!tail.length) {
        if (old) {
          drop.push(old);
          this.tailOf.delete(id);
          touch(id);
        }
        continue;
      }
      const text = JSON.stringify(tail);
      const hash = digest(text);
      if (old && hash === old.hash) continue;
      if (!markedTails.has(id) && !all) this.unmarked.push(TAIL_LABEL + id);
      const seg: Seg = { name: newName(id, "t"), channel: id, hash, size: text.length };
      writeSeg(seg.name, text);
      this.segByName.set(seg.name, seg);
      this.tailOf.set(id, seg);
      if (old) drop.push(old);
      touch(id);
    }

    // 3. Shards (the commit point for their channels' segments).
    if (checkShards.size) mkdirSync(this.shardDir, { recursive: true });
    const removeShards: string[] = [];
    for (const key of checkShards) {
      const ids = members.get(key);
      if (!ids) {
        if (this.shardHash.has(key)) removeShards.push(key);
        continue;
      }
      const shard: Json = { key, channels: {}, thread_members: {}, messages: {} };
      for (const id of ids) {
        if (id in state.channels) shard.channels[id] = state.channels[id];
        if (id in state.thread_members) shard.thread_members[id] = state.thread_members[id];
        if (id in state.messages) {
          const ref: SegRef = { chunks: (this.chunksOf.get(id) ?? []).map((s) => s.name), tail: this.tailOf.get(id)?.name ?? null };
          shard.messages[id] = ref;
        }
      }
      const text = JSON.stringify(shard);
      const hash = digest(text);
      stats.checked++;
      if (hash === this.shardHash.get(key)?.hash) continue;
      if (!dirty.has(key) && !all) this.unmarked.push(key);
      writeAtomic(join(this.shardDir, `${key}.json`), `{"seq":${seq},${text.slice(1)}`);
      this.shardHash.set(key, { hash, size: text.length });
      stats.written.push(key);
      stats.bytes += text.length;
    }

    // 4. Global.
    const sig = orderSignature(state);
    const marked = this.globalDirty || sig !== this.orderSig || !this.globalHash;
    if (marked || all || opts.verify?.includes(GLOBAL)) {
      this.globalDirty = false;
      this.orderSig = sig;
      const g: Json = { format: 2 };
      for (const [k, v] of Object.entries(state)) if (!(PER_CHANNEL as readonly string[]).includes(k)) g[k] = v;
      g.order = { top: Object.keys(state), channels: Object.keys(state.channels), thread_members: Object.keys(state.thread_members), messages: Object.keys(state.messages) };
      const text = JSON.stringify(g);
      const hash = digest(text);
      stats.checked++;
      if (hash !== this.globalHash) {
        if (!marked && !all) this.unmarked.push(GLOBAL);
        mkdirSync(this.root, { recursive: true });
        writeAtomic(join(this.root, "global.json"), text);
        this.globalHash = hash;
        stats.written.push(GLOBAL);
        stats.bytes += text.length;
      }
    }

    // 5. Files nothing names any more.
    for (const key of removeShards) {
      unlinkQuiet(join(this.shardDir, `${key}.json`));
      this.shardHash.delete(key);
      stats.removed.push(key);
    }
    for (const s of drop) {
      unlinkQuiet(join(this.segDir, `${s.name}.json`));
      if (this.segByName.get(s.name) === s) this.segByName.delete(s.name);
      stats.removed.push(s.name);
    }
    stats.ms = Date.now() - started;
    return stats;
  }

  private forgetChannel(id: string) {
    for (const s of this.chunksOf.get(id) ?? []) this.segByName.delete(s.name);
    const tail = this.tailOf.get(id);
    if (tail) this.segByName.delete(tail.name);
    this.chunksOf.delete(id);
    this.tailOf.delete(id);
    this.messageChunk.delete(id);
    this.cold.delete(id);
    this.loadedAt.delete(id);
  }

  // ---- cold channels ----

  private coldSeg(name: string, channel: string, referenced: Set<string>): Seg {
    referenced.add(name);
    const seg: Seg = { name, channel, hash: "", size: 0 };
    this.segByName.set(name, seg);
    return seg;
  }

  /** The state's entry for a cold channel: reading it loads the messages, assigning it replaces them. */
  private defineCold(messages: Record<string, StoredMessage[]>, id: string) {
    const self = this;
    Object.defineProperty(messages, id, {
      configurable: true,
      enumerable: true,
      get() {
        return self.materialize(messages, id);
      },
      set(value: StoredMessage[]) {
        self.cold.delete(id);
        Object.defineProperty(messages, id, { value, writable: true, enumerable: true, configurable: true });
      },
    });
  }

  /** Loads a cold channel's messages from its segments; from then on its entry is the plain list. */
  private materialize(messages: Record<string, StoredMessage[]>, id: string): StoredMessage[] {
    const back = this.detached.get(id);
    if (back) {
      this.detached.delete(id);
      if (back.byId) this.messageChunk.set(id, back.byId);
      this.cold.delete(id);
      this.loadedAt.set(id, Date.now());
      Object.defineProperty(messages, id, { value: back.list, writable: true, enumerable: true, configurable: true });
      return back.list;
    }
    const all: StoredMessage[] = [];
    const chunks: Seg[] = [];
    const byId = new Map<string, Seg>();
    const read = (seg: Seg): StoredMessage[] | null => {
      try {
        const raw = readFileSync(join(this.segDir, `${seg.name}.json`), "utf8");
        seg.hash = digest(raw);
        seg.size = raw.length;
        return JSON.parse(raw) as StoredMessage[];
      } catch {
        // Cannot happen (segments of a cold channel are never rewritten or removed): as at load, rewrite its shard.
        console.error(`store: segment ${seg.name} of channel ${id} is missing`);
        this.segByName.delete(seg.name);
        const key = this.assigned.get(id);
        if (key) this.forced.add(key);
        return null;
      }
    };
    for (const seg of this.chunksOf.get(id) ?? []) {
      const msgs = read(seg);
      if (!msgs) continue;
      chunks.push(seg);
      for (const m of msgs) {
        byId.set(m.id, seg);
        all.push(m);
      }
    }
    if (chunks.length) {
      this.chunksOf.set(id, chunks);
      this.messageChunk.set(id, byId);
    } else {
      this.chunksOf.delete(id);
      this.messageChunk.delete(id);
    }
    const tail = this.tailOf.get(id);
    if (tail) {
      const msgs = read(tail);
      if (msgs) all.push(...msgs);
      else this.tailOf.delete(id);
    }
    this.cold.delete(id);
    this.loadedAt.set(id, Date.now());
    Object.defineProperty(messages, id, { value: all, writable: true, enumerable: true, configurable: true });
    return all;
  }

  isCold(id: string): boolean {
    return this.cold.has(id);
  }

  get coldCount(): number {
    return this.cold.size;
  }

  /** When a channel's messages were last loaded from disk (0: not since start, or never cold). */
  loadedSince(id: string): number {
    return this.loadedAt.get(id) ?? 0;
  }

  /**
   * Drops a channel's messages from memory (its entry becomes a loading getter again) if exactly what its segments
   * hold: no pending mark, and every chunk and the tail serialize to the hash on disk (a change nobody marked is
   * kept, and saved by the verifier or the next save). Returns whether it was evicted.
   */
  evict(state: State, id: string): boolean {
    if (this.cold.has(id) || this.allDirty || this.dirtyTails.has(id) || this.dirtyMeta.has(id)) return false;
    if (!Object.prototype.hasOwnProperty.call(state.messages, id) || !this.assigned.has(id)) return false;
    const chunks = this.chunksOf.get(id) ?? [];
    for (const c of this.dirtyChunks) if (c.channel === id) return false;
    const list = state.messages[id];
    const byId = this.messageChunk.get(id);
    const groups = new Map<Seg, StoredMessage[]>(chunks.map((c) => [c, []]));
    const tail: StoredMessage[] = [];
    let at = 0;
    for (const m of list) {
      const seg = byId?.get(m.id);
      if (!seg) {
        tail.push(m);
        at = chunks.length;
        continue;
      }
      const i = chunks.indexOf(seg, at);
      if (i < 0) return false;
      at = i;
      groups.get(seg)!.push(m);
    }
    for (const c of chunks) {
      const msgs = groups.get(c)!;
      if (!msgs.length || !c.hash || digest(JSON.stringify(msgs)) !== c.hash) return false;
    }
    const t = this.tailOf.get(id);
    if (tail.length ? !t || !t.hash || digest(JSON.stringify(tail)) !== t.hash : !!t) return false;
    const now = Date.now();
    for (const [k, d] of this.detached) if (now - d.at > DETACHED_MS) this.detached.delete(k);
    this.detached.set(id, { list, byId, at: now });
    this.messageChunk.delete(id);
    this.loadedAt.delete(id);
    this.cold.add(id);
    this.defineCold(state.messages, id);
    return true;
  }

  /** A channel's messages without keeping them: a cold channel's are read from disk and not held. */
  peek(state: State, id: string): StoredMessage[] {
    if (!this.cold.has(id)) return state.messages[id] ?? [];
    const back = this.detached.get(id);
    if (back) return back.list;
    const all: StoredMessage[] = [];
    const segs = [...(this.chunksOf.get(id) ?? [])];
    const tail = this.tailOf.get(id);
    if (tail) segs.push(tail);
    for (const seg of segs) {
      try {
        all.push(...(JSON.parse(readFileSync(join(this.segDir, `${seg.name}.json`), "utf8")) as StoredMessage[]));
      } catch {
        /* reported (and repaired) when the channel is loaded */
      }
    }
    return all;
  }

  /**
   * Safety net: checks files round robin (about `budgetBytes` of JSON per call) and rewrites any that changed
   * without a mark (they are listed in `unmarked`).
   */
  verifySome(state: State, budgetBytes = 1_000_000): SaveStats {
    const labels = [GLOBAL, ...[...this.shardHash.keys()].sort()];
    for (const [id, list] of [...this.chunksOf].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (!this.cold.has(id)) for (const s of list) labels.push(CHUNK_LABEL + s.name);
    for (const id of [...this.tailOf.keys()].sort()) if (!this.cold.has(id)) labels.push(TAIL_LABEL + id);
    const pick: string[] = [];
    let budget = 0;
    for (let n = 0; n < labels.length && budget < budgetBytes; n++) {
      const label = labels[this.cursor++ % labels.length];
      pick.push(label);
      if (label === GLOBAL) budget += 1_000_000;
      else if (label.startsWith(CHUNK_LABEL)) budget += this.segByName.get(label.slice(CHUNK_LABEL.length))?.size ?? 0;
      else if (label.startsWith(TAIL_LABEL)) budget += this.tailOf.get(label.slice(TAIL_LABEL.length))?.size ?? 0;
      else budget += this.shardHash.get(label)?.size ?? 0;
    }
    return this.save(state, { verify: pick });
  }
}

function orderSignature(state: State): string {
  return [Object.keys(state), ...PER_CHANNEL.map((p) => Object.keys(state[p]))].map((keys) => keys.join(",")).join("|");
}
