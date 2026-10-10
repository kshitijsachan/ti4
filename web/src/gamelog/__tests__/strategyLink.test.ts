/// <reference types="node" />
/**
 * Strategy card plays fold their primary, follows and declines (`parentId`). Run from web/:
 * `node --test src/gamelog/__tests__/strategyLink.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogMessage } from "../parse/classify.ts";
import { buildTimeline } from "../parse/timeline.ts";
import { segText } from "../parse/markup.ts";
import { gameMessages, hasState, nameOf } from "./realData.ts";

const ARGENT = "<:Argent:1558154819473113088>Bot Beta <:peach:1558154641190027264>**Peach**";
const ARGENT_PING = "<:Argent:1558154819473113088><@1558221276219310080> <:peach:1558154641190027264>**Peach**";
const L1 = "<:L1Z1X:1558154696085078016>Bot Alpha <:orca:1558154807947165696>**Orca**";
const SARDAKK = "<:Sardakk:1558154667446370304>Solo <:black:1558154751105957888>**Black**";
const TRADE = "<:sc_5_1:1558154729849225216>⁠<:sc_5_2:1558154735285043200>";

let n = 100;
const msg = (channelName: string, content: string, minute: number): LogMessage => ({
  id: String(n++),
  channelId: channelName,
  channelName,
  content,
  embeds: [],
  attachments: [],
  hasComponents: false,
  bot: true,
  ephemeral: false,
  time: `2026-10-09T16:${String(minute).padStart(2, "0")}:00Z`,
});

void test("a strategy card play folds its primary and every response; the next turn is not folded", () => {
  const msgs = [
    msg("g-actions", "Started Round 1", 0),
    msg("g-actions", `${TRADE} played by ${ARGENT_PING}.\n\nplease indicate your choice`, 1),
    msg("g-actions", `${ARGENT} gained 3<:tg:1558154671703588864> (0 -> 3) and replenished commodities (0 -> 3<:comm:1558154810283393024>)`, 1),
    msg("g-round-1-Trade", "/art/strat_cards/base_game_5.png", 1),
    msg("g-round-1-Trade", `${L1} is not following **Trade**.`, 2),
    msg("g-round-1-Trade", `${SARDAKK} following to perform the secondary ability of **Trade**. 1 command token has been spent from strategy pool.`, 3),
    msg("g-actions", `${L1} has passed.`, 4),
  ];
  const { events } = buildTimeline(msgs);
  const play = events.find((e) => e.kind === "sc_play")!;
  assert.equal(play.scImage, "base_game_5");
  const kids = events.filter((e) => e.parentId === play.id).map((e) => segText(e.summary));
  assert.deepEqual(kids, ["gained 3 TG and replenished 3 commodities", "did not follow Trade", "followed Trade"]);
  assert.equal(events.find((e) => e.kind === "pass")?.parentId, undefined);
});

void test("real game: every follow / decline in a card's thread sits under a play", { skip: !hasState() }, () => {
  const { events } = buildTimeline(gameMessages("pbd42"), nameOf);
  const follows = events.filter((e) => e.kind === "sc_follow");
  if (!follows.length) return;
  const plays = new Map(events.filter((e) => e.kind === "sc_play").map((e) => [e.id, e]));
  for (const f of follows) {
    const play = plays.get(f.parentId ?? "");
    assert.ok(play, `unlinked: ${segText(f.summary)}`);
    assert.ok(segText(play.summary).endsWith(segText(f.summary).replace(/^(did not follow|followed) /, "")));
  }
});
