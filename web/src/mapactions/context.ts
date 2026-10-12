import { useMemo } from "react";
import { usePlay, usePlayConnection, type PlayConnection } from "@/discord";
import { usePlayerData } from "@/api/usePlayerData";
import type { PlayerData, PlayerDataResponse } from "@/entities/data/types";
import { useEngineState, useMyDecisions } from "@/engine/store";
import { STEP_KINDS, systemChoices, tacticalStep, type SystemPick, type TacticalStep } from "./step";

export type { SystemPick, TacticalStep } from "./step";

export type MapActionContext = {
  gameName: string;
  conn: PlayConnection;
  web?: PlayerDataResponse;
  me?: PlayerData;
  /** It is my action-phase turn. */
  myTurn: boolean;
  step: TacticalStep;
  /** My newest other decision whose options are systems on the map (map clicks can answer it). */
  pick: SystemPick | null;
};

/** Everything the map's actions need: the connection, my seat, the game document and the step the engine waits on. */
export function useMapActionContext(gameName: string, systemNames: Record<string, string>): MapActionContext {
  const conn = usePlayConnection();
  const meUser = usePlay((s) => s.me);
  const { data: web } = usePlayerData(gameName);
  const state = useEngineState(gameName);
  const decisions = useMyDecisions();
  const me = useMemo(() => web?.playerData.find((p) => p.discordId === meUser?.id), [web, meUser]);
  const myTurn = !!state && !!meUser && state.activePlayer === meUser.id && /^action/i.test(state.phase ?? "");

  const active = web?.gameState?.activeSystem;
  const step = useMemo<TacticalStep>(
    () => (myTurn ? tacticalStep(decisions, active && active !== "null" ? active : null) : { kind: "none" }),
    [decisions, myTurn, active],
  );

  const pick = useMemo<SystemPick | null>(() => {
    /* Only the newest decision: a map click must never answer a question the player has moved past. */
    const newest = [...decisions].sort((a, b) => b.seq - a.seq)[0];
    if (!newest || STEP_KINDS.has(newest.kind)) return null;
    const byPosition = systemChoices(newest, systemNames);
    return byPosition ? { decision: newest, byPosition } : null;
  }, [decisions, systemNames]);

  return { gameName, conn, web, me, myTurn, step, pick };
}
