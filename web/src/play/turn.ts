import { useEffect, useRef } from "react";
import { usePlayerData } from "@/api/usePlayerData";
import type { PlayerDataResponse } from "@/entities/data/types";

export type TurnState = {
  /** It is my move: my draft pick, my strategy-card pick, or my action-phase turn. */
  mine: boolean;
  /** Who the table is waiting on, when it is one player. */
  waitingOn?: string;
  /** What is happening, e.g. "Strategy phase". */
  phase?: string;
};

const PHASES: Record<string, string> = {
  strategy: "Strategy phase",
  action: "Action phase",
  status: "Status phase",
  agenda: "Agenda phase",
};

/** "status.scoring" → "Status phase · scoring". */
function phaseLabel(phase?: string) {
  if (!phase) return undefined;
  const [main, step] = phase.split(".");
  if (main === "setup") return "Setup";
  const label = PHASES[main] ?? main;
  return step ? `${label} · ${step.replace(/_/g, " ")}` : label;
}

/** Whose turn it is, from the bot's live game document (and the draft while one runs). */
export function useTurn(
  gameName: string,
  myId: string | undefined,
  draft?: { mine: boolean; picking?: string },
): TurnState {
  const { data } = usePlayerData(gameName, {
    select: (d: PlayerDataResponse) => {
      const active = d.playerData.find((p) => p.active);
      return {
        phase: d.gameState?.phase,
        activeId: active?.discordId,
        activeName: active?.userName,
      };
    },
  });
  if (draft?.picking) {
    return { mine: draft.mine, waitingOn: draft.picking, phase: "Draft" };
  }
  const phase = data?.phase;
  const main = phase?.split(".")[0];
  const turnPhase = main === "strategy" || main === "action";
  return {
    mine: turnPhase && !!myId && data?.activeId === myId,
    waitingOn: turnPhase ? data?.activeName : undefined,
    phase: phaseLabel(phase),
  };
}

const ALERTS_KEY = "ti4online.alerts";

export function alertsEnabled() {
  try {
    return (
      localStorage.getItem(ALERTS_KEY) === "on" &&
      "Notification" in window &&
      Notification.permission === "granted"
    );
  } catch {
    return false;
  }
}

/** Ask for notification permission (must run from a click). Resolves to whether alerts are on. */
export async function enableAlerts(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  const result = await Notification.requestPermission();
  try {
    localStorage.setItem(ALERTS_KEY, result === "granted" ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
  return result === "granted";
}

export function disableAlerts() {
  try {
    localStorage.setItem(ALERTS_KEY, "off");
  } catch {
    /* storage unavailable */
  }
}

const BASE_TITLE = "TI4 Online";

/**
 * Puts the turn in the tab title ("▶ Your turn", or the number of prompts
 * waiting) and, when alerts are on and the tab is in the background, raises a
 * browser notification as my turn starts or a new prompt arrives.
 */
export function useTurnAlerts(
  gameName: string,
  turn: TurnState,
  promptIds: string[],
  describe: () => string,
) {
  const { mine, waitingOn } = turn;
  const count = promptIds.length;
  useEffect(() => {
    let prefix = "";
    if (mine) prefix = "▶ Your turn · ";
    else if (count) prefix = `(${count}) `;
    else if (waitingOn) prefix = `⏳ ${waitingOn} · `;
    document.title = `${prefix}${gameName} · ${BASE_TITLE}`;
  }, [mine, count, waitingOn, gameName]);
  useEffect(
    () => () => {
      document.title = BASE_TITLE;
    },
    [],
  );

  const seen = useRef<Set<string> | null>(null);
  const wasMine = useRef(mine);
  const newest = promptIds.at(-1);
  useEffect(() => {
    const known = seen.current;
    seen.current = new Set(promptIds);
    const turnStarted = mine && !wasMine.current;
    wasMine.current = mine;
    if (!known) return;
    const fresh = promptIds.some((id) => !known.has(id));
    if (!turnStarted && !fresh) return;
    if (!document.hidden && document.hasFocus()) return;
    if (!alertsEnabled()) return;
    try {
      const n = new Notification(
        turnStarted ? `Your turn in ${gameName}` : `${gameName} needs you`,
        { body: describe(), tag: `ti4-${gameName}`, icon: "/favico.png" },
      );
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* notifications unavailable */
    }
    // promptIds is summarised by newest + count.
  }, [mine, newest, count, gameName]);
}
