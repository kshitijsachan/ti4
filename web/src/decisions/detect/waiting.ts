import { useMemo } from "react";
import { displayName, usePlay, type PlayState } from "@/discord";
import { usePlayerData } from "@/api/usePlayerData";
import type { PlayerDataResponse } from "@/entities/data/types";
import { baseId, forwardChoices, idFaction, isTableSetupPrompt } from "../model/controls";
import { findGame, type GameChannels } from "./games";

/** What the table is waiting on while the game is being set up, in plain words. */
export type SetupWaiting = {
  /** "Waiting for Bot Beta to choose a starting technology…" */
  text: string;
  /** I am among the players waited on. */
  me: boolean;
};

function names(list: string[]) {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** How far a setup has come, from the bot's game document and the prompts still up in the action log. */
export function setupWaiting(
  state: Pick<PlayState, "messages" | "users">,
  game: GameChannels,
  web: PlayerDataResponse | undefined,
  meId: string | undefined,
): SetupWaiting | undefined {
  const phase = web?.gameState?.phase ?? "";
  if (web && !phase.startsWith("setup")) return undefined;
  const players = (web?.playerData ?? []).filter((p) => p.discordId && p.faction && p.faction !== "null" && p.faction !== "neutral");
  const nameOf = (p: { discordId: string; userName: string }) => (p.discordId === meId ? "you" : p.userName);
  const waitOn = (who: typeof players, what: string): SetupWaiting => ({
    text: `Waiting for ${names(who.map(nameOf))} to ${what}…`,
    me: who.some((p) => p.discordId === meId),
  });

  /* Secret objectives dealt: everyone keeps one. */
  const discarding = players.filter((p) => (p.soCount ?? 0) > 1);
  if (discarding.length) return waitOn(discarding, "choose which secret objective to keep");

  const data = state.messages[game.actions.id];
  const log = data ? data.ids.map((id) => data.byId[id]).filter(Boolean) : [];
  /* Starting technology prompts still up ("<faction> use the buttons to choose your starting technology"). */
  /* The bot leaves these up after the pick, so a prompt only counts while its player holds fewer technologies than
     the starting-tech prompts they were given (it posts one per technology to choose, and only to tech-less players). */
  const techPrompts = new Map<string, number>();
  const bump = (key: string) => techPrompts.set(key, (techPrompts.get(key) ?? 0) + 1);
  for (const m of log) {
    if (!m.author.bot || !/starting tech/i.test(m.content)) continue;
    const choices = forwardChoices(m);
    if (!choices.length) continue;
    const f = choices.map((c) => idFaction(c.customId)).find(Boolean);
    if (f) bump(f.startsWith("keleres") ? "keleres" : f);
    else for (const u of m.mentions ?? []) bump(u.id);
  }
  const promptsFor = (p: (typeof players)[number]) =>
    techPrompts.get(p.faction.startsWith("keleres") ? "keleres" : p.faction) ?? techPrompts.get(p.discordId) ?? 0;
  const choosingTech = players.filter((p) => {
    const asked = promptsFor(p);
    return asked > 0 && (p.techs?.length ?? 0) < asked;
  });
  if (choosingTech.length) return waitOn(choosingTech, "choose a starting technology");

  /* A table-wide step (deal secrets, reveal objectives) is pressed by the server within seconds: no note for it. */
  for (let i = log.length - 1; i >= 0; i--) {
    const m = log[i];
    if (m.author.bot && isTableSetupPrompt(m)) return undefined;
  }

  /* The newest prompt addressed to someone. */
  for (let i = log.length - 1; i >= Math.max(0, log.length - 30); i--) {
    const m = log[i];
    if (!m.author.bot || !forwardChoices(m).length) continue;
    const who = (m.mentions ?? []).filter((u) => !u.bot);
    if (!who.length) continue;
    const label = who.map((u) => (u.id === meId ? "you" : displayName(state.users[u.id] ?? u)));
    return { text: `Waiting for ${names(label)}…`, me: who.some((u) => u.id === meId) };
  }
  /* The draft is on: its own screen says whose pick it is. */
  if (phase.startsWith("setup.draft") || log.some((m) => /^(milty|queueMilyPick|jwds)/i.test(forwardChoices(m).map((c) => baseId(c.customId)).join(" "))))
    return undefined;
  /* Before the draft: the game's settings (expansion, draft options) wait on whoever created it. */
  for (let i = log.length - 1; i >= Math.max(0, log.length - 30); i--) {
    const m = log[i];
    if (!m.author.bot) continue;
    const ids = forwardChoices(m).map((c) => baseId(c.customId));
    if (ids.some((id) => /^(chooseExp|miltySetup|jmf[A-Z]|startDraftSystem|setupBaseGameMode|offerGameOptionButtons|offerTEOptionButtons)/.test(id)))
      return { text: "Waiting for the game's settings to be chosen and the draft to start…", me: false };
  }
  if (!web) return undefined;
  return { text: "Setting up the table…", me: false };
}

/** `setupWaiting` for a game, live. */
export function useSetupWaiting(gameName: string): SetupWaiting | undefined {
  const channels = usePlay((s) => s.channels);
  const messages = usePlay((s) => s.messages);
  const users = usePlay((s) => s.users);
  const me = usePlay((s) => s.me);
  const { data: web } = usePlayerData(gameName);
  const game = useMemo(() => findGame(channels, gameName), [channels, gameName]);
  return useMemo(
    () => (game ? setupWaiting({ messages, users }, game, web, me?.id) : undefined),
    [game, messages, users, web, me],
  );
}
