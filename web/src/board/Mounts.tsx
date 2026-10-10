import { DecisionHost } from "@/decisions";
import { GameLog, type GameLogProps } from "@/gamelog";
import { HandTray } from "@/hand";

/*
 * Mount points for the modules the board hosts: the decision popup (floats
 * over the table), the hand tray (in front of you) and the game log.
 */

export function DecisionSlot({ gameName, className, rightInset }: { gameName: string; className?: string; rightInset?: number }) {
  return <DecisionHost gameName={gameName} placement="contained" className={className} rightInset={rightInset} />;
}

export function HandSlot({ gameName }: { gameName: string }) {
  return <HandTray gameName={gameName} />;
}

export function LogSlot(props: GameLogProps) {
  return <GameLog {...props} />;
}
