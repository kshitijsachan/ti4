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
  // The shim may be saving while we read: a segment named by a shard we read can be removed right after (replaced
  // by a newer one). Retry the whole read then.
  for (let attempt = 0; ; attempt++) {
    try {
      return readSharded(store);
    } catch (e) {
      // Busy shims save several times a second: back off a little (sync) so a retry does not race the same save.
      if (attempt >= 40 || (e?.code !== "ENOENT" && !(e instanceof SyntaxError))) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 + attempt * 10);
    }
  }
}

function readSharded(store) {
  const g = JSON.parse(readFileSync(join(store, "global.json"), "utf8"));
  const order = g.order ?? { channels: [], thread_members: [], messages: [] };
  const found = { channels: new Map(), thread_members: new Map(), messages: new Map() };
  const shardDir = join(store, "shards");
  for (const f of existsSync(shardDir) ? readdirSync(shardDir).filter((x) => x.endsWith(".json")).sort() : []) {
    const raw = readFileSync(join(shardDir, f), "utf8");
    const m = /^\{"seq":(\d+),/.exec(raw);
    const seq = m ? Number(m[1]) : 0;
    const shard = JSON.parse(m ? "{" + raw.slice(m[0].length) : raw);
    for (const part of PER_CHANNEL) {
      for (const [id, value] of Object.entries(shard[part] ?? {})) {
        const prev = found[part].get(id);
        if (!prev || seq > prev.seq) found[part].set(id, { seq, value });
      }
    }
  }
  const readSeg = (name) => JSON.parse(readFileSync(join(store, "segments", `${name}.json`), "utf8"));
  const state = {};
  for (const [k, v] of Object.entries(g)) if (k !== "order" && k !== "format") state[k] = v;
  for (const part of PER_CHANNEL) {
    const out = {};
    const ids = [...order[part].filter((id) => found[part].has(id)), ...found[part].keys()];
    for (const id of ids) {
      if (id in out) continue;
      const { value } = found[part].get(id);
      if (part !== "messages") out[id] = value;
      else {
        const msgs = [];
        for (const name of value.chunks ?? []) for (const msg of readSeg(name)) msgs.push(msg);
        if (value.tail) for (const msg of readSeg(value.tail)) msgs.push(msg);
        out[id] = msgs;
      }
    }
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
