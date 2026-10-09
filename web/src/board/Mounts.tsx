import { ActionLog, HandPanel } from "@/discord";
import { AttentionTray } from "@/play/AttentionTray";
import { useAttention } from "@/play/attention";
import type { TurnState } from "@/play/turn";
import {
  DecisionHostModule,
  GameLogModule,
  HandTrayModule,
  type GameLogProps,
} from "./modules";
import classes from "./Mounts.module.css";

/*
 * Mount points for the modules other parts of the redesign own. Until a module
 * lands, its slot shows the closest thing the old screen had, so the game stays
 * playable in between.
 */

type DecisionProps = { gameName: string; turn: TurnState };

function DecisionFallback({ gameName, turn }: DecisionProps) {
  const items = useAttention(gameName, turn.mine);
  return <AttentionTray items={items} turn={turn} />;
}

export function DecisionSlot({ gameName, turn }: DecisionProps) {
  if (DecisionHostModule) return <DecisionHostModule gameName={gameName} placement="contained" />;
  return <DecisionFallback gameName={gameName} turn={turn} />;
}

export function HandSlot({ gameName }: { gameName: string }) {
  if (HandTrayModule) return <HandTrayModule gameName={gameName} />;
  return null;
}

/** Old-style hand thread, offered from the top bar only while the hand tray is missing. */
export function HandFallbackPanel({ gameName }: { gameName: string }) {
  return <HandPanel gameName={gameName} className={classes.fill} />;
}

export const hasHandTray = !!HandTrayModule;
export const hasDecisionHost = !!DecisionHostModule;
export const hasGameLog = !!GameLogModule;

export function LogSlot(props: GameLogProps) {
  const { gameName, variant } = props;
  if (GameLogModule) return <GameLogModule {...props} />;
  if (variant === "ticker") return null;
  return <ActionLog gameName={gameName} composer={false} className={classes.fill} />;
}
