import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose, ResourceStrip, ScArt, Section, scDefinition } from "../ui/parts";
import { playerByFaction, type RendererProps } from "./types";
import classes from "./renderers.module.css";

const PICK = /^scPick_(\d+)/;

function pickNumber(c: Choice) {
  const n = baseId(c.customId).match(PICK)?.[1];
  return n ? Number(n) : undefined;
}

type Tile = { initiative: number; choice?: Choice; tradeGoods: number; takenBy?: string };

/** Pick a strategy card: every card on the table, the free ones pickable, with their trade goods. */
export function ScPickBody({ d, data, onPress, pendingKey }: RendererProps) {
  const picks = new Map<number, Choice>();
  for (const c of d.choices) {
    const n = pickNumber(c);
    if (n !== undefined) picks.set(n, c);
  }
  const fromWeb = data.web?.strategyCards ?? [];
  const tiles: Tile[] = fromWeb.length
    ? fromWeb.map((sc) => ({
        initiative: sc.initiative,
        choice: picks.get(sc.initiative),
        tradeGoods: sc.tradeGoods,
        takenBy: sc.pickedByFaction ?? undefined,
      }))
    : [...picks.entries()].map(([initiative, choice]) => ({
        initiative,
        choice,
        tradeGoods: Number(choice.label.match(/(\d+) Trade Good/i)?.[1] ?? 0),
      }));
  tiles.sort((a, b) => a.initiative - b.initiative);
  const firstFree = tiles.find((t) => t.choice)?.initiative;
  const [selected, setSelected] = useState<number | undefined>(firstFree);
  const current = tiles.find((t) => t.initiative === selected) ?? tiles.find((t) => t.choice);
  const rest = d.choices.filter((c) => pickNumber(c) === undefined);
  const def = current ? scDefinition(current.initiative, data.web) : undefined;
  const myScs = data.me?.scs ?? [];

  return (
    <div className={classes.stack}>
      <div className={classes.pickLayout}>
        <div className={classes.scGrid} role="listbox" aria-label="Strategy cards">
          {tiles.map((t) => {
            const owner = t.takenBy ? playerByFaction(data, t.takenBy) : undefined;
            const mine = myScs.includes(t.initiative);
            return (
              <UnstyledButton
                key={t.initiative}
                role="option"
                aria-selected={t.initiative === current?.initiative}
                className={cx(
                  classes.scTile,
                  t.initiative === current?.initiative && classes.scTileSelected,
                  !t.choice && classes.scTileTaken,
                )}
                onClick={() => setSelected(t.initiative)}
                onDoubleClick={() => t.choice && onPress(t.choice)}
                disabled={!t.choice && !mine && !owner}
              >
                <ScArt initiative={t.initiative} web={data.web} width={112} />
                {t.tradeGoods > 0 && <span className={classes.tgBadge}>+{t.tradeGoods} TG</span>}
                {!t.choice && (
                  <span className={classes.takenBadge}>{mine ? "Yours" : owner ? owner.userName : "Taken"}</span>
                )}
                {pendingKey && pendingKey === t.choice?.key && <Loader size={18} className={classes.tileSpinner} />}
              </UnstyledButton>
            );
          })}
        </div>
        {current && (
          <div className={classes.scDetail}>
            <ScArt initiative={current.initiative} web={data.web} width={236} />
            <div className={classes.scDetailMeta}>
              <span className={classes.scName}>{def?.name ?? `Card ${current.initiative}`}</span>
              {current.tradeGoods > 0 && (
                <span className={classes.tgLine}>
                  Comes with <b>{current.tradeGoods}</b> trade good{current.tradeGoods === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {current.choice ? (
              <UnstyledButton
                className={classes.bigConfirm}
                disabled={!!pendingKey}
                onClick={() => current.choice && onPress(current.choice)}
              >
                {pendingKey === current.choice.key ? <Loader size={16} color="currentColor" /> : null}
                Take {def?.name ?? "this card"}
              </UnstyledButton>
            ) : (
              <span className={classes.takenNote}>Already taken</span>
            )}
          </div>
        )}
      </div>
      <ChoiceButtons choices={rest} onPress={onPress} pendingKey={pendingKey} channelId={d.prompt.channelId} />
    </div>
  );
}

const FOLLOW_NO = /^(sc_no_follow|preDeclineSC_.*_no|notFollowing)/i;

function isDecline(c: Choice) {
  return FOLLOW_NO.test(baseId(c.customId)) || /not following|don'?t follow|decline/i.test(c.label);
}

/** Follow a strategy card: the card, its secondary, what following costs me. */
export function ScFollowBody({ d, data, onPress, pendingKey }: RendererProps) {
  const def = d.sc ? scDefinition(d.sc, data.web) : undefined;
  const strategy = data.me?.strategicCC;
  const freeFollow = d.sc === 1 || d.choices.some((c) => /without spending|for free|no token/i.test(c.label));
  return (
    <div className={classes.stack}>
      <div className={classes.followLayout}>
        {d.sc && <ScArt initiative={d.sc} web={data.web} width={168} />}
        <div className={classes.stack}>
          {def && def.secondaryTexts.length > 0 && (
            <Section label="Secondary ability">
              {def.secondaryTexts.map((t) => (
                <p key={t} className={classes.cardText}>
                  {t}
                </p>
              ))}
            </Section>
          )}
          <Section label="Cost">
            <p className={classes.cardText}>
              {freeFollow
                ? "Leadership's secondary costs influence, not a strategy token."
                : "1 command token from your strategy pool."}
              {strategy !== undefined && !freeFollow && (
                <>
                  {" "}
                  You have{" "}
                  <b className={cx(classes.num, strategy === 0 && classes.warn)}>{strategy}</b>.
                </>
              )}
            </p>
          </Section>
          <ResourceStrip me={data.me} show={d.sc === 1 ? ["strategy", "influence", "tg"] : ["strategy", "tg", "comm"]} />
        </div>
      </div>
      <Prose text={d.text} clamp={3} muted />
      <ChoiceButtons
        choices={d.choices}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={(c) => {
          if (c.rank === "undo" || c.rank === "more") return c.rank;
          return isDecline(c) ? "secondary" : "primary";
        }}
      />
    </div>
  );
}

const FOLLOW_ID = /^(sc_follow_|sc_no_follow_|sc_\w+_follow|requestAllFollow)/;

/** My own strategy card, just played: its primary ability and the buttons that resolve it. */
export function ScPrimaryBody({ d, data, onPress, pendingKey }: RendererProps) {
  const def = d.sc ? scDefinition(d.sc, data.web) : undefined;
  return (
    <div className={classes.stack}>
      <div className={classes.followLayout}>
        {d.sc && <ScArt initiative={d.sc} web={data.web} width={168} />}
        <div className={classes.stack}>
          {def && def.primaryTexts.length > 0 && (
            <Section label="Primary ability">
              {def.primaryTexts.map((t) => (
                <p key={t} className={classes.cardText}>
                  {t}
                </p>
              ))}
            </Section>
          )}
          <p className={classes.hint}>The other players are now choosing whether to follow.</p>
        </div>
      </div>
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
    </div>
  );
}
