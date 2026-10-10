import cx from "clsx";
import { Loader, UnstyledButton } from "@mantine/core";
import { getPlanetData } from "@/entities/lookup/planets";
import { FactionIcon } from "../ui/parts";
import local from "./Agenda.module.css";
import type { AgendaInfo } from "../model/classify";
import { baseId, type Choice } from "../model/controls";
import { ChoiceButtons } from "../ui/ChoiceButtons";
import { Prose } from "../ui/parts";
import type { RendererProps } from "./types";
import classes from "./renderers.module.css";

/** "For: …" / "Against: …" halves of an agenda's text. */
function outcomes(a: AgendaInfo) {
  /* "-# [Left means clockwise.]" is Discord's small-print markup. */
  const strip = (t?: string) => t?.replace(/^(for|against):\s*/i, "").replace(/(^|\s)-#\s*/g, "$1").trim();
  if (/for\/against/i.test(a.target ?? "")) {
    return [
      { label: "For", text: strip(a.text1) },
      { label: "Against", text: strip(a.text2) },
    ].filter((o) => o.text);
  }
  return [{ label: "", text: strip([a.text1, a.text2].filter(Boolean).join(" ")) }];
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
const OUTCOME = /^outcome_(.+)$/;
const EXHAUST = /^exhaustForVotes_/;
const FINALIZE = /^proceedToFinalizingVote$/;

/**
 * After choosing an outcome: exhaust planets for votes. The bot edits its message with the running tally
 * ("> Retillion (2/3) for 3 votes. For a total of 3 votes on the outcome "Winnu"").
 */
function ExhaustForVotes({ d, data, onPress, pendingKey }: Pick<RendererProps, "d" | "data" | "onPress" | "pendingKey">) {
  const content = d.prompt.message.content;
  const outcome = content.match(/on the outcome "([^"]+)"/)?.[1] ?? content.match(/chose to vote for ([^.\n]+)/i)?.[1]?.trim();
  const total = Number(content.match(/for a total of \*\*(\d+)\*\* votes?/i)?.[1] ?? 0);
  const used = [...content.matchAll(/^>\s*(.+?) \(\d+\/\d+\) for (\d+) votes?/gm)].map((m) => `${m[1]} (${m[2]})`);
  const player = data.players.find((p) => p.faction.toLowerCase() === (outcome ?? "").toLowerCase());
  const planets = d.choices.filter((c) => /^exhaustForVotes_planet_/.test(baseId(c.customId)));
  const all = d.choices.find((c) => /^exhaustForVotes_allPlanets/.test(baseId(c.customId)));
  const other = d.choices.filter((c) => EXHAUST.test(baseId(c.customId)) && c !== all && !planets.includes(c));
  const done = d.choices.find((c) => FINALIZE.test(baseId(c.customId)));
  const rest = d.choices.filter((c) => !EXHAUST.test(baseId(c.customId)) && c !== done);
  return (
    <div className={classes.stack}>
      {d.agenda && <AgendaCard agenda={d.agenda} compact />}
      <p className={local.voteFor}>
        Voting for{" "}
        {player && <FactionIcon faction={player.faction} size={16} />} <b>{player ? `${player.userName} (${outcome})` : (outcome ?? "your outcome")}</b>
        <span className={local.tally}>{total} vote{total === 1 ? "" : "s"}</span>
      </p>
      {used.length > 0 && <p className={classes.hint}>Exhausted: {used.join(", ")}</p>}
      <p className={classes.hint}>{planets.length ? "Exhaust planets for their influence, then cast your votes." : "No ready planets left to exhaust."}</p>
      {(planets.length > 0 || other.length > 0) && (
        <div className={local.outcomes}>
          {[...planets, ...other].map((c) => {
            const m = c.label.match(/^(.*?)\s*\((\d+)\)\s*$/);
            return (
              <UnstyledButton key={c.key} className={local.outcome} disabled={!!pendingKey || c.disabled} onClick={() => onPress(c)}>
                <span className={local.outcomeText}>
                  <span className={local.outcomeName}>{m ? m[1] : c.label}</span>
                  <span className={local.outcomeSub}>exhaust</span>
                </span>
                {m && <span className={local.outcomeVotes}>+{m[2]}</span>}
                {pendingKey === c.key && <Loader size={14} color="currentColor" />}
              </UnstyledButton>
            );
          })}
        </div>
      )}
      <ChoiceButtons
        choices={[
          ...(done ? [{ ...done, label: total ? `Cast ${total} vote${total === 1 ? "" : "s"}` : "Done — cast no votes", style: 3 }] : []),
          ...(all && planets.length > 1 ? [{ ...all, label: `Exhaust all (${all.label.match(/\((\d+)\)/)?.[1] ?? "?"} votes)`, style: 2 }] : []),
          ...rest,
        ]}
        onPress={onPress}
        pendingKey={pendingKey}
        channelId={d.prompt.channelId}
        rankOf={(c) => (c.rank === "undo" ? "undo" : /resetMyVote/.test(c.customId ?? "") ? "more" : FINALIZE.test(baseId(c.customId)) ? "primary" : "secondary")}
      />
    </div>
  );
}

/** Votes cast so far on each outcome, most first. */
function VoteSummary({ data }: Pick<RendererProps, "data">) {
  const counts = Object.entries(data.web?.gameState?.agenda?.outcomeVoteCounts ?? {}).sort((a, b) => b[1] - a[1]);
  if (!counts.length) return <p className={classes.hint}>No votes were cast.</p>;
  return (
    <div className={local.voteRow}>
      {counts.map(([outcome, n]) => {
        const player = data.players.find((p) => p.faction === outcome.toLowerCase() || p.color === outcome.toLowerCase());
        return (
          <span key={outcome} className={local.outcomeChip}>
            {player && <FactionIcon faction={player.faction} size={14} />}
            {player ? player.userName : (getPlanetData(outcome)?.name ?? outcome)}
            <b className={local.tallySmall}>{n}</b>
          </span>
        );
      })}
    </div>
  );
}

/** One outcome to vote for: a player (with faction icon), a planet, For / Against, … and the votes on it so far. */
function OutcomeGrid({ choices, data, onPress, pendingKey }: { choices: Choice[] } & Pick<RendererProps, "data" | "onPress" | "pendingKey">) {
  const counts = data.web?.gameState?.agenda?.outcomeVoteCounts ?? {};
  return (
    <div className={local.outcomes}>
      {choices.map((c) => {
        const key = baseId(c.customId).match(OUTCOME)?.[1] ?? "";
        const player = data.players.find((p) => p.faction === key || p.color === key);
        const planet = player ? undefined : getPlanetData(key);
        const votes = counts[key] ?? counts[c.label] ?? counts[c.label.toLowerCase()];
        return (
          <UnstyledButton key={c.key} className={local.outcome} disabled={!!pendingKey || c.disabled} onClick={() => onPress(c)}>
            {player && <FactionIcon faction={player.faction} size={20} />}
            <span className={local.outcomeText}>
              <span className={local.outcomeName}>{player ? player.userName : (planet?.name ?? c.label)}</span>
              {player && <span className={local.outcomeSub}>{c.label}{player.discordId === data.me?.discordId ? " · you" : ""}</span>}
              {planet && <span className={local.outcomeSub}>{[planet.resources, planet.influence].join("/")}</span>}
            </span>
            {votes ? <span className={local.outcomeVotes}>{votes}</span> : null}
            {pendingKey === c.key && <Loader size={14} color="currentColor" />}
          </UnstyledButton>
        );
      })}
    </div>
  );
}
const ABSTAIN = /abstain/i;

/** Vote on an agenda: the card, my votes, and the outcomes / vote counts. */
export function AgendaBody({ d, data, onPress, pendingKey }: RendererProps) {
  if (d.choices.some((c) => baseId(c.customId) === "flip_agenda")) {
    return (
      <div className={classes.stack}>
        <Prose text={d.text} clamp={3} />
        <ChoiceButtons
          choices={d.choices.map((c) => {
            const id = baseId(c.customId);
            if (id === "flip_agenda") return { ...c, label: "Reveal the agenda", style: 1 };
            if (id === "proceed_to_strategy") return { ...c, label: "Skip it — end the agenda phase", style: 2 };
            return c;
          })}
          onPress={onPress}
          pendingKey={pendingKey}
          channelId={d.prompt.channelId}
          rankOf={(c) =>
            c.rank === "undo" ? "undo" : baseId(c.customId) === "proceed_to_strategy" ? "more" : c.rank === "more" ? "more" : "primary"
          }
        />
      </div>
    );
  }
  if (d.choices.some((c) => EXHAUST.test(baseId(c.customId)))) return <ExhaustForVotes d={d} data={data} onPress={onPress} pendingKey={pendingKey} />;
  const faction = data.me?.faction;
  /* The bot keys vote counts by colour ("camouflage"), sometimes by faction. */
  const voteKey = (counts?: Record<string, number>) =>
    counts ? (counts[data.me?.color ?? ""] ?? (faction ? counts[faction] : undefined)) : undefined;
  const start = voteKey(data.web?.gameState?.agenda?.startVoteCounts);
  const cast = voteKey(data.web?.gameState?.agenda?.castVoteCounts);
  const numeric = d.choices.filter((c) => VOTE_COUNT.test(baseId(c.customId)));
  const outcomes = d.choices.filter((c) => OUTCOME.test(baseId(c.customId)));
  const others = d.choices.filter((c) => !outcomes.includes(c));
  const resolving = d.choices.some((c) => /^agendaResolution_/.test(baseId(c.customId)));
  const predicting = d.choices.some((c) => /^rider_/.test(baseId(c.customId)));
  /* "For a total of 5 votes on the outcome "Winnu". … You may confirm this, or modify this number." */
  const tallied = d.prompt.message.content.match(/total of \*\*(\d+)\*\* votes? on the outcome "([^"]+)"/i);
  const confirming = tallied
    ? {
        total: Number(tallied[1]),
        outcome: tallied[2],
        player: data.players.find((p) => p.faction.toLowerCase() === tallied[2].toLowerCase()),
      }
    : undefined;
  const rankOf = (c: Choice) => {
    if (c.rank === "undo" || c.rank === "more") return c.rank;
    if (/^autoresolve_manual$/.test(baseId(c.customId))) return "more";
    if (ABSTAIN.test(c.label)) return "secondary";
    return "primary";
  };
  return (
    <div className={classes.stack}>
      {d.agenda && <AgendaCard agenda={d.agenda} />}
      {confirming && (
        <p className={local.voteFor}>
          Voting for {confirming.player && <FactionIcon faction={confirming.player.faction} size={16} />}
          <b>{confirming.player ? `${confirming.player.userName} (${confirming.outcome})` : confirming.outcome}</b>
          <span className={local.tally}>{confirming.total} votes</span>
        </p>
      )}
      {resolving && <VoteSummary data={data} />}
      {predicting && <Prose text={d.text} clamp={3} />}
      <p className={classes.hint} hidden={outcomes.length > 0 || !!confirming || resolving || predicting}>
        {start !== undefined
          ? `You have ${start} vote${start === 1 ? "" : "s"}${cast ? ` (${cast} cast)` : ""}.`
          : data.me
            ? `${data.me.influence} influence ready.`
            : ""}
      </p>
      {outcomes.length > 0 && (
        <>
          <p className={classes.hint}>Choose the outcome to vote for{start ? ` with your ${start} vote${start === 1 ? "" : "s"}` : ""}.</p>
          <OutcomeGrid choices={outcomes} data={data} onPress={onPress} pendingKey={pendingKey} />
        </>
      )}
      <ChoiceButtons
        choices={others.map((c) => {
          const id = baseId(c.customId);
          if (/^vote$/.test(id)) return { ...c, label: "Vote", style: 3 };
          if (/^agendaResolution_/.test(id)) return { ...c, label: "Resolve with this result", style: 3 };
          if (/^autoresolve_manual$/.test(id)) return { ...c, label: "Resolve by hand instead (slash commands)", style: 2 };
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
