import type { ReactNode } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconCards, IconFlag, IconPlayerSkipForward, IconRepeat, IconRocket } from "@tabler/icons-react";
import cx from "clsx";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { ScArt, scDefinition } from "../ui/parts";
import type { DecisionData, RendererProps } from "./types";
import classes from "./renderers.module.css";

type Action = { choice: Choice; title: string; sub: string; icon: ReactNode; tone: "go" | "card" | "stop" };

function actionOf(c: Choice, data: DecisionData): Action | null {
  const id = baseId(c.customId);
  const me = data.me;
  if (id.startsWith("tacticalAction")) {
    const n = me?.tacticalCC ?? Number(c.label.match(/\((\d+)\)/)?.[1] ?? NaN);
    return {
      choice: c,
      title: me?.tacticalCC !== undefined ? `Tactical action (${me.tacticalCC})` : "Tactical action",
      sub: Number.isNaN(n) ? "Activate a system" : `Activate a system · ${n} tactic token${n === 1 ? "" : "s"} left`,
      icon: <IconRocket size={18} stroke={1.6} />,
      tone: "go",
    };
  }
  if (id.startsWith("componentAction")) {
    return {
      choice: c,
      title: "Component action",
      sub: "Play an action card, leader, tech or ability",
      icon: <IconCards size={18} stroke={1.6} />,
      tone: "go",
    };
  }
  const sc = id.match(/^strategicAction_(\d+)/)?.[1];
  if (sc) {
    const def = scDefinition(Number(sc), data.web);
    return {
      choice: c,
      title: `Play ${def?.name ?? `strategy card ${sc}`}`,
      sub: def?.primaryTexts[0] ?? "Strategic action",
      icon: <ScArt initiative={Number(sc)} web={data.web} width={22} />,
      tone: "card",
    };
  }
  if (id.startsWith("passingAbilities")) {
    return { choice: c, title: "Pass", sub: "You are done for this round", icon: <IconFlag size={18} stroke={1.6} />, tone: "stop" };
  }
  if (id.startsWith("endOfTurnAbilities") || id.startsWith("turnEnd")) {
    return {
      choice: c,
      title: "End turn",
      sub: "Hand the turn to the next player",
      icon: <IconPlayerSkipForward size={18} stroke={1.6} />,
      tone: "stop",
    };
  }
  if (id.startsWith("confirmSecondAction")) {
    return { choice: c, title: "Take another action", sub: "Use your ability to act again", icon: <IconRepeat size={18} stroke={1.6} />, tone: "go" };
  }
  if (id.startsWith("doAnotherAction")) {
    return { choice: c, title: "Do another action", sub: "Only if a card or ability gives you one", icon: <IconRepeat size={18} stroke={1.6} />, tone: "go" };
  }
  return null;
}

/** My turn: the handful of actions TI4 allows, as a few quiet buttons; everything else folded away. */
export function TurnBody({ d, data, onPress, pendingKey }: RendererProps) {
  const actions = d.choices.map((c) => actionOf(c, data)).filter((a): a is Action => !!a);
  const used = new Set(actions.map((a) => a.choice.key));
  const rest = d.choices.filter((c) => !used.has(c.key));
  const me = data.me;
  return (
    <div className={classes.stack}>
      {me && (
        <p className={classes.hint}>
          Command tokens: {me.tacticalCC} tactic · {me.fleetCC} fleet · {me.strategicCC} strategy
        </p>
      )}
      <div className={classes.actionGrid}>
        {actions.map((a) => (
          <UnstyledButton
            key={a.choice.key}
            className={cx(classes.actionTile, classes[`tone_${a.tone}`])}
            onClick={() => onPress(a.choice)}
            disabled={!!pendingKey || a.choice.disabled}
            title={a.sub}
          >
            <span className={classes.actionIcon}>
              {pendingKey === a.choice.key ? <Loader size={16} color="currentColor" /> : a.icon}
            </span>
            <span className={classes.actionTitle}>{a.title}</span>
          </UnstyledButton>
        ))}
      </div>
      <ChoiceButtons
        choices={rest}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={(c) => (c.rank === "undo" ? c.rank : "more")}
      />
    </div>
  );
}
