// Rollback for the sharded store (src/shards.ts): rebuilds the single state.json (format 1) from <data>/store and
// moves <data>/store aside, so a shim built before the sharded store can run on the data again (and a sharded shim
// would migrate it again). Run with the shim STOPPED:
//   cd shim && npx tsx tools/store-unshard.ts /home/user/run/shim-data
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ShardStore } from "../src/shards.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: store-unshard.ts <shim data dir>");
  process.exit(2);
}
const disk = new ShardStore(dir);
if (!disk.exists()) {
  console.error(`${disk.root}/global.json not found: nothing to roll back`);
  process.exit(1);
}
const file = join(dir, "state.json");
if (existsSync(file)) {
  console.error(`${file} exists; move it away first`);
  process.exit(1);
}
const state = disk.load();
writeFileSync(file + ".tmp", JSON.stringify(state));
renameSync(file + ".tmp", file);
const aside = `${disk.root}.unsharded-${Date.now()}`;
renameSync(disk.root, aside);
console.log(`wrote ${file} (${Object.keys(state.channels).length} channels); moved ${disk.root} to ${aside}`);
