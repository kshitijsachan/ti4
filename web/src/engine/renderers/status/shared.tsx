import { Button, Group } from "@mantine/core";
import { publicObjectives } from "@/entities/data/publicObjectives";
import { secretObjectives } from "@/entities/data/secretObjectives";
import { actionCards } from "@/entities/data/actionCards";
import type { Decision, GameState, Option, PlayerState } from "../../../../../shim/src/engine/types";
import type { PlayerStatus } from "../../../../../shim/src/engine/kinds/status";
import classes from "./Status.module.css";
import { factionName } from "../../names";

/** A typed answer: an option id, or an option id with a payload (e.g. final command token pools). */
export type Answer = string | { optionId: string; payload: Record<string, unknown> };

export type StatusRendererProps<D extends Decision = Decision> = {
  decision: D;
  state: GameState | null;
  answer: (a: Answer) => void;
};

export function me(state: GameState | null): PlayerState | undefined {
  return state?.players.find((p) => p.self);
}

export function myStatus(state: GameState | null): PlayerStatus | undefined {
  const self = me(state);
  return self ? state?.status?.players[self.userId] : undefined;
}

export function playerName(state: GameState | null, userId: string) {
  const p = state?.players.find((x) => x.userId === userId);
  return p?.userName || factionName(p?.faction) || "a player";
}

export const objectiveName = (id: string | null | undefined) =>
  (id && (publicObjectives.find((o) => o.alias === id)?.name ?? secretObjectives.find((o) => o.alias === id)?.name)) || id || "";

export const actionCardName = (id: string | null | undefined) => (id && actionCards.find((a) => a.alias === id)?.name) || id || "an action card";

/** Who the table still waits on in a reaction window, by name. */
export function Waiting({ decision, state }: { decision: Decision; state: GameState | null }) {
  const w = decision.window;
  if (!w) return null;
  const self = me(state)?.userId;
  const pending = w.eligible.filter((u) => !w.responded.includes(u) && u !== self);
  if (!pending.length) return null;
  return <p className={classes.hint}>Waiting for {pending.map((u) => playerName(state, u)).join(", ")}.</p>;
}

/** Plain buttons for options outside the typed vocabulary (or a whole decision we only list). */
export function OptionButtons({ options, answer, variant = "default" }: { options: Option<unknown>[]; answer: (a: Answer) => void; variant?: string }) {
  if (!options.length) return null;
  return (
    <Group gap={6}>
      {options.map((o) => (
        <Button key={o.id} size="xs" variant={variant} disabled={o.disabled || o.needsInput} onClick={() => answer(o.id)}>
          {o.label}
        </Button>
      ))}
    </Group>
  );
}
