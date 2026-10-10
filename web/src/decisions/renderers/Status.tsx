import { actionCards } from "@/entities/data/actionCards";
import { baseId } from "../model/controls";
import { reactedBy } from "../detect/pending";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { FactionIcon, Prose, ResourceStrip, Section } from "../ui/parts";
import { GainTokensBody } from "./Economy";
import { TokensBody, isTokenStep } from "./strategy/Tokens";
import type { RendererProps } from "./types";
import classes from "./Objectives.module.css";

const READY = /^pass_on_abilities$/;
const TOKENS = /^redistributeCCButtons$/;

/** "- _Political Stability_" lines of the bot's reminder, kept only when I hold that card. */
function cardsToResolve(text: string, hand?: string[]) {
  const names = [...text.matchAll(/^[-•]\s*_?([^_\n]+?)_?\s*$/gm)].map((m) => m[1].trim());
  const held = new Set(hand ?? []);
  return names.filter((name) => actionCards.some((a) => held.has(a.alias) && a.name.toLowerCase() === name.toLowerCase()));
}

/**
 * Status homework: gain and redistribute command tokens (the token prompt folds in here once opened), resolve any
 * status-phase card I hold, then say I am ready for the next phase. Shows who the table still waits on.
 */
export function StatusBody(props: RendererProps) {
  const { d, data, onPress, pressOn, pendingKey } = props;
  const ready = d.choices.find((c) => READY.test(baseId(c.customId)));
  if (!ready) return <TableStepBody {...props} />;
  const tokens = d.choices.find((c) => TOKENS.test(baseId(c.customId)));
  const rest = d.choices.filter((c) => c !== ready && c !== tokens);
  const gain = d.steps?.find((s) => s.kind === "gainTokens");
  const cards = cardsToResolve(d.prompt.message.content, data.hand);
  const next = ready.label.replace(/^ready for\s*/i, "").trim() || "the next phase";
  const players = data.players.filter((p) => p.faction && p.faction !== "neutral" && p.faction !== "null");
  const waiting = players.filter((p) => p.faction !== data.me?.faction && !reactedBy(d.prompt.message, p.faction));

  return (
    <div className={classes.stack}>
      <Section label="1 · Command tokens">
        {gain ? (
          isTokenStep(gain.choices) ? <TokensBody {...props} d={gain} onPress={pressOn(gain)} /> : <GainTokensBody {...props} d={gain} onPress={pressOn(gain)} />
        ) : (
          <>
            {data.me && <ResourceStrip me={data.me} show={["tactic", "fleet", "strategy"]} />}
            <p className={classes.hint}>Gain 2 command tokens, and move tokens between your pools if you want.</p>
            {tokens && (
              <ChoiceButtons
                choices={[{ ...tokens, label: "Gain & redistribute tokens", style: 1 }]}
                onPress={onPress}
                pendingKey={pendingKey}
                channelId={d.prompt.channelId}
                rankOf={() => "primary"}
              />
            )}
          </>
        )}
      </Section>
      {cards.length > 0 && (
        <Section label="2 · Your status-phase cards">
          <p className={classes.hint}>Play {cards.join(" or ")} from your hand now if you want to.</p>
        </Section>
      )}
      <Section label={`${cards.length ? 3 : 2} · Ready`}>
        <p className={classes.hint}>
          Your planets and cards are readied and your action card is dealt automatically. When your tokens are
          right, say you are ready for {next.toLowerCase()}.
        </p>
        <ChoiceButtons
          choices={[...rest, { ...ready, label: `Ready for ${next.toLowerCase()}`, style: 3 }]}
          onPress={onPress}
          pendingKey={pendingKey}
          channelId={d.prompt.channelId}
          rankOf={(c) => (rest.includes(c) ? "secondary" : "primary")}
        />
      </Section>
      {players.length > 1 && (
        <div className={classes.table}>
          <span className={classes.tableLabel}>
            {waiting.length ? "Waiting on " : "Everyone else is ready"}
            {waiting.map((p) => (
              <span key={p.faction} className={classes.inlinePlayer}>
                <FactionIcon faction={p.faction} size={14} /> {p.userName}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

/** A step anyone at the table can take (reveal the next objective): the bot's words and its button. */
function TableStepBody({ d, onPress, pendingKey }: RendererProps) {
  return (
    <div className={classes.stack}>
      <Prose text={d.text} clamp={3} />
      <ChoiceButtons
        choices={d.choices}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={(c) => (c.rank === "undo" ? "undo" : "primary")}
      />
    </div>
  );
}
