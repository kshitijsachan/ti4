import { useMemo, useState } from "react";
import { Button } from "@mantine/core";
import { getPlanetData } from "@/entities/lookup/planets";
import type { AgendaPreassign, AgendaVote, Ballot } from "../../../../../shim/src/engine/types";
import { AgendaHeader, Tally, Tile, VotingOrder, factionOf, optionsOf, outcomeLabel, str, type RendererProps } from "./shared";
import classes from "./agenda.module.css";

/**
 * Cast a vote in one answer: pick an outcome, tick the planets to exhaust (their votes add up live), cast.
 * Totals so far and the voting order come from GameState.agenda; the ballot (outcomes, ready planets with their
 * vote values, votes available) from the vote option's typed value.
 */
export function VotePanel({ decision, state, answer }: RendererProps<AgendaVote | AgendaPreassign>) {
  const options = optionsOf(decision);
  const voteOption = options.find((o) => str(o, "action") === "vote" || str(o, "preset") === "prevote");
  const abstain = options.find((o) => str(o, "action") === "abstain" || str(o, "preset") === "abstain");
  const ballot = voteOption?.value as Ballot | undefined;
  const prevote = str(voteOption, "preset") === "prevote";
  const [outcome, setOutcome] = useState<string | null>(null);
  const [planets, setPlanets] = useState<string[]>(() => ballot?.planets.map((p) => p.planet) ?? []);
  const selectedVotes = useMemo(
    () => (ballot?.planets ?? []).filter((p) => planets.includes(p.planet)).reduce((n, p) => n + p.votes, 0),
    [ballot, planets],
  );
  const castSoFar = useMemo(() => Object.fromEntries((state?.agenda?.outcomes ?? []).map((o) => [o.outcome, o.votes])), [state]);

  const toggle = (planet: string) => setPlanets((cur) => (cur.includes(planet) ? cur.filter((p) => p !== planet) : [...cur, planet]));
  const cast = () => {
    if (outcome) answer({ payload: { outcome, planets } });
  };
  const castLabel = outcome
    ? `${prevote ? "Pre-vote" : "Cast"} ${selectedVotes} vote${selectedVotes === 1 ? "" : "s"} for ${outcomeLabel(outcome, state)}`
    : "Choose an outcome";

  return (
    <div className={classes.panel}>
      <AgendaHeader agenda={state?.agenda} />
      <Tally state={state} />
      <VotingOrder state={state} />
      {ballot && (
        <>
          <div className={classes.section}>
            <span className={classes.label}>Outcome</span>
            <div className={classes.grid}>
              {ballot.outcomes.map((o) => (
                <Tile
                  key={o.id}
                  name={outcomeLabel(o.id, state, o.name)}
                  faction={factionOf(o.id, state)}
                  num={castSoFar[o.id] || undefined}
                  selected={outcome === o.id}
                  onClick={() => setOutcome(o.id)}
                />
              ))}
            </div>
          </div>
          <div className={classes.section}>
            <span className={classes.label}>
              Planets to exhaust · {ballot.available} vote{ballot.available === 1 ? "" : "s"} available
            </span>
            {ballot.planets.length === 0 && <p className={classes.hint}>No ready planets with votes.</p>}
            <div className={classes.grid}>
              {ballot.planets.map((p) => (
                <Tile
                  key={p.planet}
                  name={getPlanetData(p.planet)?.name ?? p.planet}
                  sub={planets.includes(p.planet) ? "exhaust" : "keep ready"}
                  num={`+${p.votes}`}
                  selected={planets.includes(p.planet)}
                  onClick={() => toggle(p.planet)}
                />
              ))}
            </div>
          </div>
        </>
      )}
      <div className={classes.actions}>
        {voteOption && (
          <Button size="xs" disabled={!outcome || voteOption.disabled} onClick={cast}>
            {castLabel}
          </Button>
        )}
        {abstain && (
          <Button size="xs" variant="default" disabled={abstain.disabled} onClick={() => answer(abstain.id)}>
            {prevote ? "Pre-abstain" : "Abstain"}
          </Button>
        )}
        <span className={classes.meter}>{selectedVotes}</span>
      </div>
    </div>
  );
}
