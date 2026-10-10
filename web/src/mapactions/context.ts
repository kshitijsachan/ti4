import { useMemo } from "react";
import { usePlay, usePlayConnection, type PlayConnection } from "@/discord";
import { usePlayerData } from "@/api/usePlayerData";
import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import { usePendingPrompts, type PendingPrompt } from "@/decisions";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { findGame } from "@/decisions/detect/games";
import { baseId } from "@/decisions/model/controls";
import { buttonsOf, type Scope } from "./driver";

/** Which step of a tactical action the bot is waiting on me for, read from its newest prompt to me. */
export type TacticalStep =
  | { kind: "turn"; prompt: PendingPrompt }
  | { kind: "choose"; prompt: PendingPrompt }
  | { kind: "move"; prompt: PendingPrompt; target: string }
  | { kind: "land"; prompt: PendingPrompt; target: string }
  | { kind: "none" };

export type MapActionContext = {
  gameName: string;
  conn: PlayConnection;
  scope: Scope;
  web?: PlayerDataResponse;
  me?: PlayerData;
  /** It is my action-phase turn. */
  myTurn: boolean;
  step: TacticalStep;
};

const CHOOSE = /^(ringTile_|ring_|getTilesThisFarAway_)/;
const MOVE = /^(tacticalMoveFrom_|concludeMove_)/;
const LAND = /^(landUnits_|doneLanding)/;

function stepOf(prompt: PendingPrompt, faction?: string, active?: string | null): TacticalStep | null {
  const ids = buttonsOf(prompt.message, faction).map((c) => baseId(c.customId));
  if (ids.some((id) => LAND.test(id))) {
    const target = ids.map((id) => id.match(/^(?:landUnits|doneLanding)_([^_]+)/)?.[1]).find(Boolean) ?? active ?? "";
    return { kind: "land", prompt, target };
  }
  if (ids.some((id) => /^concludeMove_/.test(id))) {
    const target = ids.map((id) => id.match(/^concludeMove_(\w+)/)?.[1]).find(Boolean) ?? active ?? "";
    return { kind: "move", prompt, target };
  }
  if (ids.some((id) => MOVE.test(id)) && active) return { kind: "move", prompt, target: active };
  if (ids.some((id) => CHOOSE.test(id))) return { kind: "choose", prompt };
  if (ids.includes("tacticalAction")) return { kind: "turn", prompt };
  return null;
}

/** Everything the map's actions need: the connection, my seat, the game document and the step the bot waits on. */
export function useMapActionContext(gameName: string): MapActionContext {
  const conn = usePlayConnection();
  const meUser = usePlay((s) => s.me);
  const channels = usePlay((s) => s.channels);
  const { data: web } = usePlayerData(gameName);
  const me = useMemo(() => web?.playerData.find((p) => p.discordId === meUser?.id), [web, meUser]);
  const phase = web?.gameState?.phase?.split(".")[0];
  const myTurn = !!me?.active && phase === "action";
  const prompts = usePendingPrompts(gameName, { myTurn: !!me?.active, faction: me?.faction, setupOpen: true });
  const game = useMemo(() => findGame(channels, gameName), [channels, gameName]);

  const scope = useMemo<Scope>(
    () => ({
      channelIds: game ? [game.actions.id, game.hand?.id, ...game.threads.slice(0, 6).map((t) => t.id)].filter((x): x is string => !!x) : [],
      faction: me?.faction,
    }),
    [game, me?.faction],
  );

  const active = web?.gameState?.activeSystem;
  const step = useMemo<TacticalStep>(() => {
    if (!myTurn) return { kind: "none" };
    const newestFirst = [...prompts].sort((a, b) => compareSnowflakes(b.message.id, a.message.id));
    for (const p of newestFirst) {
      const s = stepOf(p, me?.faction, active && active !== "null" ? active : null);
      if (s) return s;
    }
    return { kind: "none" };
  }, [prompts, myTurn, me?.faction, active]);

  return { gameName, conn, scope, web, me, myTurn, step };
}
