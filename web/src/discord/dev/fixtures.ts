import type { Channel, Command, Message, ServerFrame, User } from "../types";

/**
 * Synthetic states for the harness (`?fixtures=1`): every renderer feature in one channel, so visual
 * changes can be checked without a live game. Real captures from docs/fixtures/ can be appended here.
 */

const ME: User = { id: "1", username: "alice", global_name: "Alice" };
const BOT: User = { id: "2", username: "TI4 Bot", global_name: "TI4 Bot", bot: true };
const BOB: User = { id: "3", username: "bob", global_name: "Bob" };

const channels: Channel[] = [
  { id: "50", type: 4, name: "PBD #0-9", position: 1 },
  { id: "100", type: 0, name: "fx1-actions", parent_id: "50", position: 2, last_message_id: "1100" },
  { id: "101", type: 0, name: "fx1-table-talk", parent_id: "50", position: 1 },
  { id: "102", type: 12, name: "Cards Info-fx1-Alice", parent_id: "100" },
  { id: "103", type: 11, name: "fx1-bot-map-updates", parent_id: "100" },
  { id: "104", type: 11, name: "Info for Players new to AsyncTI4", parent_id: "101" },
  { id: "105", type: 0, name: "lobby", position: 0 },
];

const commands: Command[] = [
  {
    id: "900",
    name: "game",
    description: "Game management",
    options: [
      {
        type: 1,
        name: "create_game_button",
        description: "Create Game Creation Button",
        options: [
          { type: 3, name: "game_fun_name", description: "Fun name for the channel", required: true },
          { type: 6, name: "player1", description: "Player @playerName", required: true },
          { type: 5, name: "public", description: "Visible to everyone" },
          { type: 4, name: "vp", description: "Victory points", choices: [{ name: "10", value: 10 }, { name: "14", value: 14 }] },
        ],
      },
    ],
  },
];

let seq = 1000;
const at = (min: number) => new Date(Date.UTC(2026, 9, 9, 16, min)).toISOString();
function msg(partial: Partial<Message>, min = 0, author: User = BOT): Message {
  seq++;
  return { id: String(seq), channel_id: "100", author, content: "", timestamp: at(min), ...partial };
}

const messages: Message[] = [
  msg({
    content:
      "# Round 2 — Strategy Phase\n## Speaker: <@1>\n### Pick order\n-# subtext: the bot uses this for footnotes\n" +
      "**Bold**, *italic*, __underline__, ~~strike~~, ***bold italic***, `inline code`, ||spoiler text||, " +
      "[masked link](https://example.com), https://example.com/auto and <#101>. Role <@&10>, user <@3>, slash </game ping:900>.\n" +
      "> A quoted line with <:Cultural:1558154724144971776> emoji\n> second quote line\n" +
      "- list item one\n- list item two\n  - nested item\n1. first\n2. second\n" +
      "Timestamps: <t:1767225600:R> · <t:1767225600:f> · <t:1767225600:t>\n" +
      "```\ncode block line 1\ncode block line 2\n```",
  }, 1),
  msg({ content: "<:Cultural:1558154724144971776><:PropulsionTech:1558154661062639616>" }, 1),
  msg(
    {
      content: "<@1> it is now your turn. Use buttons to do your turn.",
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 3, custom_id: "tactical", label: "Tactical Action (4)" },
            { type: 2, style: 1, custom_id: "component", label: "Component Action (1)", emoji: { id: "1558154661062639616", name: "PropulsionTech" } },
            { type: 2, style: 2, custom_id: "pending_demo", label: "Pending (spinner)" },
            { type: 2, style: 4, custom_id: "pass", label: "Pass" },
            { type: 2, style: 2, custom_id: "dis", label: "Disabled", disabled: true },
            { type: 2, style: 5, url: "https://example.com", label: "Website" },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "pick_planet",
              placeholder: "Choose planets to exhaust",
              min_values: 1,
              max_values: 3,
              options: [
                { label: "Mecatol Rex", value: "mr", description: "1/6", emoji: { id: "1558154724144971776", name: "Cultural" } },
                { label: "Jord", value: "jord", description: "4/2" },
                { label: "Moll Primus", value: "moll", description: "4/1" },
                { label: "Lodor", value: "lodor", description: "3/1" },
              ],
            },
          ],
        },
        { type: 1, components: [{ type: 5, custom_id: "pick_user", placeholder: "Pick a player" }] },
      ],
    },
    2,
  ),
  msg(
    {
      content: "",
      embeds: [
        {
          title: "Agenda: Minister of War",
          description: "Elect Player\n**For:** The elected player gains this card.",
          color: 0x9333ea,
          fields: [
            { name: "Votes For", value: "**7** <:Cultural:1558154724144971776>", inline: true },
            { name: "Votes Against", value: "3", inline: true },
            { name: "Outcome", value: "Pending", inline: true },
            { name: "Notes", value: "Riders may be played after all votes are cast." },
          ],
          footer: { text: "Agenda phase · Round 2" },
          timestamp: at(3),
        },
      ],
    },
    3,
  ),
  msg({ content: "Thanks — I'll follow Leadership.", referenced_message: null }, 4, BOB),
  msg({ content: "Replying to that.", referenced_message: { ...msg({ content: "Thanks — I'll follow Leadership." }, 4, BOB) } }, 5, ME),
  msg({ content: "", flags: 128, interaction_metadata: { id: "x", type: 3, user: ME } }, 6),
  msg(
    {
      content: "Your secret objectives (only you can see this):",
      ephemeral: true,
      flags: 64,
      interaction_metadata: { id: "y", type: 3, user: ME },
      components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: "so_score", label: "Score Become a Martyr" }] }],
    },
    7,
  ),
  msg(
    {
      flags: 32768,
      components: [
        {
          type: 17,
          accent_color: 0xf97316,
          components: [
            { type: 10, content: "## Stage I Objectives\nRevealed this round:" },
            {
              type: 9,
              components: [{ type: 10, content: "**Corner the Market** — Control 4 planets that each have the same planet trait." }],
              accessory: { type: 2, style: 3, custom_id: "score_ctm", label: "Score" },
            },
            { type: 14, divider: true, spacing: 1 },
            {
              type: 9,
              components: [{ type: 10, content: "**Erect a Monument** — Spend 8 resources." }],
              accessory: { type: 11, media: { url: "/emojis/1558154724144971776" } },
            },
            { type: 1, components: [{ type: 2, style: 2, custom_id: "obj_info", label: "Objective info" }] },
          ],
        },
        { type: 10, content: "-# Components V2 message (flag 32768)" },
      ],
    },
    8,
  ),
];

export const fixtureFrames: ServerFrame[] = [
  {
    t: "hello",
    me: ME,
    bot_id: BOT.id,
    guild_id: "0",
    users: [{ ...ME, roles: ["10"] }, BOT, { ...BOB, roles: ["10"] }],
    roles: [{ id: "10", name: "fx1" }],
    channels,
    commands,
    bot_online: true,
  },
  { t: "history", channel_id: "100", messages, has_more: false },
  { t: "history", channel_id: "102", messages: [msg({ channel_id: "102", content: "**Action Cards (3)**\n1. Sabotage\n2. Direct Hit\n3. Upgrade", components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: "play_ac", label: "Play Sabotage" }] }] }, 9)], has_more: false },
];

/** N synthetic log lines for scroll/perf checks (`?fixtures=1&bulk=3000` in the harness). */
export function bulkFrame(n: number): ServerFrame {
  const list: Message[] = [];
  for (let i = 0; i < n; i++) {
    list.push(
      msg(
        {
          channel_id: "101",
          id: String(5_000_000 + i),
          content: `**Line ${i}** <@1> moved <:Cultural:1558154724144971776> to system ${100 + (i % 50)}.${i % 7 === 0 ? "\n> with a quoted aside" : ""}`,
          components:
            i % 9 === 0
              ? [{ type: 1, components: [{ type: 2, style: 3, custom_id: `b${i}`, label: "Confirm" }, { type: 2, style: 2, custom_id: `u${i}`, label: "UNDO" }] }]
              : undefined,
        },
        Math.floor(i / 60),
        i % 5 === 0 ? BOB : BOT,
      ),
    );
  }
  return { t: "history", channel_id: "101", messages: list, has_more: false };
}
