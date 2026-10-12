import { useState, type ReactNode } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import { cdnImage } from "@/entities/data/cdnImage";
import { useFactionBundles } from "@/faction/data";
import type { GameState } from "../../../../../shim/src/engine/types";
import classes from "./Setup.module.css";
import { factionName } from "../../names";

export type AnswerFn = (optionIdOrPayload: string | Record<string, unknown>) => unknown;

/** Answers one option at a time and reports the engine's refusal, if any (e.g. "not your turn"). */
export function useAnswer(answer: AnswerFn) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const press = async (optionId: string) => {
    if (pending) return;
    setPending(optionId);
    setError(null);
    try {
      const r = (await answer(optionId)) as { ok?: boolean; error?: string | null } | undefined;
      if (r && r.ok === false) setError(r.error ?? "The game refused that choice.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };
  return { pending, error, press };
}

type ChoiceProps = {
  name: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  go?: boolean;
  selected?: boolean;
  disabled?: boolean;
  pending?: boolean;
  title?: string;
  onClick: () => void;
};

export function Choice({ name, sub, icon, go, selected, disabled, pending, title, onClick }: ChoiceProps) {
  return (
    <UnstyledButton
      className={cx(classes.choice, go && classes.go, selected && classes.selected)}
      disabled={disabled}
      aria-busy={pending}
      title={title}
      onClick={onClick}
    >
      {pending ? <Loader size={14} color="currentColor" /> : icon}
      <span className={classes.choiceBody}>
        <span className={classes.choiceName}>{name}</span>
        {sub && <span className={classes.choiceSub}>{sub}</span>}
      </span>
    </UnstyledButton>
  );
}

export function FactionIcon({ faction }: { faction: string | null | undefined }) {
  if (!faction) return null;
  return <img className={classes.icon} src={cdnImage(`/factions/${faction}.png`)} alt="" loading="lazy" />;
}

/** "The Barony of Letnev" when the faction data has loaded, else a readable alias. */
export function useFactionName() {
  const bundles = useFactionBundles();
  return (alias: string | null | undefined) => {
    if (!alias) return "";
    const info = bundles?.official.factions[alias] ?? bundles?.extended?.factions[alias];
    if (info?.factionName) return info.factionName;
    return factionName(alias);
  };
}

export function playerName(state: GameState | null, userId: string | null | undefined) {
  if (!userId) return "";
  return state?.players.find((p) => p.userId === userId)?.userName ?? "a player";
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className={classes.error}>{error}</p> : null;
}

/** Players the table waits on, as chips. */
export function Waiting({ state, users, label }: { state: GameState | null; users: string[]; label: string }) {
  if (!users.length) return null;
  return (
    <div className={classes.waiting}>
      <span className={classes.label}>{label}</span>
      {users.map((u) => (
        <span key={u} className={classes.chip}>
          {playerName(state, u)}
        </span>
      ))}
    </div>
  );
}
