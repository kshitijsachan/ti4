/**
 * Offline check of the G2 strategy-card policy (engine/kinds/strategyPolicy.ts) against the past bugs:
 * Diplomacy both parts, Construction two structures, never following your own card, no double token gain.
 * Run: npx tsx tools/strategy-policy-check.ts  (exit 1 on failure)
 */
import { chooseTyped } from "../src/engine/autopilot.js";
import type { Decision, GameState, PlayerState } from "../src/engine/types.js";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

const player = (userId: string, faction: string, over: Partial<PlayerState> = {}): PlayerState =>
  ({
    userId,
    userName: userId,
    faction,
    color: faction + "c",
    self: false,
    real: true,
    passed: false,
    eliminated: false,
    speaker: false,
    active: false,
    victoryPoints: 0,
    tg: 0,
    commodities: 0,
    commoditiesMax: 3,
    commandTokens: { tactic: 3, fleet: 3, strategy: 2 },
    strategyCards: [],
    techs: [],
    exhaustedTechs: [],
    planets: ["a", "b", "c", "d"],
    exhaustedPlanets: [],
    relics: [],
    fragments: [],
    leaders: [],
    promissoryNotesInPlayArea: [],
    secretsScored: {},
    actionCardCount: 0,
    secretObjectiveCount: 1,
    promissoryNoteCount: 0,
    hand: null,
    ...over,
  }) as unknown as PlayerState;

const state = (sc: number, card: string, holder: string, players: PlayerState[]): GameState =>
  ({
    game: "g",
    phase: "action",
    round: 2,
    activePlayer: holder,
    players,
    strategyCards: [
      {
        number: sc,
        holder,
        tradeGoods: 0,
        played: true,
        name: card,
        card,
        holderFaction: players.find((p) => p.userId === holder)!.faction,
        reactions: players.map((p) => ({ faction: p.faction, status: p.userId === holder ? "holder" : "pending", canFollow: true, cantFollowReason: null })),
      },
    ],
  }) as unknown as GameState;

const opt = (id: string, value: Record<string, unknown> | null) => ({ id, label: id, style: "success", emoji: null, disabled: false, needsInput: false, handler: id, value });

function cardDecision(sc: number, card: string, holder: string, parts: string[], buttons: [string, Record<string, unknown>][]): Decision {
  return {
    id: "d1",
    game: "g",
    kind: "strategy_card.resolve",
    seq: 1,
    stateVersion: 1,
    target: null,
    scope: "table",
    visibility: "public",
    prompt: "",
    options: [
      ...buttons.map(([id, v]) => opt(id, { strategyCard: sc, name: card, card, holder, spendsToken: false, part: null, primaryParts: parts, copy: false, ...v })),
      opt(`sc_no_follow_${sc}`, { strategyCard: sc, name: card, card, holder, action: "decline", who: "others", spendsToken: false, part: null, primaryParts: parts, copy: false }),
    ],
    source: { channelId: "c", messageId: "m", customIdPrefix: null, ephemeral: false },
    createdAt: 0,
    revision: 1,
    window: null,
    progress: null,
  } as unknown as Decision;
}

/** Walk the holder's answers on one message: returns the option ids pressed in order. */
function walk(d: Decision, st: GameState, me: string, max = 6): string[] {
  const history: string[] = [];
  for (let i = 0; i < max; i++) {
    const c = chooseTyped(d, st, me, { history, open: [], all: [d] });
    if (!c) break;
    history.push(c.option.id);
  }
  return history;
}

// Diplomacy: holder does system AND ready planets.
{
  const players = [player("u1", "sol", { strategyCards: [2] }), player("u2", "hacan")];
  const st = state(2, "pok2diplomacy", "u1", players);
  const d = cardDecision(2, "pok2diplomacy", "sol", ["system", "ready_planets"], [
    ["sc_follow_2", { action: "follow", who: "others", spendsToken: true }],
    ["diploSystem", { action: "diplomacy_system", who: "holder", part: "system" }],
    ["diploRefresh2", { action: "ready_planets", who: "anyone", spendsToken: true, part: "ready_planets" }],
  ]);
  const seq = walk(d, st, "u1");
  check("Diplomacy holder: both parts in order", seq.join(",") === "diploSystem,diploRefresh2", seq.join(","));
  check("Diplomacy holder: never follows / declines own card", !seq.some((x) => /follow/.test(x)));
  const other = walk(d, st, "u2");
  check("Diplomacy follower: answers once (decline)", other.join(",") === "sc_no_follow_2", other.join(","));
  // Holder waits while the system prompt is open.
  const sys = { ...d, id: "d2", kind: "strategy_card.diplomacy_system" } as unknown as Decision;
  const waiting = chooseTyped(d, st, "u1", { history: ["diploSystem"], open: [sys], all: [] });
  check("Diplomacy holder: waits for the system prompt before readying", waiting === null);
}

// Construction: two structures (space dock then PDS), never one.
{
  const players = [player("u1", "sol", { strategyCards: [4] }), player("u2", "hacan")];
  const st = state(4, "pok4construction", "u1", players);
  const d = cardDecision(4, "pok4construction", "sol", ["structure", "structure"], [
    ["sc_follow_4", { action: "follow", who: "others", spendsToken: true }],
    ["construction_spacedock", { action: "construction_structure", who: "anyone", spendsToken: true, part: "structure", unit: "spacedock" }],
    ["construction_pds", { action: "construction_structure", who: "anyone", spendsToken: true, part: "structure", unit: "pds" }],
  ]);
  const seq = walk(d, st, "u1");
  check("Construction holder: two structures", seq.join(",") === "construction_spacedock,construction_pds", seq.join(","));
  const small = state(4, "pok4construction", "u1", [player("u1", "sol", { strategyCards: [4], planets: ["a"] }), player("u2", "hacan")]);
  const seq2 = walk(d, small, "u1");
  check("Construction holder (few planets): PDS + PDS", seq2.join(",") === "construction_pds,construction_pds", seq2.join(","));
}

// Imperial: public then Mecatol point (holder on Mecatol) / secret (not on Mecatol).
{
  const parts = ["score_public", "imperial"];
  const buttons: [string, Record<string, unknown>][] = [
    ["sc_follow_8", { action: "follow", who: "others", spendsToken: true }],
    ["sc_draw_so", { action: "draw_secret", who: "anyone", spendsToken: true, part: "imperial" }],
    ["score_imperial", { action: "score_imperial", who: "holder", part: "imperial" }],
    ["scoreAnObjective", { action: "score_public", who: "holder", part: "score_public" }],
  ];
  const d = cardDecision(8, "pok8imperial", "sol", parts, buttons);
  const onRex = walk(d, state(8, "pok8imperial", "u1", [player("u1", "sol", { strategyCards: [8], planets: ["mr", "a"] }), player("u2", "hacan")]), "u1");
  check("Imperial holder on Mecatol: public + point", onRex.join(",") === "scoreAnObjective,score_imperial", onRex.join(","));
  const off = walk(d, state(8, "pok8imperial", "u1", [player("u1", "sol", { strategyCards: [8] }), player("u2", "hacan")]), "u1");
  check("Imperial holder off Mecatol: public + secret", off.join(",") === "scoreAnObjective,sc_draw_so", off.join(","));
}

// Leadership tokens: gain until 3 by pools, never by counting presses; a stale revision is not answered again.
{
  const players = [player("u1", "sol", { strategyCards: [1] })];
  const st = state(1, "pok1leadership", "u1", players);
  const panel = (current: { tactic: number; fleet: number; strategy: number }, revision: number): Decision =>
    ({
      id: "p1",
      game: "g",
      kind: "command_tokens.adjust",
      seq: revision,
      stateVersion: 1,
      target: { userId: "u1", faction: "sol", color: "solc", resolvedBy: "cards_thread" },
      scope: "player",
      visibility: "private",
      prompt: "",
      options: [
        ...(["tactic", "fleet", "strategy"] as const).map((pool) => opt(`increase_${pool}_cc`, { action: "adjust", pool, delta: 1 })),
        opt("deleteButtons_leadership", null),
      ],
      source: { channelId: "c", messageId: "m2", customIdPrefix: null, ephemeral: false },
      createdAt: 0,
      revision,
      window: null,
      progress: { flow: "command_tokens", step: "adjust", accumulated: current, required: { status: false, original: { tactic: 3, fleet: 3, strategy: 2 } }, canCommit: true },
    }) as unknown as Decision;
  const a = chooseTyped(panel({ tactic: 3, fleet: 3, strategy: 2 }, 1), st, "u1", { history: [], open: [], all: [] });
  check("Leadership: first gain", /^increase_/.test(a?.option.id ?? ""), a?.option.id);
  const stale = chooseTyped(panel({ tactic: 3, fleet: 3, strategy: 2 }, 1), st, "u1", { history: [a!.option.id], lastRevision: 1, open: [], all: [] });
  check("Leadership: no second press on the same (stale) revision", stale === null);
  const full = chooseTyped(panel({ tactic: 5, fleet: 3, strategy: 3 }, 4), st, "u1", { history: ["x", "y", "z"], lastRevision: 3, open: [], all: [] });
  check("Leadership: 3 gained by pools → Done", full?.option.id === "deleteButtons_leadership", full?.option.id);
  const replay = chooseTyped(panel({ tactic: 5, fleet: 3, strategy: 3 }, 4), st, "u1", { history: [], open: [], all: [] });
  check("Leadership: after a restart (no history) still Done, no extra gain", replay?.option.id === "deleteButtons_leadership", replay?.option.id);
  // Without the original pools (status-area kind omits them): one gain per answered revision, never more than 3.
  const noOrig = (rev: number) => ({ ...panel({ tactic: 3, fleet: 3, strategy: 2 }, rev), progress: null }) as unknown as Decision;
  const g = chooseTyped(noOrig(5), st, "u1", { history: ["increase_tactic_cc", "increase_tactic_cc", "increase_tactic_cc"], lastRevision: 4, open: [], all: [] });
  check("Leadership (no original pools): 3 answered gains → Done", g?.option.id === "deleteButtons_leadership", g?.option.id);
}

process.exit(failed ? 1 : 0);
