import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButton, ChoiceButtons } from "../ui/ChoiceButtons";
import { Details, ScArt, scDefinition } from "../ui/parts";
import { playerByFaction, type RendererProps } from "./types";
import classes from "./renderers.module.css";

const PICK = /^scPick_(\d+)/;

function pickNumber(c: Choice) {
  const n = baseId(c.customId).match(PICK)?.[1];
  return n ? Number(n) : undefined;
}

type Tile = { initiative: number; choice: Choice; tradeGoods: number };

function CardTexts({ initiative, web, which }: {
  initiative: number;
  web: RendererProps["data"]["web"];
  which: ("primary" | "secondary")[];
}) {
  const def = scDefinition(initiative, web);
  if (!def) return null;
  return (
    <>
      {which.includes("primary") &&
        def.primaryTexts.map((t) => (
          <p key={`p${t}`} className={classes.cardText}>
            {t}
          </p>
        ))}
      {which.includes("secondary") && def.secondaryTexts.length > 0 && (
        <p className={classes.cardText}>
          <b>Others may: </b>
          {def.secondaryTexts.join(" ")}
        </p>
      )}
    </>
  );
}

/** Pick a strategy card: the free cards as small art tiles; the chosen one named, with its trade goods. */
export function ScPickBody({ d, data, onPress, pendingKey }: RendererProps) {
  const tiles: Tile[] = [];
  for (const c of d.choices) {
    const n = pickNumber(c);
    if (n === undefined) continue;
    const onTable = data.web?.strategyCards.find((s) => s.initiative === n);
    tiles.push({
      initiative: n,
      choice: c,
      tradeGoods: onTable?.tradeGoods ?? Number(c.label.match(/(\d+) Trade Good/i)?.[1] ?? 0),
    });
  }
  tiles.sort((a, b) => a.initiative - b.initiative);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const current = tiles.find((t) => t.initiative === selected);
  const def = current ? scDefinition(current.initiative, data.web) : undefined;
  const rest = d.choices.filter((c) => pickNumber(c) === undefined);
  const taken = (data.web?.strategyCards ?? []).filter((s) => s.pickedByFaction);
  return (
    <div className={classes.stack}>
      <div className={classes.scGrid} role="listbox" aria-label="Strategy cards">
        {tiles.map((t) => (
          <UnstyledButton
            key={t.initiative}
            role="option"
            aria-selected={t.initiative === selected}
            className={cx(classes.scTile, t.initiative === selected && classes.scTileSelected)}
            onClick={() => setSelected(t.initiative)}
            onDoubleClick={() => onPress(t.choice)}
          >
            <ScArt initiative={t.initiative} web={data.web} width={80} />
            {t.tradeGoods > 0 && <span className={classes.tgBadge}>+{t.tradeGoods}</span>}
            {pendingKey === t.choice.key && <Loader size={18} className={classes.tileSpinner} />}
          </UnstyledButton>
        ))}
      </div>
      {current ? (
        <>
          <p className={classes.cardText}>
            <b>{def?.name}</b>
            {current.tradeGoods > 0 &&
              ` · comes with ${current.tradeGoods} trade good${current.tradeGoods === 1 ? "" : "s"}`}
          </p>
          <ChoiceButton
            choice={{ ...current.choice, label: `Take ${def?.name ?? "this card"}`, style: 3 }}
            onPress={onPress}
            pending={pendingKey === current.choice.key}
            busy={!!pendingKey}
            emphasis
          />
          <Details label="What it does">
            <CardTexts initiative={current.initiative} web={data.web} which={["primary", "secondary"]} />
          </Details>
        </>
      ) : (
        <p className={classes.hint}>
          Tap a card to see it.
          {taken.length > 0 &&
            ` Taken: ${taken
              .map((s) => `${s.name} (${playerByFaction(data, s.pickedByFaction ?? undefined)?.userName ?? s.pickedByFaction})`)
              .join(", ")}.`}
        </p>
      )}
      <ChoiceButtons choices={rest} onPress={onPress} pendingKey={pendingKey} channelId={d.prompt.channelId} />
    </div>
  );
}

/** Buttons on a played card that only its holder uses (scoring with Imperial, ...). */
const HOLDER_ONLY = /^(score_imperial|scoreAnObjective|requestAllFollow|primaryOf)/;
const FOLLOW_ACTION = /^(sc_follow_|sc_(?!no_)\w+_follow|leadershipGenerateCCButtons)/;
const FOLLOW_NO = /^(sc_no_follow|preDeclineSC_.*_no|notFollowing)/i;

function isDecline(c: Choice) {
  return FOLLOW_NO.test(baseId(c.customId)) || /not following|don'?t follow|decline/i.test(c.label);
}

/** "Spend 1 token from your strategy pool to draw 2 action cards." → "Draw 2 action cards." */
function benefit(secondary?: string) {
  if (!secondary) return "";
  const s = secondary.replace(/^spend 1 token from your strategy pool (and )?(to )?/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Follow a strategy card: what following gives and costs, in two short lines; Follow / Don't follow. */
export function ScFollowBody({ d, data, onPress, pendingKey }: RendererProps) {
  const def = d.sc ? scDefinition(d.sc, data.web) : undefined;
  const strategy = data.me?.strategicCC;
  const leadership = d.sc === 1;
  const who = d.text.match(/played by ([^.\n]+)/)?.[1]?.replace(/\*/g, "").trim();
  const cost = leadership
    ? "Costs influence, not a strategy token."
    : `Costs 1 strategy token${strategy !== undefined ? ` — you have ${strategy}` : ""}.`;
  const choices = d.choices.map((c) => {
    if (d.optional) return c;
    if (FOLLOW_ACTION.test(baseId(c.customId))) return { ...c, label: "Follow", style: 3 };
    if (isDecline(c)) return { ...c, label: "Don't follow", style: 2 };
    return c;
  });
  return (
    <div className={classes.stack}>
      <p className={classes.cardText}>
        {d.optional ? d.text : `${who ? `${who} played ${def?.name ?? "it"}. ` : ""}${benefit(def?.secondaryTexts[0])}`}
      </p>
      {!d.optional && <p className={cx(classes.hint, strategy === 0 && !leadership && classes.warn)}>{cost}</p>}
      <ChoiceButtons
        choices={choices}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={(c) => {
          if (c.rank === "undo" || c.rank === "more") return c.rank;
          const id = baseId(c.customId);
          if (HOLDER_ONLY.test(id)) return "more";
          if (FOLLOW_ACTION.test(id) || isDecline(c) || d.optional) return "primary";
          return "more";
        }}
      />
      {d.sc && (
        <Details label="Show the card">
          <ScArt initiative={d.sc} web={data.web} width={150} />
        </Details>
      )}
    </div>
  );
}

const FOLLOW_ID = /^(sc_follow_|sc_no_follow_|sc_\w+_follow|requestAllFollow)/;

/** My own strategy card, just played: the steps that resolve it, one line each. */
export function ScPrimaryBody({ d, data, onPress, pendingKey, pressOn }: RendererProps) {
  return (
    <div className={classes.stack}>
      {(d.steps ?? []).map((step, i) => (
        <div key={step.id} className={classes.step}>
          <span className={classes.stepLabel}>
            {i + 1}. {step.title}
          </span>
          <ChoiceButtons
            choices={step.choices}
            onPress={pressOn(step)}
            pendingKey={pendingKey}
            channelId={step.prompt.channelId}
            rankOf={(c) => (c.rank === "undo" ? "more" : c.rank)}
          />
        </div>
      ))}
      <ChoiceButtons
        choices={d.choices}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={(c) => {
          if (FOLLOW_ID.test(baseId(c.customId))) return "more";
          if (c.rank === "undo" || c.rank === "more") return c.rank;
          return "primary";
        }}
      />
      {d.sc && (
        <Details label="What it does">
          <CardTexts initiative={d.sc} web={data.web} which={["primary"]} />
        </Details>
      )}
    </div>
  );
}
