/**
 * Steps.find on a production bill after its first planet (run: npx tsx src/botplay/steps.check.ts).
 * Live pbd158 04:16:47 (Bot Gamma 5): the typed production answer posted the bill without `_prompted_for`; once the bot
 * edited it after "Nar" the ping was gone, BuildJob never found it again, the tactical action never concluded and a
 * catch-all rule passed the turn. Message from the shim store (segments of #pbd158-actions).
 */
import assert from "node:assert/strict";
import { controlsOf, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";
import { Steps } from "./steps.js";

const BILL = {
  id: "1559057222015778816",
  channel_id: "1558994864077668352",
  content:
    "<:Jolnar:1558154805598355456>Bot Gamma 5 <:black:1558154751105957888>**Black** exhausted the following: \n> <:Nar:1558154633715777536> Nar <:Resources_2:1558154667840634880>\nfor a total spend of 2 resources (preceding build cost 4 resources).\n### WARNING: Have not spent enough resources yet.",
  components: [
    {
      components: [
        {
          custom_id: "spend_kraag_res",
          style: 4,
          disabled: false,
          label: "Kraag (2/1)",
          id: 3,
          type: 2,
        },
        {
          custom_id: "spend_jol_res",
          style: 4,
          disabled: false,
          label: "Jol (1/2)",
          id: 4,
          type: 2,
        },
        {
          custom_id: "spend_siig_res",
          style: 4,
          disabled: false,
          label: "Siig (0/2)",
          id: 5,
          type: 2,
        },
        {
          custom_id: "reduceTG_1_res",
          style: 4,
          disabled: false,
          label: "Spend 1 Trade Good",
          id: 6,
          type: 2,
        },
      ],
      type: 1,
      id: 1,
    },
    {
      components: [
        {
          custom_id: "reduceTG_2_res",
          style: 4,
          disabled: false,
          label: "Spend 2 Trade Goods",
          id: 8,
          type: 2,
        },
        {
          custom_id: "reduceTG_3_res",
          style: 4,
          disabled: false,
          label: "Spend 3 Trade Goods",
          id: 9,
          type: 2,
        },
        {
          custom_id: "resetSpend_res",
          style: 2,
          disabled: false,
          label: "Reset Spent Planets and Trade Goods",
          id: 10,
          type: 2,
        },
        {
          emoji: {
            name: "WarfareTech",
            animated: false,
            id: "1558154745066160128",
          },
          custom_id: "exhaustTech_aida_discount",
          style: 4,
          disabled: false,
          label: "Exhaust AI Development Algorithm (3r)",
          id: 11,
          type: 2,
        },
        {
          emoji: {
            name: "CyberneticTech",
            animated: false,
            id: "1558154656453099520",
          },
          custom_id: "useTech_st",
          style: 4,
          disabled: false,
          label: "Use Sarween Tools",
          id: 12,
          type: 2,
        },
      ],
      id: 7,
      type: 1,
    },
    {
      components: [
        {
          custom_id: "deleteButtons_tacticalAction~pay",
          style: 4,
          disabled: false,
          label: "Done Exhausting Planets",
          id: 14,
          type: 2,
        },
        {
          custom_id: "ultimateUndo_408",
          style: 2,
          disabled: false,
          label: "UNDO",
          id: 15,
          type: 2,
        },
      ],
      id: 13,
      type: 1,
    },
  ],
  timestamp: "2026-10-12T04:16:47.611Z",
  edited_timestamp: "2026-10-12T04:16:48.707Z",
  author: { id: "1558153075842220033", bot: true },
  _presses: {
    "1558994839813619712": {
      at: "2026-10-12T04:16:48.687Z",
      controls:
        "deleteButtons_tacticalAction~pay|exhaustTech_aida_discount|reduceTG_1_res|reduceTG_2_res|reduceTG_3_res|resetSpend_res|spend_jol_res|spend_kraag_res|spend_nar_res|spend_siig_res|ultimateUndo_408|useTech_st",
    },
  },
};
const GAMMA = "1558994839813619712";
const prompt = (m: typeof BILL): Prompt => ({
  ch: { id: m.channel_id, type: 0, name: "pbd158-actions" },
  m: m as any,
  controls: controlsOf(m.components as any),
});
const seat = (name: string, userId: string, prompts: Prompt[]) =>
  ({ userId, name, prompts: () => prompts }) as unknown as Seat;
const isBill = (b: string) => /^spend_/.test(b) || /^reduceTG_/.test(b);
const since = "1559057217188134912"; // the "You have 4 PRODUCTION value" post before it

// Names only Bot Gamma 5: found for Gamma, not for "Bot Gamma" (another seat whose name is a prefix) or others.
assert.equal(
  new Steps(seat("Bot Gamma 5", GAMMA, [prompt(BILL)]), "pbd158", since).find(
    "jolnar",
    isBill,
  )?.p.m.id,
  BILL.id,
);
assert.equal(
  new Steps(seat("Bot Gamma", "x", [prompt(BILL)]), "pbd158", since).find(
    "jolnar",
    isBill,
  ),
  null,
);
assert.equal(
  new Steps(seat("Bot Alpha 5", "y", [prompt(BILL)]), "pbd158", since).find(
    "firmament",
    isBill,
  ),
  null,
);

// A bill this job pressed stays ours whatever its text says now.
const plain = {
  ...BILL,
  content:
    "for a total spend of 2 resources (preceding build cost 4 resources).",
};
const job = new Steps(
  seat("Bot Gamma 5", GAMMA, [prompt(plain)]),
  "pbd158",
  since,
);
assert.equal(job.find("jolnar", isBill), null);
job.pressed.set(`${BILL.id}:spend_nar_res`, "1");
assert.equal(job.find("jolnar", isBill)?.c.custom_id, "spend_kraag_res");

// Never one locked to another faction.
const locked = {
  ...plain,
  components: [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: "FFCC_sol_spend_kraag_res",
          label: "Kraag",
          style: 1,
          disabled: false,
        },
      ],
    },
  ],
};
const other = new Steps(
  seat("Bot Gamma 5", GAMMA, [prompt(locked as any)]),
  "pbd158",
  since,
);
other.pressed.set(`${BILL.id}:x`, "1");
assert.equal(other.find("jolnar", isBill), null);

console.log("steps.check: ok");
