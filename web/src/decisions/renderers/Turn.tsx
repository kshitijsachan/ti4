import type { ReactNode } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconCards, IconFlag, IconPlayerSkipForward, IconRocket } from "@tabler/icons-react";
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
  if (/^tacticalAction(?!Build)/.test(id)) {
    const n = me?.tacticalCC ?? Number(c.label.match(/\((\d+)\)/)?.[1] ?? NaN);
    return {
      choice: c,
      title: me?.tacticalCC !== undefined ? `Tactical action (${me.tacticalCC})` : "Tactical action",
      sub: Number.isNaN(n) ? "Activate a system" : `Activate a system · ${n} tactic token${n === 1 ? "" : "s"} left`,
      icon: <IconRocket size={18} stroke={1.6} />,
      tone: "go",
    };
  }
  if (/^componentAction(?!Res)/.test(id)) {
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
  if (id.startsWith("passForRound")) {
    return { choice: c, title: "Pass", sub: "You are done for this round", icon: <IconFlag size={18} stroke={1.6} />, tone: "stop" };
  }
  if (id.startsWith("passingAbilities")) {
    return { choice: c, title: "Pass", sub: "You are done for this round", icon: <IconFlag size={18} stroke={1.6} />, tone: "stop" };
  }
  if (id.startsWith("endOfTurnAbilities") || id.startsWith("turnEnd")) {
    const ability = /\+\d+ abilit/i.test(c.label);
    return {
      choice: c,
      title: ability ? "End turn…" : "End turn",
      sub: ability ? "You get to use an end-of-turn ability first (e.g. an expedition)" : "Hand the turn to the next player",
      icon: <IconPlayerSkipForward size={18} stroke={1.6} />,
      tone: "stop",
    };
  }
  return null;
}

/**
 * What lets me take another action this turn, from the game's own data: Fleet Logistics (2 actions a turn), Master
 * Plan in hand, Suffi An (Keleres commander, unlocked), the Minister of War law elected to me. The bot never checks.
 */
function extraActionSources(data: DecisionData): string[] {
  const me = data.me;
  if (!me) return [];
  const out: string[] = [];
  if (me.techs?.includes("fl")) out.push("Fleet Logistics");
  if ((data.hand ?? []).some((a) => /^master_plan\d*$/.test(a))) out.push("Master Plan");
  if (me.leaders?.some((l) => l.id === "kelerescommander" && !l.locked)) out.push("Suffi An");
  if (data.web?.lawsInPlay?.some((l) => l.id === "minister_war" && l.electedFaction === me.faction)) out.push("Minister of War");
  return out;
}

/** My turn: the handful of actions TI4 allows, as a few quiet buttons; everything else folded away. */
export function TurnBody({ d, data, onPress, pendingKey }: RendererProps) {
  const actions = d.choices.map((c) => actionOf(c, data)).filter((a): a is Action => !!a);
  const used = new Set(actions.map((a) => a.choice.key));
  /* One action per turn: "another action" only when something I hold grants one, and named after it; else gone. */
  const extra = extraActionSources(data);
  const rest = d.choices
    .filter((c) => !used.has(c.key))
    .filter((c) => !/^(doAnotherAction|confirmSecondAction)/.test(baseId(c.customId)) || extra.length > 0)
    .map((c) =>
      /^(doAnotherAction|confirmSecondAction)/.test(baseId(c.customId)) ? { ...c, label: `${extra.join(" / ")}: take another action`, rank: "more" as const } : c,
    );
  const me = data.me;
  /* The end-of-turn abilities prompt (End Turn / Do an Expedition / …): its abilities are the point, keep them in view. */
  const endOfTurn = /^(End of turn|Pass —)/.test(d.title);
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
        rankOf={(c) => {
          if (c.rank === "undo") return c.rank;
          if (/^(doAnotherAction|confirmSecondAction)/.test(baseId(c.customId))) return "more";
          return endOfTurn && c.rank !== "more" ? "secondary" : "more";
        }}
      />
    </div>
  );
}
