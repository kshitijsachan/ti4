import { useState } from "react";
import { UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { getPlanetData } from "@/entities/lookup/planets";
import type { Message } from "@/discord";
import { baseId, choicesOf, cleanLabel, idFaction, type Choice } from "../../model/controls";
import { AgendaCard } from "../Agenda";
import { FactionIcon } from "../../ui/parts";
import { Quantity, QuantityConfirm, QuantityLink, QuantityTotal, RunError, RunProgress, useAnyRunning, useRunning } from "../../ui/Quantity";
import { buttonOn, newestPrompt, pressOn, usePressPlan, type PlanStep } from "../../ui/pressPlan";
import type { DecisionData, RendererProps } from "../types";
import classes from "./counters.module.css";

const EXHAUST = /^exhaustForVotes_/;
const PLANET = /^exhaustForVotes_planet_(.+)$/;
const ALL = /^exhaustForVotes_allPlanets/;
const TG = /^exhaustForVotes_hacanCommanderTg$/;
const INF = /^exhaustForVotes_kyrocommanderInf$/;
const FINALIZE = /^proceedToFinalizingVote$/;
const RESET = /^resetMyVote$/;
const CONFIRM = /^resolveAgendaVote_(\d+)$/;
const UP = /^distinguished_(\d+)$/;
const DOWN = /^distinguishedReverse_(\d+)$/;

/** "Arc Prime (4)" → name and votes. */
function valued(c: Choice) {
  const m = c.label.match(/^(.*?)\s*\((\d+)\)\s*$/);
  if (m) return { name: m[1], votes: Number(m[2]) };
  const n = baseId(c.customId).match(/_(\d+)$/)?.[1];
  return { name: c.label, votes: n ? Number(n) : 0 };
}

/** The exhaust-for-votes prompt (planets, vote sources, Done exhausting). */
export function isVoteExhaustStep(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.some((id) => EXHAUST.test(id)) && ids.some((id) => FINALIZE.test(id));
}

/** "Confirm N votes / Modify Votes", or the bot's ±5 ladder of vote totals. */
export function isVoteTotalStep(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.some((id) => CONFIRM.test(id)) && ids.some((id) => UP.test(id) || DOWN.test(id));
}

/** The outcome being voted on, from the bot's prose ("Chose to vote for **Winnu**", "on the outcome "Winnu""). */
function outcomeOf(text: string) {
  const raw = text.match(/on the outcome "([^"]+)"/)?.[1] ?? text.match(/chose to vote for \**([^.*\n]+)/i)?.[1];
  return raw ? cleanLabel(raw).replace(/[_*]/g, "").trim() : undefined;
}

function OutcomeLine({ outcome, data, votes }: { outcome?: string; data: DecisionData; votes?: number }) {
  const key = (outcome ?? "").toLowerCase();
  const player = data.players.find((p) => p.faction.toLowerCase() === key || p.color?.toLowerCase() === key);
  const planet = player ? undefined : getPlanetData(key);
  const name = player ? `${player.userName} (${outcome})` : (planet?.name ?? outcome ?? "your outcome");
  return (
    <div className={classes.head}>
      Voting for {player && <FactionIcon faction={player.faction} size={16} />}
      <b>{name}</b>
      {votes !== undefined && <span className={classes.hint}>· {votes} already counted</span>}
    </div>
  );
}

function myInfantry(data: DecisionData) {
  const f = data.me?.faction;
  if (!f) return 0;
  let n = 0;
  for (const tile of Object.values(data.web?.tileUnitData ?? {})) {
    for (const planet of Object.values(tile?.planets ?? {})) {
      for (const u of planet?.entities?.[f] ?? []) if (u.entityType === "unit" && u.entityId === "gf") n += u.count;
    }
  }
  return n;
}

/** The numbers of a message's buttons matching `re` ("resolveAgendaVote_7" → 7), for my faction only. */
function numbersOn(m: Message | undefined, re: RegExp, faction?: string) {
  if (!m) return [];
  return choicesOf(m)
    .filter((c) => !c.disabled && mineOnly(c, faction))
    .map((c) => baseId(c.customId).match(re)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
}

/** Not locked to another faction (the next voter's prompt in the same channel). */
function mineOnly(c: Choice, faction?: string) {
  const f = idFaction(c.customId);
  return !f || !faction || f === faction;
}

/**
 * Steps the bot's vote-total prompts to a target and confirms it: "Confirm N" when N is the target, else "Modify
 * votes" / the ladder's increase and decrease buttons (the bot offers totals five at a time). `target` gets the
 * bot's own count (the first "Confirm N" seen) and returns the total to cast.
 */
function voteLadder(channelId: string, faction: string | undefined, target: (botCount: number) => number): PlanStep {
  let goal: number | undefined;
  let done = false;
  return {
    label: "Casting your votes",
    waitMs: 15_000,
    repeat: 40,
    find: (s, ctx) => {
      if (done) return null;
      const m = newestPrompt(s, channelId, ctx.lastMessageId, (id, c) => (CONFIRM.test(id) || UP.test(id)) && mineOnly(c, faction));
      const offered = numbersOn(m, CONFIRM, faction);
      if (!m || !offered.length) return null;
      if (goal === undefined) goal = Math.max(0, target(offered.length === 1 ? offered[0] : Math.min(...offered)));
      const want = goal;
      const pick = (re: RegExp | string) =>
        buttonOn(m, (id, c) => (typeof re === "string" ? id === re : re.test(id)) && mineOnly(c, faction));
      const hit = offered.includes(want) ? pick(`resolveAgendaVote_${want}`) : undefined;
      const move = want > Math.max(...offered) ? pick(UP) : (pick(DOWN) ?? pick(UP));
      const choice = hit ?? move;
      if (!choice?.customId) return null;
      if (hit) done = true;
      return { channelId, messageId: m.id, customId: choice.customId };
    },
  };
}

/**
 * Exhausting planets for votes, as one panel: planets as toggles with the votes each is worth (the bot's count), the
 * extra-vote sources it offers, trade goods for Hacan's commander as a counter, a running total, and one confirm that
 * exhausts, finalizes and casts — through the bot's "Modify votes" ladder when the total is adjusted by hand.
 */
export function VoteExhaustBody({ d, data, onPress, pendingKey }: RendererProps) {
  const plan = usePressPlan();
  const busy = useAnyRunning();
  const running = useRunning("counter:vote:");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tg, setTg] = useState(0);
  const [inf, setInf] = useState(0);
  const [adjust, setAdjust] = useState(0);
  const [adjusting, setAdjusting] = useState(false);
  const channelId = d.prompt.channelId;
  const content = d.prompt.message.content;
  const outcome = outcomeOf(content);
  const counted = Number(content.match(/for a total of \*\*(\d+)\*\* votes?/i)?.[1] ?? 0);
  const planets = d.choices.filter((c) => PLANET.test(baseId(c.customId)));
  const all = d.choices.find((c) => ALL.test(baseId(c.customId)));
  const tgChoice = d.choices.find((c) => TG.test(baseId(c.customId)));
  const infChoice = d.choices.find((c) => INF.test(baseId(c.customId)));
  const sources = d.choices.filter((c) => EXHAUST.test(baseId(c.customId)) && !planets.includes(c) && c !== all && c !== tgChoice && c !== infChoice);
  const reset = d.choices.find((c) => RESET.test(baseId(c.customId)));
  const tgEach = tgChoice && /1 vote each/i.test(tgChoice.label) ? 1 : 2;
  const tgMax = data.me?.tg ?? 0;
  const infMax = myInfantry(data);
  const toggle = (key: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const sum = [...planets, ...sources].filter((c) => picked.has(c.key)).reduce((n, c) => n + valued(c).votes, 0);
  const base = counted + sum + tg * tgEach + inf;
  const total = Math.max(0, base + adjust);
  const allPicked = planets.length > 0 && planets.every((c) => picked.has(c.key));

  const confirm = () => {
    const steps: PlanStep[] = [];
    const id = (c: Choice) => baseId(c.customId);
    if (allPicked && all && planets.length > 1) steps.push(pressOn(channelId, d.id, "Exhausting all your planets", (x) => x === id(all)));
    else
      for (const c of planets.filter((p) => picked.has(p.key)))
        steps.push(pressOn(channelId, d.id, `Exhausting ${valued(c).name}`, (x) => x === id(c)));
    for (const c of sources.filter((s) => picked.has(s.key))) steps.push(pressOn(channelId, d.id, `Using ${valued(c).name}`, (x) => x === id(c)));
    for (let i = 0; tgChoice && i < tg; i++) steps.push(pressOn(channelId, d.id, `Spending trade good ${i + 1} of ${tg}`, (x) => TG.test(x)));
    for (let i = 0; infChoice && i < inf; i++) steps.push(pressOn(channelId, d.id, `Committing infantry ${i + 1} of ${inf}`, (x) => INF.test(x)));
    steps.push(pressOn(channelId, d.id, "Totalling your votes", (x) => FINALIZE.test(x)));
    steps.push(voteLadder(channelId, data.me?.faction, (bot) => bot + adjust));
    void plan(`counter:vote:${d.id}`, steps);
  };

  if (running) {
    return (
      <div className={classes.panel}>
        {d.agenda && <AgendaCard agenda={d.agenda} compact />}
        <OutcomeLine outcome={outcome} data={data} />
        <RunProgress keyPrefix="counter:vote:" />
      </div>
    );
  }

  return (
    <div className={classes.panel}>
      {d.agenda && <AgendaCard agenda={d.agenda} compact />}
      <OutcomeLine outcome={outcome} data={data} votes={counted || undefined} />
      {planets.length > 0 ? (
        <>
          <div className={classes.sectionLabel}>
            <span>Exhaust planets for votes</span>
            <span className={classes.links}>
              <QuantityLink onClick={() => setPicked(new Set([...picked, ...planets.map((c) => c.key)]))} disabled={allPicked}>
                All{all ? ` (${valued(all).votes})` : ""}
              </QuantityLink>
              <QuantityLink onClick={() => setPicked(new Set([...picked].filter((k) => !planets.some((c) => c.key === k))))} disabled={!planets.some((c) => picked.has(c.key))}>
                None
              </QuantityLink>
            </span>
          </div>
          <div className={classes.tiles}>
            {planets.map((c) => (
              <ToggleTile key={c.key} c={c} on={picked.has(c.key)} onToggle={() => toggle(c.key)} />
            ))}
          </div>
        </>
      ) : (
        <p className={classes.hint}>No ready planets left to exhaust.</p>
      )}
      {sources.length > 0 && (
        <>
          <div className={classes.sectionLabel}>
            <span>Other votes</span>
          </div>
          <div className={classes.tiles}>
            {sources.map((c) => (
              <ToggleTile key={c.key} c={c} on={picked.has(c.key)} onToggle={() => toggle(c.key)} sub="ability" />
            ))}
          </div>
        </>
      )}
      {tgChoice && (
        <Quantity
          label="Trade goods for votes"
          hint={`${tgEach} vote${tgEach === 1 ? "" : "s"} each · you have ${tgMax}`}
          value={tg}
          onChange={setTg}
          max={tgMax}
          unit="TG"
          maxReason={tgMax ? `That is all ${tgMax} of your trade goods` : undefined}
          disabledReason={tgMax ? undefined : "You have no trade goods"}
        />
      )}
      {infChoice && (
        <Quantity
          label="Infantry to destroy for votes"
          hint="1 vote each · the game then asks which to remove"
          value={inf}
          onChange={setInf}
          max={infMax}
          disabledReason={infMax ? undefined : "You have no infantry on planets"}
        />
      )}
      {adjusting && (
        <Quantity
          label="Votes the game does not count"
          hint="A card or ability the game missed (Blood Pact is added for you). Can be negative."
          value={adjust}
          onChange={setAdjust}
          min={-base}
          max={60}
          maxShortcut={false}
        />
      )}
      <QuantityTotal
        label="Your votes"
        detail={[counted ? `${counted} counted` : "", sum ? `${sum} from planets & abilities` : "", tg ? `${tg * tgEach} from TG` : "", inf ? `${inf} from infantry` : "", adjust ? `${adjust > 0 ? "+" : ""}${adjust} by hand` : ""]
          .filter(Boolean)
          .join(" · ")}
        value={total}
      />
      <QuantityConfirm
        label={total ? `Cast ${total} vote${total === 1 ? "" : "s"}` : "Cast no votes"}
        onConfirm={confirm}
        busy={busy || !!pendingKey}
        secondary={
          <>
            {!adjusting && <QuantityLink onClick={() => setAdjusting(true)}>Adjust total</QuantityLink>}
            {reset && (
              <QuantityLink onClick={() => onPress(reset)} disabled={busy || !!pendingKey}>
                Change outcome
              </QuantityLink>
            )}
          </>
        }
      />
      <RunError />
    </div>
  );
}

function ToggleTile({ c, on, onToggle, sub }: { c: Choice; on: boolean; onToggle: () => void; sub?: string }) {
  const v = valued(c);
  const planet = getPlanetData(baseId(c.customId).match(PLANET)?.[1] ?? "");
  const detail = planet ? `${planet.resources}/${planet.influence}` : sub;
  return (
    <UnstyledButton className={classes.tile} aria-pressed={on} onClick={onToggle} disabled={c.disabled}>
      <span className={classes.check}>{on && <IconCheck size={10} stroke={3} />}</span>
      <span className={classes.tileText}>
        <span className={classes.tileName}>{v.name}</span>
        {detail && <span className={classes.tileSub}>{detail}</span>}
      </span>
      <span className={classes.tileValue}>+{v.votes}</span>
    </UnstyledButton>
  );
}

/**
 * The bot's "Confirm N votes / Modify votes" step, or its ±5 ladder: one counter set to the bot's count, and one
 * confirm that walks the ladder to the chosen total.
 */
export function VoteTotalBody({ d, data }: RendererProps) {
  const plan = usePressPlan();
  const busy = useAnyRunning();
  const running = useRunning("counter:vote:");
  const ids = d.choices.map((c) => baseId(c.customId));
  const offered = ids.map((id) => Number(id.match(CONFIRM)?.[1] ?? NaN)).filter((n) => !Number.isNaN(n));
  const single = offered.length === 1;
  const botCount = Number(d.prompt.message.content.match(/voting \**(\d+)\** votes?/i)?.[1] ?? (single ? offered[0] : NaN));
  const start = Number.isNaN(botCount) ? Math.min(...offered) : botCount;
  const [votes, setVotes] = useState(start);
  const outcome = outcomeOf(d.prompt.message.content);
  const confirm = () => void plan(`counter:vote:${d.id}`, [voteLadder(d.prompt.channelId, data.me?.faction, () => votes)]);
  return (
    <div className={classes.panel}>
      {d.agenda && <AgendaCard agenda={d.agenda} compact />}
      {outcome && <OutcomeLine outcome={outcome} data={data} />}
      {running ? (
        <RunProgress keyPrefix="counter:vote:" />
      ) : (
        <>
          {!Number.isNaN(botCount) && <p className={classes.hint}>The game counts {botCount} vote{botCount === 1 ? "" : "s"}. Change it if it missed something.</p>}
          <Quantity label="Votes to cast" value={votes} onChange={setVotes} max={Math.max(start + 60, 60)} maxShortcut={false} unit="votes" />
          <QuantityConfirm label={`Cast ${votes} vote${votes === 1 ? "" : "s"}`} onConfirm={confirm} busy={busy} />
        </>
      )}
      <RunError />
    </div>
  );
}

