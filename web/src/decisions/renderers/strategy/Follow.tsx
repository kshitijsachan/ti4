import cx from "clsx";
import { baseId, type Choice } from "../../model/controls";
import { ChoiceButton, ChoiceButtons } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { DECLINE, SPEND_ONLY, cardSpec, findChoice, type FollowAction } from "./cards";
import { scDefinition } from "../../ui/parts";
import { CardHeader, FollowStatus, holderOf, playerLabel } from "./shared";
import classes from "./strategy.module.css";

/** Buttons on the played card that only its holder uses, or that are Discord-era helpers. */
const NOT_FOR_FOLLOWERS = /^(score_imperial|scoreAnObjective|requestAllFollow|primaryOf|diploSystem|constructionPrimary|transaction|sendTradeHolder_)/;
/** Free replenishment the Trade holder may grant by deal. */
const TRADE_FREE = /^(sc_refresh|sc_refresh_and_wash)$/;

/**
 * Someone else played a strategy card: what following gives, what it costs (with my token count before → after),
 * one "Follow — …" button per way to follow (the card's own action button, which also takes the token) and
 * "Don't follow". Underneath, who has answered so far.
 */
export function StrategyFollowBody({ d, data, onPress, pendingKey }: RendererProps) {
  const sc = d.sc!;
  const spec = cardSpec(sc, scDefinition(sc, data.web)?.id);
  const holder = holderOf(sc, data);
  const strategy = data.me?.strategicCC;
  const busy = !!pendingKey;

  const actions = (spec?.follow ?? [])
    .map((a) => ({ a, choice: findChoice(d.choices, a.id) }))
    .filter((x): x is { a: FollowAction; choice: Choice } => !!x.choice);
  const spendOnly = findChoice(d.choices, SPEND_ONLY);
  const decline = findChoice(d.choices, DECLINE);
  const free = d.choices.filter((c) => TRADE_FREE.test(baseId(c.customId)) && !c.disabled);
  const used = new Set([...actions.map((x) => x.choice), spendOnly, decline, ...free].filter(Boolean));
  const rest = d.choices.filter((c) => !used.has(c) && !NOT_FOR_FOLLOWERS.test(baseId(c.customId)));

  const noTokens = spec?.token && strategy === 0;
  const followButtons = actions.length
    ? actions.map(({ a, choice }) => ({ ...choice, label: a.label, style: 3 }))
    : spendOnly
      ? [{ ...spendOnly, label: "Follow", style: 3 }]
      : [];

  return (
    <div className={classes.panel}>
      <CardHeader sc={sc} data={data} sub={holder ? `Played by ${playerLabel(holder)}` : undefined}>
        <p className={classes.effect}>{spec?.secondary ?? d.text}</p>
      </CardHeader>
      {sc === 5 && data.me && (
        <p className={cx(classes.sub, data.me.commodities >= data.me.commoditiesTotal && classes.warn)}>
          Commodities {data.me.commodities}/{data.me.commoditiesTotal}
          {data.me.commodities >= data.me.commoditiesTotal ? " — already full, following gains nothing" : ` → ${data.me.commoditiesTotal}/${data.me.commoditiesTotal}`}
        </p>
      )}
      <div className={classes.cost}>
        {spec?.token ? (
          <span className={cx(noTokens && classes.warn)}>
            Costs 1 strategy token
            {strategy !== undefined && (
              <>
                {" · you have "}
                <span className={classes.costValue}>{strategy}</span>
                {strategy > 0 && (
                  <>
                    {" → "}
                    <span className={classes.costValue}>{strategy - 1}</span>
                  </>
                )}
              </>
            )}
            {noTokens && " — you cannot follow"}
          </span>
        ) : (
          <span>Costs influence, not a strategy token{data.me ? ` · ${data.me.influence} influence ready` : ""}</span>
        )}
      </div>
      <div className={classes.actions}>
        <div className={classes.actionRow}>
          {followButtons.map((c) => (
            <ChoiceButton
              key={c.key}
              choice={{ ...c, disabled: c.disabled || !!noTokens }}
              onPress={onPress}
              pending={pendingKey === c.key}
              busy={busy}
              emphasis
            />
          ))}
          {decline && (
            <ChoiceButton
              choice={{ ...decline, label: "Don't follow", style: 2 }}
              onPress={onPress}
              pending={pendingKey === decline.key}
              busy={busy}
              emphasis
            />
          )}
        </div>
        {free.length > 0 && (
          <>
            <span className={classes.sectionLabel}>Free, if {holder ? playerLabel(holder) : "the Trade holder"} agreed to it</span>
            <div className={classes.actionRow}>
              {free.map((c) => (
                <ChoiceButton
                  key={c.key}
                  choice={{
                    ...c,
                    style: 2,
                    label: /wash/.test(baseId(c.customId)) ? "Replenish and wash (to trade goods)" : "Replenish for free",
                  }}
                  onPress={onPress}
                  pending={pendingKey === c.key}
                  busy={busy}
                  compact
                />
              ))}
            </div>
          </>
        )}
      </div>
      <FollowStatus sc={sc} data={data} />
      {rest.length > 0 && (
        <ChoiceButtons
          choices={rest}
          onPress={onPress}
          pendingKey={pendingKey}
          channelId={d.prompt.channelId}
          rankOf={(c) => (c.rank === "undo" ? "undo" : "more")}
        />
      )}
    </div>
  );
}
