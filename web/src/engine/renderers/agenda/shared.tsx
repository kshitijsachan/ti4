import cx from "clsx";
import { Button, UnstyledButton } from "@mantine/core";
import { getPlanetData } from "@/entities/lookup/planets";
import { FactionIcon } from "@/decisions/ui/parts";
import type { AgendaState, Decision, GameState, Option } from "../../../../../shim/src/engine/types";
import classes from "./agenda.module.css";

/** An answer: an option id to press, or a structured payload (e.g. a whole vote). */
export type Answer = string | { payload: Record<string, unknown> };

export type RendererProps<D extends Decision = Decision> = {
  decision: D;
  state: GameState | null;
  answer: (a: Answer) => void;
};

/** Display name of an agenda outcome id, from engine state (player names, planet names) or the engine's own name. */
export function outcomeLabel(id: string, state: GameState | null, fallback?: string) {
  const player = state?.players.find((p) => p.faction === id || p.color === id || p.userId === id);
  if (player) return player.userName;
  if (/^(for|against)$/i.test(id)) return id[0].toUpperCase() + id.slice(1).toLowerCase();
  return fallback ?? getPlanetData(id)?.name ?? id;
}

export function factionOf(id: string, state: GameState | null) {
  return state?.players.find((p) => p.faction === id || p.color === id || p.userId === id)?.faction ?? undefined;
}

export function userName(userId: string | null | undefined, state: GameState | null) {
  return state?.players.find((p) => p.userId === userId)?.userName ?? "—";
}

/** The agenda card header: name, type and target line. */
export function AgendaHeader({ agenda }: { agenda: AgendaState | null | undefined }) {
  if (!agenda) return null;
  return (
    <div className={classes.head}>
      <span className={classes.name}>{agenda.name ?? "Agenda"}</span>
      <span className={classes.sub}>
        {agenda.type} · {agenda.target}
        {agenda.number ? ` · #${agenda.number}` : ""}
      </span>
    </div>
  );
}

/** Votes cast so far per outcome (running totals from GameState.agenda). */
export function Tally({ state }: { state: GameState | null }) {
  const outcomes = state?.agenda?.outcomes ?? [];
  if (!outcomes.length) return <p className={classes.hint}>No votes cast yet.</p>;
  const max = Math.max(1, ...outcomes.map((o) => o.votes));
  return (
    <div className={classes.section}>
      <span className={classes.label}>Votes so far</span>
      {outcomes.map((o) => (
        <div key={o.outcome} className={classes.tallyRow}>
          <FactionIcon faction={factionOf(o.outcome, state)} size={14} />
          <span className={classes.tallyName}>{outcomeLabel(o.outcome, state, o.name)}</span>
          <span className={classes.bar}>
            <span className={classes.barFill} style={{ width: `${(o.votes / max) * 100}%`, display: "block" }} />
          </span>
          <span className={classes.num}>{o.votes}</span>
          {o.riders.length > 0 && <span className={classes.sub}>{o.riders.length} rider{o.riders.length === 1 ? "" : "s"}</span>}
        </div>
      ))}
    </div>
  );
}

/** Voting order, current voter highlighted. */
export function VotingOrder({ state }: { state: GameState | null }) {
  const agenda = state?.agenda;
  if (!agenda?.votingOrder.length) return null;
  return (
    <div className={classes.order}>
      {agenda.votingOrder.map((uid) => (
        <span key={uid} className={cx(classes.seat, uid === agenda.currentVoter && classes.seatCurrent)}>
          {userName(uid, state)}
          {agenda.availableVotes[uid] !== undefined ? ` ${agenda.availableVotes[uid]}` : ""}
        </span>
      ))}
    </div>
  );
}

/** One selectable tile (outcome, planet, ...). */
export function Tile({
  name,
  sub,
  num,
  faction,
  selected,
  disabled,
  onClick,
}: {
  name: string;
  sub?: string;
  num?: number | string;
  faction?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton className={cx(classes.choice, selected && classes.selected)} disabled={disabled} onClick={onClick}>
      <FactionIcon faction={faction} size={18} />
      <span className={classes.choiceText}>
        <span className={classes.choiceName}>{name}</span>
        {sub && <span className={classes.sub}>{sub}</span>}
      </span>
      {num !== undefined && <span className={classes.num}>{num}</span>}
    </UnstyledButton>
  );
}

/** An option as the renderers read it: value fields are looked up by name with typed accessors. */
export type AnyOption = Option<Record<string, unknown>>;

export const optionsOf = (d: Decision) => d.options as AnyOption[];

/** A string field of an option's typed value. */
export function str(o: AnyOption | undefined, key: string): string | undefined {
  const v = o?.value?.[key];
  return typeof v === "string" ? v : undefined;
}

/** A number field of an option's typed value. */
export function num(o: AnyOption | undefined, key: string): number | undefined {
  const v = o?.value?.[key];
  return typeof v === "number" ? v : undefined;
}

/** Plain option buttons with labels derived from typed values (falls back to the engine label). */
export function OptionButtons({
  decision,
  answer,
  label,
}: {
  decision: Decision;
  answer: (a: Answer) => void;
  label: (o: AnyOption) => string | null | undefined;
}) {
  const opts = optionsOf(decision).filter((o) => !o.needsInput);
  return (
    <div className={classes.actions}>
      {opts.map((o) => (
        <Button key={o.id} size="xs" variant={o.style === "danger" ? "light" : o.style === "success" ? "filled" : "default"} disabled={o.disabled} onClick={() => answer(o.id)}>
          {label(o) ?? o.label}
        </Button>
      ))}
    </div>
  );
}
