import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePlay, useChannelMessages } from "@/discord";
import { isHandThread } from "@/discord/channels/GamePanels";
import { usePlayerData } from "@/api/usePlayerData";
import { fetchJson } from "@/api/fetchJson";
import { config } from "@/config";
import { getToken } from "@/play/session";
import type { PlayerDataResponse } from "@/entities/data/types";
import { buildHand, type CardGroup, type HandResponse } from "./model";
import { actionTakenThisTurn, assignNumbers, indexThread, sabotageWindow, type BotButton, type ThreadIndex } from "./botThread";
import { useCardData } from "./cardData";

const POLL_MS = 45_000;

export function handQueryKey(gameName: string) {
  return ["playerHand", gameName];
}

function fetchHand(gameName: string, token: string | null) {
  return fetchJson<HandResponse>(
    `${config.api.botApiUrl}/game/${encodeURIComponent(gameName)}/hand`,
    "hand",
    { init: { headers: token ? { Authorization: `Bearer ${token}` } : {} } },
  );
}

export type HandState = {
  groups: CardGroup[];
  /** Bot number of each card (by card key), where the bot has listed it. */
  numbers: Map<string, number>;
  index: ThreadIndex;
  threadId?: string;
  /** The game's `<game>-actions` channel, where the bot announces plays. */
  actionsId?: string;
  meId?: string;
  myColor?: string;
  gameState?: PlayerDataResponse["gameState"];
  players: PlayerDataResponse["playerData"];
  loading: boolean;
  error?: string;
  /** Cards the bot has not listed with a number yet (its listing is stale). */
  unnumbered: number;
  /** Action cards held and the hand limit; the bot refuses every action card play while over it. */
  acHeld: number;
  acLimit: number;
  /** This turn's action is spent, so "Action:" cards wait for the next turn. */
  actionTaken: boolean;
  /** Another player's action card waiting on Sabotage answers: the bot's cancel button for it. */
  sabotage?: BotButton;
};

/**
 * The seat's hand: card ids from the per-seat hand endpoint, public extras
 * (scored secrets, relics, fragments, notes in play) from web-data, and the
 * bot's play/discard/score buttons from the private cards-info thread.
 */
export function useHand(gameName: string, token?: string): HandState {
  const queryClient = useQueryClient();
  const seatToken = token ?? getToken();
  const meId = usePlay((s) => s.me?.id);
  const threadId = usePlay((s) => {
    for (const id in s.channels) if (isHandThread(s.channels[id].name, gameName)) return id;
    return undefined;
  });
  const actionsId = usePlay((s) => {
    for (const id in s.channels) if (s.channels[id].name === `${gameName}-actions`) return id;
    return undefined;
  });
  const thread = useChannelMessages(threadId);
  const actionsChannel = useChannelMessages(actionsId);
  const web = usePlayerData(gameName);

  const hand = useQuery({
    queryKey: handQueryKey(gameName),
    queryFn: () => fetchHand(gameName, seatToken),
    enabled: !!seatToken,
    refetchInterval: POLL_MS,
    staleTime: 5_000,
  });

  const players = useMemo(
    () => (web.data?.playerData ?? []).filter((p) => p.faction && p.faction !== "neutral"),
    [web.data],
  );
  const me = players.find((p) => p.discordId === meId);

  // Refetch the hand whenever the public card counts move or the bot posts in the thread.
  const signature = me
    ? [me.acCount, me.soCount, me.pnCount, Object.keys(me.secretsScored ?? {}).length,
       me.promissoryNotesInPlayArea?.length, me.relics?.length, me.fragments?.length].join(".")
    : "";
  const newestId = thread.ids[thread.ids.length - 1];
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: handQueryKey(gameName) }),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [signature, newestId, gameName, queryClient]);

  const cardDataReady = useCardData();
  const groups = useMemo(
    () => buildHand(hand.data, me, players),
    // cardDataReady: rebuild once the supplementary card text has loaded.
    [hand.data, me, players, cardDataReady],
  );
  const index = useMemo(() => indexThread(thread), [thread]);
  const numbers = useMemo(() => {
    const out = new Map<string, number>();
    const byKind = (kind: string) => groups.flatMap((g) => g.cards).filter((c) => c.kind === kind);
    const unscoredSos = byKind("so").filter((c) => !c.scored);
    for (const [k, v] of assignNumbers(byKind("ac"), index.acNumbers)) out.set(k, v);
    for (const [k, v] of assignNumbers(unscoredSos, index.soNumbers)) out.set(k, v);
    for (const [k, v] of assignNumbers(byKind("pn").filter((c) => !c.inPlayArea), index.pnNumbers))
      out.set(k, v);
    return out;
  }, [groups, index]);

  const unnumbered = groups
    .flatMap((g) => g.cards)
    .filter((c) => c.kind === "ac" || (c.kind === "so" && !c.scored))
    .filter((c) => !numbers.has(c.key)).length;

  const actionTaken = useMemo(() => actionTakenThisTurn(actionsChannel), [actionsChannel]);
  const sabotage = useMemo(() => sabotageWindow(actionsChannel, me?.faction), [actionsChannel, me?.faction]);
  const acHeld = groups.find((g) => g.id === "ac")?.cards.length ?? 0;

  return {
    groups,
    numbers,
    index,
    threadId,
    actionsId,
    meId,
    myColor: me?.color,
    gameState: web.data?.gameState,
    players,
    loading: hand.isLoading || web.isLoading,
    error: hand.error ? String(hand.error.message) : undefined,
    unnumbered,
    acHeld,
    acLimit: index.acLimit ?? 7,
    actionTaken,
    sabotage,
  };
}
