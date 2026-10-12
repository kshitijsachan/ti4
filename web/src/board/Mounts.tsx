import { DecisionHost } from "@/decisions";
import { CombatOutcome } from "@/decisions/renderers/combat/Outcome";
import { EngineConnecting, EngineDecisionHost, useEngineMode, useEngineRestarting } from "@/engine";
import { GameLog, type GameLogProps } from "@/gamelog";
import { HandTray } from "@/hand";

/*
 * Mount points for the modules the board hosts: the decision popup (floats
 * over the table), the hand tray (in front of you) and the game log.
 */

/** The engine-driven popup when the engine flag is on and its stream is live; the legacy one otherwise. */
export function DecisionSlot({ gameName, className, rightInset }: { gameName: string; className?: string; rightInset?: number }) {
  const mode = useEngineMode(gameName);
  const restarting = useEngineRestarting(gameName);
  if (mode === "engine") {
    return (
      <>
        <EngineDecisionHost gameName={gameName} placement="contained" rightInset={rightInset} />
        {/* Ended-combat reports still come from the log (the engine has no combat history yet). */}
        <CombatOutcome gameName={gameName} rightInset={rightInset} />
      </>
    );
  }
  if (mode === "waiting") return <EngineConnecting rightInset={rightInset} restarting={restarting} />;
  return <DecisionHost gameName={gameName} placement="contained" className={className} rightInset={rightInset} />;
}

export function HandSlot({ gameName }: { gameName: string }) {
  return <HandTray gameName={gameName} />;
}

export function LogSlot(props: GameLogProps) {
  return <GameLog {...props} />;
}
