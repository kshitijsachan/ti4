import cx from "clsx";
import type { AgendaInfo } from "../model/classify";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose } from "../ui/parts";
import type { RendererProps } from "./types";
import classes from "./renderers.module.css";

/** "For: …" / "Against: …" halves of an agenda's text. */
function outcomes(a: AgendaInfo) {
  const strip = (t?: string) => t?.replace(/^(for|against):\s*/i, "").trim();
  if (/for\/against/i.test(a.target ?? "")) {
    return [
      { label: "For", text: strip(a.text1) },
      { label: "Against", text: strip(a.text2) },
    ].filter((o) => o.text);
  }
  return [{ label: "", text: [a.text1, a.text2].filter(Boolean).join(" ") }];
}

/** The agenda card itself, as printed. */
export function AgendaCard({ agenda, compact }: { agenda: AgendaInfo; compact?: boolean }) {
  const law = /law/i.test(agenda.type ?? "");
  return (
    <div className={cx(classes.agendaCard, compact && classes.agendaCompact)}>
      <div className={classes.agendaBody}>
        <div className={classes.agendaHead}>
          <span className={classes.agendaName}>{agenda.name}</span>
          {agenda.type && <span className={cx(classes.badge, law ? classes.lawBadge : classes.directiveBadge)}>{agenda.type}</span>}
        </div>
        {agenda.target && !/for\/against/i.test(agenda.target) && <div className={classes.agendaTarget}>{agenda.target}</div>}
        {!compact &&
          outcomes(agenda).map((o) => (
            <p key={o.label} className={classes.cardText}>
              {o.label && <b>{o.label}: </b>}
              {o.text}
            </p>
          ))}
      </div>
    </div>
  );
}

const VOTE_COUNT = /^resolveAgendaVote_(\d+)/;
const ABSTAIN = /abstain/i;

/** Vote on an agenda: the card, my votes, and the outcomes / vote counts. */
export function AgendaBody({ d, data, onPress, pendingKey }: RendererProps) {
  if (d.choices.some((c) => baseId(c.customId) === "flip_agenda")) {
    return (
      <div className={classes.stack}>
        <Prose text={d.text} clamp={3} />
        <ChoiceButtons
          choices={d.choices.map((c) => (baseId(c.customId) === "flip_agenda" ? { ...c, label: "Reveal the agenda", style: 1 } : c))}
          onPress={onPress}
          pendingKey={pendingKey}
          channelId={d.prompt.channelId}
          rankOf={(c) => (c.rank === "undo" || c.rank === "more" ? c.rank : "primary")}
        />
      </div>
    );
  }
  const faction = data.me?.faction;
  const start = faction ? data.web?.gameState?.agenda?.startVoteCounts?.[faction] : undefined;
  const cast = faction ? data.web?.gameState?.agenda?.castVoteCounts?.[faction] : undefined;
  const numeric = d.choices.filter((c) => VOTE_COUNT.test(baseId(c.customId)));
  const rankOf = (c: Choice) => {
    if (c.rank === "undo" || c.rank === "more") return c.rank;
    if (ABSTAIN.test(c.label)) return "secondary";
    return "primary";
  };
  return (
    <div className={classes.stack}>
      {d.agenda && <AgendaCard agenda={d.agenda} />}
      <p className={classes.hint}>
        {start !== undefined
          ? `You have ${start} vote${start === 1 ? "" : "s"}${cast ? ` (${cast} cast)` : ""}.`
          : data.me
            ? `${data.me.influence} influence ready.`
            : ""}
      </p>
      <ChoiceButtons
        choices={d.choices.map((c) => {
          const id = baseId(c.customId);
          if (/^vote$/.test(id)) return { ...c, label: "Vote", style: 3 };
          if (/^resolveAgendaVote_0$/.test(id) || /choose to abstain/i.test(c.label)) return { ...c, label: "Abstain", style: 2 };
          return c;
        })}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={rankOf}
        gridAbove={numeric.length ? 3 : 6}
      />
    </div>
  );
}

/** Politics / agenda-deck peek: the card, and whether it goes on top or to the bottom of the deck. */
export function AgendaPeekBody({ d, onPress, pendingKey }: RendererProps) {
  const choices = d.choices.map((c) => {
    const id = baseId(c.customId);
    if (id.startsWith("topAgenda_")) return { ...c, label: "Top of the deck", style: 1 };
    if (id.startsWith("bottomAgenda_")) return { ...c, label: "Bottom of the deck", style: 2 };
    return c;
  });
  return (
    <div className={classes.stack}>
      {d.agenda ? <AgendaCard agenda={d.agenda} /> : <Prose text={d.text} clamp={6} />}
      <ChoiceButtons
        choices={choices}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={(c) => (c.rank === "secondary" ? "primary" : c.rank)}
      />
    </div>
  );
}
