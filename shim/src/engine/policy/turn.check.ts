/**
 * Turn policy (engine/policy/turn.ts) on real turn.action decisions: `npx tsx src/engine/policy/turn.check.ts`
 * (exits 1 on failure). Fixtures: read-only GET /api/public/selfhost/engine/<game>/decisions + /state (soak, 01:32),
 * state trimmed to what the policy reads.
 */
import assert from "node:assert/strict";
import { chooseTyped } from "../autopilot.js";
import type { Decision, GameState } from "../types.js";
import { chooseFallback, staleForBot } from "./fallback.js";
import { actionInFlight, TURN_PLANNER_GRACE_MS } from "./turn.js";

type Fixture = { decision: Decision; state: GameState };
const PBD181_STATE = {
  phase: "action",
  round: 2,
  activePlayer: "1559015287133700096",
  players: [
    {
      userId: "1559020375344545792",
      faction: "arborec",
      color: "forest",
      passed: false,
      strategyCards: [],
    },
    {
      userId: "1559015287314055168",
      faction: "naaz",
      color: "red",
      passed: false,
      strategyCards: [],
    },
    {
      userId: "1558999886102396928",
      faction: "muaat",
      color: "magma",
      passed: false,
      strategyCards: [],
    },
    {
      userId: "1558999886186283008",
      faction: "sol",
      color: "navy",
      passed: false,
      strategyCards: [],
    },
    {
      userId: "1559021052238102528",
      faction: "sardakk",
      color: "chocolate",
      passed: false,
      strategyCards: [],
    },
    {
      userId: "1558997170542215168",
      faction: "empyrean",
      color: "poison",
      passed: false,
      strategyCards: [],
    },
    {
      userId: "1559015287133700096",
      faction: "nomad",
      color: "vapourwave",
      passed: false,
      strategyCards: [1],
    },
    {
      userId: "1558508302810349568",
      faction: "xxcha",
      color: "yellow",
      passed: false,
      strategyCards: [8],
    },
    {
      userId: "572698679618568193",
      faction: "neutral",
      color: "aberration",
      passed: false,
      strategyCards: [],
    },
  ],
  strategyCards: [
    {
      number: 1,
      holder: "1559015287133700096",
      played: true,
      card: "pok1leadership",
    },
    { number: 2, holder: null, played: false, card: "pok2diplomacy" },
    { number: 3, holder: null, played: false, card: "pok3politics" },
    { number: 4, holder: null, played: false, card: "te4construction" },
    { number: 5, holder: null, played: false, card: "pok5trade" },
    { number: 6, holder: null, played: false, card: "te6warfare" },
    { number: 7, holder: null, played: false, card: "pok7technology" },
    {
      number: 8,
      holder: "1558508302810349568",
      played: true,
      card: "pok8imperial",
    },
  ],
};
const LIVE: Record<string, Fixture> = {
  pbd42: {
    decision: {
      id: "d1558553952553926656",
      game: "pbd42",
      kind: "turn.action",
      seq: 2945,
      stateVersion: 1791767314583,
      target: {
        userId: "1558232785313988608",
        faction: "mahact",
        color: "splitgold",
        resolvedBy: "owner_prefix",
      },
      scope: "player",
      visibility: "public",
      prompt: "Use buttons to do your turn.",
      options: [
        {
          id: "FFCC_mahact_tacticalAction",
          label: "Tactical Action (3)",
          style: "success",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "tacticalAction",
          value: { action: "tactical", tacticTokens: 3 },
          owner: null,
        },
        {
          id: "FFCC_mahact_componentAction",
          label: "Component Action (0)",
          style: "success",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "componentAction",
          value: { action: "component" },
          owner: null,
        },
        {
          id: "FFCC_mahact_passingAbilities",
          label: "Pass (+3 abilities)",
          style: "danger",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "passingAbilities",
          value: { action: "pass", abilities: true },
          owner: null,
        },
        {
          id: "transaction",
          label: "Transaction",
          style: "primary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "transaction",
          value: null,
          owner: null,
        },
        {
          id: "getModifyTiles",
          label: "Modify Units",
          style: "secondary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "getModifyTiles",
          value: null,
          owner: null,
        },
        {
          id: "showMap",
          label: "Show Map",
          style: "secondary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "showMap",
          value: null,
          owner: null,
        },
        {
          id: "showPlayerAreas",
          label: "Show Player Areas",
          style: "secondary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "showPlayerAreas",
          value: null,
          owner: null,
        },
        {
          id: "ultimateUndo_190",
          label: "UNDO",
          style: "secondary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "ultimateUndo_190",
          value: null,
          owner: null,
        },
      ],
      source: {
        channelId: "1558540303001059328",
        messageId: "1558553952553926656",
        customIdPrefix: "tacticalAction",
        ephemeral: false,
      },
      createdAt: 1791658618821,
      revision: 1,
      window: null,
      progress: null,
      inputs: null,
    },
    state: {
      phase: "statusHomework",
      round: 3,
      activePlayer: "1558221276143812608",
      players: [
        {
          userId: "1558221276219310080",
          faction: "argent",
          color: "peach",
          passed: false,
          strategyCards: [],
        },
        {
          userId: "1558221276194144256",
          faction: "l1z1x",
          color: "orca",
          passed: false,
          strategyCards: [],
        },
        {
          userId: "1558221276143812608",
          faction: "sardakk",
          color: "black",
          passed: false,
          strategyCards: [],
        },
        {
          userId: "1558232785313988608",
          faction: "mahact",
          color: "splitgold",
          passed: false,
          strategyCards: [],
        },
        {
          userId: "572698679618568193",
          faction: "neutral",
          color: "aberration",
          passed: false,
          strategyCards: [],
        },
      ],
      strategyCards: [
        { number: 1, holder: null, played: false, card: "pok1leadership" },
        { number: 2, holder: null, played: false, card: "pok2diplomacy" },
        { number: 3, holder: null, played: false, card: "pok3politics" },
        { number: 4, holder: null, played: false, card: "te4construction" },
        { number: 5, holder: null, played: false, card: "pok5trade" },
        { number: 6, holder: null, played: false, card: "te6warfare" },
        { number: 7, holder: null, played: false, card: "pok7technology" },
        { number: 8, holder: null, played: false, card: "pok8imperial" },
      ],
    },
  },
  pbd147: {
    decision: {
      id: "d1559010836800995328",
      game: "pbd147",
      kind: "turn.action",
      seq: 4205,
      stateVersion: 1791768646199,
      target: {
        userId: "1558873130825547776",
        faction: "arborec",
        color: "green",
        resolvedBy: "owner_prefix",
      },
      scope: "player",
      visibility: "public",
      prompt: "Use these buttons to do an ability when you pass.",
      options: [
        {
          id: "FFCC_arborec_passForRound",
          label: "Pass",
          style: "danger",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "passForRound",
          value: { action: "pass", abilities: false },
          owner: null,
        },
      ],
      source: {
        channelId: "1558985942025502720",
        messageId: "1559010836800995328",
        customIdPrefix: "passForRound",
        ephemeral: false,
      },
      createdAt: 1791767548514,
      revision: 1,
      window: null,
      progress: null,
      inputs: null,
    },
    state: {
      phase: "action",
      round: 1,
      activePlayer: "1558873130825547776",
      players: [
        {
          userId: "1558874274012463104",
          faction: "cabal",
          color: "poison",
          passed: true,
          strategyCards: [1, 6],
        },
        {
          userId: "1558872597159084032",
          faction: "saar",
          color: "neapolitan",
          passed: false,
          strategyCards: [4, 7],
        },
        {
          userId: "1558879003950055424",
          faction: "firmament",
          color: "plaid",
          passed: false,
          strategyCards: [3, 8],
        },
        {
          userId: "1558873130825547776",
          faction: "arborec",
          color: "green",
          passed: false,
          strategyCards: [2, 5],
        },
        {
          userId: "572698679618568193",
          faction: "argent",
          color: "aberration",
          passed: true,
          strategyCards: [],
        },
      ],
      strategyCards: [
        {
          number: 1,
          holder: "1558874274012463104",
          played: true,
          card: "pok1leadership",
        },
        {
          number: 2,
          holder: "1558873130825547776",
          played: true,
          card: "pok2diplomacy",
        },
        {
          number: 3,
          holder: "1558879003950055424",
          played: true,
          card: "pok3politics",
        },
        {
          number: 4,
          holder: "1558872597159084032",
          played: true,
          card: "te4construction",
        },
        {
          number: 5,
          holder: "1558873130825547776",
          played: true,
          card: "pok5trade",
        },
        {
          number: 6,
          holder: "1558874274012463104",
          played: true,
          card: "te6warfare",
        },
        {
          number: 7,
          holder: "1558872597159084032",
          played: true,
          card: "pok7technology",
        },
        {
          number: 8,
          holder: "1558879003950055424",
          played: true,
          card: "pok8imperial",
        },
      ],
    },
  },
  pbd161: {
    decision: {
      id: "d1559015879138738176",
      game: "pbd161",
      kind: "turn.action",
      seq: 4609,
      stateVersion: 1791768750694,
      target: {
        userId: "1558996998236012544",
        faction: "l1z1x",
        color: "gray",
        resolvedBy: "owner_prefix",
      },
      scope: "player",
      visibility: "public",
      prompt: "Use buttons to do your turn.",
      options: [
        {
          id: "FFCC_l1z1x_tacticalAction",
          label: "Tactical Action (2)",
          style: "success",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "tacticalAction",
          value: { action: "tactical", tacticTokens: 2 },
          owner: null,
        },
        {
          id: "FFCC_l1z1x_componentAction",
          label: "Component Action (0)",
          style: "success",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "componentAction",
          value: { action: "component" },
          owner: null,
        },
        {
          id: "FFCC_l1z1x_strategicAction_3",
          label: "Play Politics",
          style: "success",
          emoji: "1558154758559236096",
          disabled: false,
          needsInput: false,
          handler: "strategicAction_3",
          value: { action: "strategic", strategyCard: 3 },
          owner: null,
        },
        {
          id: "transaction",
          label: "Transaction",
          style: "primary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "transaction",
          value: null,
          owner: null,
        },
        {
          id: "getModifyTiles",
          label: "Modify Units",
          style: "secondary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "getModifyTiles",
          value: null,
          owner: null,
        },
        {
          id: "showMap",
          label: "Show Map",
          style: "secondary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "showMap",
          value: null,
          owner: null,
        },
        {
          id: "showPlayerAreas",
          label: "Show Player Areas",
          style: "secondary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "showPlayerAreas",
          value: null,
          owner: null,
        },
        {
          id: "ultimateUndo_580",
          label: "UNDO",
          style: "secondary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "ultimateUndo_580",
          value: null,
          owner: null,
        },
      ],
      source: {
        channelId: "1558997192008663040",
        messageId: "1559015879138738176",
        customIdPrefix: "tacticalAction",
        ephemeral: false,
      },
      createdAt: 1791768750701,
      revision: 1,
      window: null,
      progress: null,
      inputs: null,
    },
    state: {
      phase: "action",
      round: 1,
      activePlayer: "1558996998236012544",
      players: [
        {
          userId: "1558957548168675328",
          faction: "crimson",
          color: "red",
          passed: false,
          strategyCards: [1],
        },
        {
          userId: "1558957548227395584",
          faction: "mentak",
          color: "camouflage",
          passed: false,
          strategyCards: [7],
        },
        {
          userId: "1558994839813619712",
          faction: "xxcha",
          color: "poison",
          passed: false,
          strategyCards: [8],
        },
        {
          userId: "1558997170542215168",
          faction: "hacan",
          color: "dawn",
          passed: false,
          strategyCards: [6],
        },
        {
          userId: "1558957548277727232",
          faction: "firmament",
          color: "blue",
          passed: false,
          strategyCards: [5],
        },
        {
          userId: "1558996998236012544",
          faction: "l1z1x",
          color: "gray",
          passed: false,
          strategyCards: [3],
        },
        {
          userId: "572698679618568193",
          faction: "neutral",
          color: "aberration",
          passed: true,
          strategyCards: [],
        },
      ],
      strategyCards: [
        {
          number: 1,
          holder: "1558957548168675328",
          played: true,
          card: "pok1leadership",
        },
        { number: 2, holder: null, played: false, card: "pok2diplomacy" },
        {
          number: 3,
          holder: "1558996998236012544",
          played: false,
          card: "pok3politics",
        },
        { number: 4, holder: null, played: false, card: "te4construction" },
        {
          number: 5,
          holder: "1558957548277727232",
          played: true,
          card: "pok5trade",
        },
        {
          number: 6,
          holder: "1558997170542215168",
          played: true,
          card: "te6warfare",
        },
        {
          number: 7,
          holder: "1558957548227395584",
          played: true,
          card: "pok7technology",
        },
        {
          number: 8,
          holder: "1558994839813619712",
          played: true,
          card: "pok8imperial",
        },
      ],
    },
  },
  pbd171: {
    decision: {
      id: "d1559015851330502656",
      game: "pbd171",
      kind: "turn.action",
      seq: 4592,
      stateVersion: 1791768744034,
      target: {
        userId: "1558997170542215168",
        faction: "firmament",
        color: "plaid",
        resolvedBy: "owner_prefix",
      },
      scope: "player",
      visibility: "public",
      prompt: "Use buttons to do an end of turn ability",
      options: [
        {
          id: "FFCC_firmament_turnEnd",
          label: "End Turn",
          style: "danger",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "turnEnd",
          value: { action: "end_turn", abilities: false },
          owner: null,
        },
        {
          id: "FFCC_firmament_expeditionInfoAndButtons",
          label: "Do an Expedition (6 Remaining)",
          style: "secondary",
          emoji: null,
          disabled: false,
          needsInput: false,
          handler: "expeditionInfoAndButtons",
          value: null,
          owner: null,
        },
      ],
      source: {
        channelId: "1559009347114237952",
        messageId: "1559015851330502656",
        customIdPrefix: "turnEnd",
        ephemeral: false,
      },
      createdAt: 1791768744071,
      revision: 1,
      window: null,
      progress: null,
      inputs: null,
    },
    state: {
      phase: "action",
      round: 3,
      activePlayer: "1558997170542215168",
      players: [
        {
          userId: "1558997170542215168",
          faction: "firmament",
          color: "plaid",
          passed: false,
          strategyCards: [1, 5],
        },
        {
          userId: "1558999886186283008",
          faction: "hacan",
          color: "spring",
          passed: false,
          strategyCards: [4, 7],
        },
        {
          userId: "1558508302856486912",
          faction: "nomad",
          color: "azure",
          passed: true,
          strategyCards: [3, 8],
        },
        {
          userId: "1558999886102396928",
          faction: "nekro",
          color: "rainbow",
          passed: true,
          strategyCards: [2, 6],
        },
        {
          userId: "572698679618568193",
          faction: "neutral",
          color: "aberration",
          passed: true,
          strategyCards: [],
        },
      ],
      strategyCards: [
        {
          number: 1,
          holder: "1558997170542215168",
          played: true,
          card: "pok1leadership",
        },
        {
          number: 2,
          holder: "1558999886102396928",
          played: true,
          card: "pok2diplomacy",
        },
        {
          number: 3,
          holder: "1558508302856486912",
          played: true,
          card: "pok3politics",
        },
        {
          number: 4,
          holder: "1558999886186283008",
          played: true,
          card: "te4construction",
        },
        {
          number: 5,
          holder: "1558997170542215168",
          played: true,
          card: "pok5trade",
        },
        {
          number: 6,
          holder: "1558999886102396928",
          played: true,
          card: "te6warfare",
        },
        {
          number: 7,
          holder: "1558999886186283008",
          played: true,
          card: "pok7technology",
        },
        {
          number: 8,
          holder: "1558508302856486912",
          played: true,
          card: "pok8imperial",
        },
      ],
    },
  },
};

const ctx = (d: Decision, waitedMs = 0, force = false) => ({
  history: [],
  open: [],
  all: [d],
  waitedMs,
  force,
});
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const at = (f: Fixture, patch: Partial<GameState>) =>
  ({ ...clone(f.state), ...patch }) as GameState;
const owner = (f: Fixture) => f.decision.target!.userId;
const pick = (f: Fixture, st: GameState | null, waitedMs = 0, force = false) =>
  chooseTyped(f.decision, st, owner(f), ctx(f.decision, waitedMs, force))
    ?.option?.id ?? null;
let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok ${name}`);
};

// pbd42 (live 01:05-01:25): a start-of-turn menu left open into the status phase; the watchdog pressed
// "Pass (+3 abilities)" every minute ("The action phase is over; there is nothing to pass").
check(
  "pbd42: turn menu in the status phase is stale; nothing presses it, not even forced",
  () => {
    const f = LIVE.pbd42;
    assert.equal(f.state.phase, "statusHomework");
    assert.equal(staleForBot(f.decision, f.state, owner(f)), true);
    assert.equal(pick(f, f.state, 600_000, true), null);
    assert.equal(chooseFallback(f.decision, f.state, owner(f)), null);
    // The same menu on our own action-phase turn: the planner first, then pass.
    const mine = at(f, { phase: "action", activePlayer: owner(f) });
    assert.equal(pick(f, mine, 1000), null);
    assert.equal(
      pick(f, mine, TURN_PLANNER_GRACE_MS),
      "FFCC_mahact_passingAbilities",
    );
    // Not our turn (pbd160 Bot Beta: "It is not your turn") or no state: stale.
    assert.equal(
      pick(
        f,
        at(f, { phase: "action", activePlayer: "someone else" }),
        600_000,
        true,
      ),
      null,
    );
    assert.equal(pick(f, null, 600_000, true), null);
    assert.equal(chooseFallback(f.decision, null, owner(f)), null);
  },
);

check(
  "pbd147: the pass menu (after Pass with abilities) on our turn passes at once",
  () => {
    const f = LIVE.pbd147;
    assert.equal(f.state.activePlayer, owner(f));
    assert.equal(pick(f, f.state, 0), "FFCC_arborec_passForRound");
    // Already passed / another phase: never.
    const passed = at(f, {});
    passed.players.find((p) => p.userId === owner(f))!.passed = true;
    assert.equal(pick(f, passed, 600_000, true), null);
    assert.equal(pick(f, at(f, { phase: "status" }), 600_000, true), null);
  },
);

check(
  "pbd161: an unplayed strategy card is played at once (before any pass / tactical)",
  () => {
    const f = LIVE.pbd161;
    assert.equal(f.state.activePlayer, owner(f));
    assert.equal(pick(f, f.state, 0), "FFCC_l1z1x_strategicAction_3");
    // Forced fallback picks the card too, never the tactical / component action.
    assert.equal(
      chooseFallback(f.decision, f.state, owner(f))?.option.id,
      "FFCC_l1z1x_strategicAction_3",
    );
  },
);

check(
  "pbd161: no pass while a strategy card is unplayed (even if the menu offered one)",
  () => {
    const f = clone(LIVE.pbd161);
    f.decision.options = f.decision.options.filter(
      (o) => !/strategicAction/.test(o.id),
    );
    f.decision.options.push({
      ...f.decision.options[0],
      id: "FFCC_l1z1x_passingAbilities",
      label: "Pass",
      handler: "passingAbilities",
      value: { action: "pass", abilities: true },
    } as any);
    assert.equal(pick(f, f.state, 600_000, true), null);
    assert.equal(chooseFallback(f.decision, f.state, owner(f)), null);
    const played = at(f, {});
    played.strategyCards.forEach((c) => (c.played = true));
    assert.equal(
      pick(f, played, TURN_PLANNER_GRACE_MS),
      "FFCC_l1z1x_passingAbilities",
    );
  },
);

check("pbd171: after the action, end the turn at once", () => {
  const f = LIVE.pbd171;
  assert.equal(pick(f, f.state, 0), "FFCC_firmament_turnEnd");
  assert.equal(pick(f, at(f, { activePlayer: "someone else" }), 0), null);
});

// pbd181 02:13-02:14 (live): Bot Kappa 5 (nomad) activated 210, moved and landed; its tactical.move / tactical.conclude
// prompts were still open when the turn menu passed "after 13 s" (02:14:01). State: /state of pbd181 at 02:30 with
// the turn put back on Kappa; decision ids / options from shim.log + bot.log.
check(
  "pbd181: never pass / play / end turn while our tactical action's prompts are open",
  () => {
    const KAPPA = "1559015287133700096";
    const state = PBD181_STATE as unknown as GameState;
    const at = Date.now(); // (live: 02:14:00; ages relative to now)
    const menu = clone(LIVE.pbd161.decision);
    menu.id = "d-pbd181-menu";
    menu.game = "pbd181";
    menu.target = {
      userId: KAPPA,
      faction: "nomad",
      color: "yellow",
      resolvedBy: "owner_prefix",
    };
    menu.createdAt = at - 60_000;
    menu.options = [
      {
        ...menu.options[0],
        id: "FFCC_nomad_tacticalAction",
        label: "Tactical Action (6)",
        handler: "tacticalAction",
        value: { action: "tactical", tacticTokens: 6 },
      },
      {
        ...menu.options[0],
        id: "FFCC_nomad_componentAction",
        label: "Component Action (0)",
        handler: "componentAction",
        value: { action: "component" },
      },
      {
        ...menu.options[0],
        id: "FFCC_nomad_passingAbilities",
        label: "Pass (+1 ability)",
        handler: "passingAbilities",
        value: { action: "pass", abilities: true },
      },
    ] as any;
    const prompt = (
      id: string,
      kind: string,
      optId: string,
      label: string,
      value: unknown,
      createdAt: number,
    ) =>
      ({
        ...clone(menu),
        id,
        kind,
        createdAt,
        options: [
          {
            ...menu.options[0],
            id: optId,
            label,
            handler: optId.replace(/^FFCC_nomad_/, ""),
            value,
          },
        ],
      }) as unknown as Decision;
    const move = prompt(
      "d1559026163005915136",
      "tactical.move",
      "FFCC_nomad_concludeMove_210",
      "Done moving",
      { action: "done", position: "210", tileId: "64" },
      at - 40_000,
    );
    const conclude = prompt(
      "d1559026233507971072",
      "tactical.conclude",
      "FFCC_nomad_doneWithTacticalAction",
      "Conclude Tactical Action",
      { action: "conclude" },
      at - 20_000,
    );
    const run = (open: Decision[], waitedMs: number, force = false) =>
      chooseTyped(menu, state, KAPPA, {
        history: [],
        open,
        all: [menu, ...open],
        waitedMs,
        force,
      })?.option?.id ?? null;
    // What happened live: nothing in flight known → pass after the grace.
    assert.equal(run([], 13_000), "FFCC_nomad_passingAbilities");
    // With the action's prompts open: nothing, not even forced.
    assert.equal(
      actionInFlight(KAPPA, [move, conclude], at),
      "tactical.move open",
    );
    assert.equal(run([move, conclude], 13_000), null);
    assert.equal(run([conclude], 600_000, true), null);
    // An end-turn / strategy-card menu waits too.
    const end = clone(menu);
    end.options = [
      {
        ...menu.options[0],
        id: "FFCC_nomad_turnEnd",
        label: "End Turn",
        handler: "turnEnd",
        value: { action: "end_turn", abilities: false },
      },
    ] as any;
    assert.equal(
      chooseTyped(end, state, KAPPA, {
        history: [],
        open: [conclude],
        all: [],
      }),
      null,
    );
    // A leftover from long ago (watchdog's business) does not block the turn.
    assert.equal(
      run([{ ...move, createdAt: at - 11 * 60_000 } as Decision], 13_000),
      "FFCC_nomad_passingAbilities",
    );
  },
);

// Folded end-of-turn menu (end-turn branch): plain End Turn, the end-of-turn abilities (untyped, e.g. the expedition)
// and "take another action" (Master Plan in hand) on one menu: the bot ends its turn, never opens the abilities.
check("folded end-of-turn menu: bot presses the plain End Turn", () => {
  const KAPPA = "1559015287133700096";
  const state = PBD181_STATE as unknown as GameState;
  const d = clone(LIVE.pbd161.decision);
  d.game = "pbd181";
  d.createdAt = Date.now() - 5_000;
  d.target = { userId: KAPPA, faction: "nomad", color: "yellow", resolvedBy: "owner_prefix" } as any;
  const base = d.options[0];
  d.options = [
    { ...base, id: "FFCC_nomad_confirmSecondAction", label: "Use Ability To Do Another Action", handler: "confirmSecondAction", value: { action: "another_action", sources: ["Master Plan"] } },
    { ...base, id: "FFCC_nomad_turnEnd", label: "End Turn", handler: "turnEnd", value: { action: "end_turn", abilities: false } },
    { ...base, id: "FFCC_nomad_expeditionInfoAndButtons", label: "Do an Expedition (3 Remaining)", handler: "expeditionInfoAndButtons", value: null },
  ] as any;
  assert.equal(chooseTyped(d, state, KAPPA, { history: [], open: [], all: [d] })?.option?.id, "FFCC_nomad_turnEnd");
});

// Warfare primary follow-ups (offer, remove-a-token, token panel) keep the strategic action in flight.
{
  const now = Date.now();
  const d = (kind: string, value: unknown) => ({ id: "w", kind, target: { userId: "u1" }, createdAt: now, options: [{ id: "o", value }] }) as unknown as Decision;
  assert.equal(actionInFlight("u1", [d("choose.confirm", { source: "warfare", confirm: true, choice: "tactical" })], now), "choose.confirm open");
  assert.equal(actionInFlight("u1", [d("choose.system", { source: "remove_cc", tile: "101" })], now), "choose.system open");
  assert.equal(actionInFlight("u1", [d("command_tokens.adjust", { action: "adjust", pool: "tactic", delta: 1 })], now), "command_tokens.adjust open");
  assert.equal(actionInFlight("u1", [d("choose.confirm", { source: "minister_peace", confirm: true })], now), null);
  n++;
}

console.log(`turn.check: ${n} ok`);
