// Distinct button sets (custom ids, tab-separated, one message per line) from the shim's stored messages, for
// `run.sh overlap`. Usage: node messages.mjs /home/user/run/shim-data/state.json > messages.tsv
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync(process.argv[2], "utf8"));
const seen = new Set();
for (const msgs of Object.values(s.messages ?? {})) {
  for (const m of Array.isArray(msgs) ? msgs : Object.values(msgs)) {
    const ids = [];
    const walk = (cs) => { for (const c of cs ?? []) { if (c.custom_id) ids.push(c.custom_id); walk(c.components); } };
    walk(m?.components);
    const key = ids.join("\t");
    if (ids.length && !seen.has(key)) { seen.add(key); console.log(key); }
  }
}
