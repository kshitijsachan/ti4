/**
 * A roll-back makes the shim forget a game's history (engine/rewind.ts): which keys go, which stay, the dedupe of the
 * two signals, and the planner's interrupted tactical action. `npx tsx src/engine/rewind.check.ts` (exits 1 on failure).
 *
 * Live (pbd252, 2026-10-12 15:45): rewound one step while Bot Kappa was mid tactical action (after its move): the
 * planner's plan still said "moved", waited 45 s for a landing that never came, dropped the plan, and the seat sat
 * idle with the game waiting on it.
 */
import assert from "node:assert/strict";
import { forgetGameKeys, isRollbackNotice, keyInGame, newRewind, type GameScope } from "./rewind.js";
import { Brain } from "../botplay/brain.js";
import type { Seat, SeatEngine } from "../botplay/seat.js";
import type { Decision } from "./types.js";

let failures = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`ok   ${name}`),
      (e: Error) => {
        failures++;
        console.log(`FAIL ${name}: ${e.message}`);
      },
    );
}

const MSG = "1559230000000000001";
const OTHER_MSG = "1559230000000000099";
const CH = "1559200000000000010";
const scope: GameScope = { game: "pbd252", channelIds: new Set([CH]), messageIds: new Set([MSG]) };

await check("keys of the game's messages, decisions, channels and the game itself go", () => {
  for (const k of [
    `${MSG}:FFCC_sardakk_tacticalAction`, // pressed / pressCount
    MSG, // answered / fails / retries
    `d${MSG}@3#0|move:{}`, // engineTried (player decision)
    `d${MSG}#1|sc_no_follow_5`, // engineTried (window)
    `d${MSG}`, // engineAttempts / engineLifetime / engineDone / engineDead
    `d${MSG}||null|done`, // engineAccepted
    `d${MSG}|{"units":[]}`, // engineRefusals
    `pbd252|d${MSG}`, // engineWaiting
    "pbd252", // per-game maps (factions, draftResnap, boards, lastPressIn…)
    `${CH}:label:Not Following`, // recent
    `${CH}:roll:combat`,
  ])
    assert.ok(keyInGame(k, scope), k);
});

await check("other games' keys stay", () => {
  for (const k of [`${OTHER_MSG}:x`, `d${OTHER_MSG}@1#0|a`, "pbd25", "pbd2520", `pbd25|d${MSG}x`, "d", `1559200000000000011:label:x`])
    assert.ok(!keyInGame(k, scope), k);
});

await check("forgetGameKeys clears maps and sets in place", () => {
  const tried = new Set([`d${MSG}@1#0|a`, `d${OTHER_MSG}@1#0|a`]);
  const lifetime = new Map([[`d${MSG}`, 24], [`d${OTHER_MSG}`, 3]]);
  const waiting = new Map([[`pbd252|d${MSG}`, 1], [`pbd9|d${OTHER_MSG}`, 2]]);
  assert.equal(forgetGameKeys([tried, lifetime, waiting], scope), 3);
  assert.deepEqual([...tried], [`d${OTHER_MSG}@1#0|a`]);
  assert.deepEqual([...lifetime.keys()], [`d${OTHER_MSG}`]);
  assert.deepEqual([...waiting.keys()], [`pbd9|d${OTHER_MSG}`]);
});

await check("roll-back notices: the undo log line and the web's ⏪ notices", () => {
  assert.ok(isRollbackNotice("Rolled back to save `47` from `53`:\n> `53` …"));
  assert.ok(isRollbackNotice("⏪ Soak Human 1 rewound the game to just after: **x** (save 47)."));
  assert.ok(isRollbackNotice("⏪ Alice undid: **Pass**."));
  assert.ok(!isRollbackNotice("Rolled back the dice"));
  assert.ok(!isRollbackNotice(undefined));
});

await check("one roll-back, two signals: counted once; two engine roll-backs: twice", () => {
  const last = new Map<string, { at: number; via: "event" | "notice" }>();
  assert.ok(newRewind(last, "g", "event", 1000));
  assert.ok(!newRewind(last, "g", "notice", 1500), "the notice of the same roll-back");
  assert.ok(!newRewind(last, "g", "notice", 1600), "its second notice (undo log + ⏪)");
  assert.ok(newRewind(last, "g", "notice", 30_000), "a later roll-back on an older bot");
  assert.ok(!newRewind(last, "g", "notice", 30_100));
  assert.ok(newRewind(last, "g", "event", 31_000) === false, "notice first, then the event of the same roll-back");
  assert.ok(newRewind(last, "g", "event", 32_000), "a second engine roll-back is always new");
  assert.ok(newRewind(last, "h", "notice", 32_000), "another game");
});

// ---- planner: an engine tactical action interrupted by a roll-back is resumed, not left waiting ----

const ME = "u-kappa";
const answers: string[] = [];
const fakeEngine: SeatEngine = {
  decisions: async () => [],
  answer: async (_g, d, optionId) => {
    answers.push(`${d.kind}:${optionId}`);
    return { ok: true, status: "done" } as never;
  },
  move: async () => ({ ok: true, status: "done" }) as never,
  land: async () => ({ ok: true, status: "done" }) as never,
};
const fakeSeat = { userId: ME, engine: fakeEngine, log: () => {} } as unknown as Seat;

const turnMenu = {
  id: `d${MSG}`,
  kind: "turn.action",
  revision: 1,
  target: { userId: ME },
  options: [{ id: "tacticalAction", disabled: false, needsInput: false, value: { action: "tactical" } }],
} as unknown as Extract<Decision, { kind: "turn.action" }>;

await check("brain.rewound stops the running plan and keeps its goal for the restored step", async () => {
  const brain = new Brain(fakeSeat);
  const tactical = (brain as unknown as { engineTactical: { start: Function; plan: { moved: boolean; goal: unknown } | null; interruptedIn(g: string): boolean; resume(g: string): boolean } }).engineTactical;
  const goal = { kind: "expand", target: "207", why: "expand", moves: [], land: {} };
  assert.ok(await tactical.start("pbd252", turnMenu, goal));
  tactical.plan!.moved = true;
  assert.ok(brain.busy("pbd252"));
  brain.rewound(scope);
  assert.ok(!brain.busy("pbd252"), "no plan blocks the turn after the roll-back");
  assert.ok(tactical.interruptedIn("pbd252"));
  assert.ok(tactical.resume("pbd252"));
  assert.equal(tactical.plan!.moved, false, "steps start afresh");
  assert.deepEqual(tactical.plan!.goal, goal, "same goal");
  assert.ok(!tactical.interruptedIn("pbd252"), "resumed once");
});

await check("brain.rewound leaves other games' plans alone", async () => {
  const brain = new Brain(fakeSeat);
  const tactical = (brain as unknown as { engineTactical: { start: Function } }).engineTactical;
  assert.ok(await tactical.start("pbd9", turnMenu, { kind: "expand", target: "101", why: "x", moves: [], land: {} }));
  brain.rewound(scope);
  assert.ok(brain.busy("pbd9"));
});

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all passed");
