import type { ReactNode } from "react";
import type { Decision, GameState, Option, PlayerState } from "../../../../../shim/src/engine/types";
import { playerLabel } from "../../names";
import classes from "./strategy.module.css";

/** Props every engine renderer gets (INFRA-2 contract). */
export type RendererProps<D extends Decision = Decision> = {
  decision: D;
  state: GameState | null;
  answer: (optionIdOrPayload: string | Record<string, unknown>) => void;
};

export function viewer(state: GameState | null): PlayerState | undefined {
  return state?.players.find((p) => p.self);
}

export function playerName(state: GameState | null, faction: string | null | undefined) {
  return faction ? playerLabel(state, faction) : "";
}

export function live<V>(options: Option<V>[]) {
  return options.filter((o) => !o.disabled && !o.needsInput);
}

export function Title({ sc, children, sub }: { sc?: number; children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className={classes.title}>
        {sc !== undefined && <span className={classes.initiative}>{sc}</span>}
        {children}
      </div>
      {sub && <p className={classes.sub}>{sub}</p>}
    </div>
  );
}

export function Choice({ option, onPick, children, quiet }: { option: Option<unknown>; onPick: (id: string) => void; children?: ReactNode; quiet?: boolean }) {
  return (
    <button type="button" className={quiet ? `${classes.choice} ${classes.quiet}` : classes.choice} disabled={option.disabled || option.needsInput} onClick={() => onPick(option.id)}>
      {children ?? option.label}
    </button>
  );
}

export function Meta({ children }: { children: ReactNode }) {
  return <span className={classes.meta}>{children}</span>;
}
