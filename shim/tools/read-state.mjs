// Reads the shim's whole state (the object the shim holds as store.state) from its data dir, read-only, in either
// format: the sharded store (<data>/store, see shim/src/shards.ts) or the old single <data>/state.json.
// For tools and tests that look at live data; plain JS, no dependencies:
//   import { readShimState, shimStateStamp } from "<repo>/shim/tools/read-state.mjs";
//   const state = readShimState("/home/user/run/shim-data");   // a data dir, or a path to state.json
// From a shell: node shim/tools/read-state.mjs <data dir> > state.json
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const PER_CHANNEL = ["channels", "thread_members", "messages"];

/** The data dir for a data dir or a state.json path. */
function dataDir(path) {
  return basename(path) === "state.json" ? dirname(path) : path;
}

/** Changes whenever the shim saves (for caches keyed on it). */
export function shimStateStamp(path) {
  const dir = dataDir(path);
  const store = join(dir, "store");
  if (existsSync(join(store, "global.json"))) {
    // Every save renames new files into these directories, which updates their mtimes.
    return ["global.json", "shards", "segments"].map((f) => (existsSync(join(store, f)) ? statSync(join(store, f)).mtimeMs : 0)).join("/");
  }
  return String(statSync(join(dir, "state.json")).mtimeMs);
}

export function readShimState(path) {
  const dir = dataDir(path);
  const store = join(dir, "store");
  if (!existsSync(join(store, "global.json"))) return JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
  return readSharded(store);
}

/**
 * Reads one shard file and every segment it names, consistently while the shim is saving: the shim writes new
 * segments, then the shard naming them (atomic rename), and only then removes the segments it replaced. So if a
 * named segment is gone, a newer shard file exists: read the shard again and retry. Returns null if the shard
 * itself is gone (all its channels moved elsewhere).
 */
function readShard(store, file) {
  for (let attempt = 0; ; attempt++) {
    let raw;
    try {
      raw = readFileSync(join(store, "shards", file), "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
    const m = /^\{"seq":(\d+),/.exec(raw);
    const seq = m ? Number(m[1]) : 0;
    const shard = JSON.parse(m ? "{" + raw.slice(m[0].length) : raw);
    try {
      const messages = {};
      for (const [id, ref] of Object.entries(shard.messages ?? {})) {
        const msgs = [];
        for (const name of [...(ref.chunks ?? []), ...(ref.tail ? [ref.tail] : [])]) {
          for (const msg of JSON.parse(readFileSync(join(store, "segments", `${name}.json`), "utf8"))) msgs.push(msg);
        }
        messages[id] = msgs;
      }
      shard.messages = messages;
      return { seq, shard };
    } catch (e) {
      if (e?.code !== "ENOENT" || attempt >= 200) throw e;
    }
  }
}

function readSharded(store) {
  const g = JSON.parse(readFileSync(join(store, "global.json"), "utf8"));
  const order = g.order ?? { channels: [], thread_members: [], messages: [] };
  const found = { channels: new Map(), thread_members: new Map(), messages: new Map() };
  const shardDir = join(store, "shards");
  for (const f of existsSync(shardDir) ? readdirSync(shardDir).filter((x) => x.endsWith(".json")).sort() : []) {
    const r = readShard(store, f);
    if (!r) continue;
    for (const part of PER_CHANNEL) {
      for (const [id, value] of Object.entries(r.shard[part] ?? {})) {
        const prev = found[part].get(id);
        if (!prev || r.seq > prev.seq) found[part].set(id, { seq: r.seq, value });
      }
    }
  }
  const state = {};
  for (const [k, v] of Object.entries(g)) if (k !== "order" && k !== "format") state[k] = v;
  for (const part of PER_CHANNEL) {
    const out = {};
    for (const id of [...order[part].filter((id) => found[part].has(id)), ...found[part].keys()]) if (!(id in out)) out[id] = found[part].get(id).value;
    state[part] = out;
  }
  const ordered = {};
  for (const k of order.top ?? []) if (k in state) ordered[k] = state[k];
  for (const k of Object.keys(state)) if (!(k in ordered)) ordered[k] = state[k];
  return ordered;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (!process.argv[2]) {
    console.error("usage: node read-state.mjs <shim data dir | state.json>");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(readShimState(process.argv[2])));
}
