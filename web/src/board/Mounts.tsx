import { EngineDecisionHost, useEngineMode } from "@/engine";
import { CombatOutcome } from "@/engine/ui/CombatOutcome";
import { EngineStatus } from "@/engine/ui/EngineStatus";
import { GameLog, type GameLogProps } from "@/gamelog";
import { HandTray } from "@/hand";

/*
 * Mount points for the modules the board hosts: the decision popup (floats
 * over the table), the hand tray (in front of you) and the game log.
 */

/** The engine-driven popup once the game's engine stream is live; until then a "connecting to the game engine" chip. */
export function DecisionSlot({ gameName, rightInset }: { gameName: string; rightInset?: number }) {
  const mode = useEngineMode(gameName);
  return (
    <>
      <EngineStatus gameName={gameName} rightInset={rightInset} />
      {mode === "engine" && (
        <>
          <EngineDecisionHost gameName={gameName} placement="contained" rightInset={rightInset} />
          {/* Ended-combat reports still come from the log (the engine has no combat history yet). */}
          <CombatOutcome gameName={gameName} rightInset={rightInset} />
        </>
      )}
    </>
  );
}

export function HandSlot({ gameName }: { gameName: string }) {
  return <HandTray gameName={gameName} />;
}

export function LogSlot(props: GameLogProps) {
  return <GameLog {...props} />;
}
