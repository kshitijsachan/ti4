import { useState } from "react";
import { UnstyledButton } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import cx from "clsx";
import { PopupLayer } from "@/decisions/ui/DecisionHost";
import hostClasses from "@/decisions/ui/DecisionHost.module.css";
import type { Decision } from "./contract";
import { useEngineAnswer } from "./link";
import { rendererFor } from "./registry";
import { engineStore, useEngine, useMyDecisions } from "./store";
import classes from "./EngineDecisionHost.module.css";

type Props = {
  placement?: "fixed" | "contained";
  rightInset?: number;
};

/** "strategy_card.pick" → "Strategy card pick"; untyped prompts are just "Your move". */
export function decisionTitle(d: Decision): string {
  if (d.kind === "legacy") return d.scope === "table" ? "Open to everyone" : "Your move";
  const words = d.kind.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The decision popup driven by the engine stream: my open decisions, one at a time (oldest first), each drawn by its
 * kind's renderer from src/engine/renderers, or as plain option buttons when the kind has none.
 */
export function EngineDecisionHost({ placement = "contained", rightInset = 0 }: Props) {
  const decisions = useMyDecisions();
  const state = useEngine((s) => s.view.state);
  const pending = useEngine((s) => s.view.pending);
  const errors = useEngine((s) => s.view.errors);
  const answer = useEngineAnswer();
  const [jumpId, setJumpId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const shown = decisions.find((d) => d.id === jumpId) ?? decisions[0];
  if (!shown) return null;
  const Renderer = rendererFor(shown.kind);
  const more = decisions.length - 1;
  const error = errors[shown.id];

  return (
    <PopupLayer placement={placement} rightInset={rightInset}>
      <section
        key={shown.id}
        className={hostClasses.card}
        role="dialog"
        aria-modal="false"
        aria-label={decisionTitle(shown)}
        data-engine-decision={shown.kind}
      >
        <header className={hostClasses.head}>
          <div className={hostClasses.headTop}>
            <div className={hostClasses.titles}>
              {shown.scope === "table" && <span className={hostClasses.eyebrow}>Every player answers</span>}
              <h2 className={hostClasses.title}>{decisionTitle(shown)}</h2>
            </div>
            {more > 0 && (
              <UnstyledButton className={classes.more} onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}>
                {more === 1 ? "1 more after this" : `${more} more waiting`}
              </UnstyledButton>
            )}
          </div>
          {listOpen && (
            <div className={classes.list} role="menu" aria-label="Decisions waiting">
              {decisions.map((d) => (
                <UnstyledButton
                  key={d.id}
                  role="menuitem"
                  className={cx(classes.listItem, d.id === shown.id && classes.current)}
                  onClick={() => {
                    setJumpId(d.id);
                    setListOpen(false);
                  }}
                >
                  {decisionTitle(d)}
                </UnstyledButton>
              ))}
            </div>
          )}
        </header>
        <div className={hostClasses.body}>
          <Renderer
            decision={shown}
            state={state}
            answer={(choice) => answer(shown, choice)}
            pendingOptionId={pending[shown.id]?.optionId ?? null}
          />
        </div>
        {error && (
          <div className={hostClasses.error} role="alert">
            <IconAlertTriangle size={14} />
            <span>{error}</span>
            <span className={hostClasses.grow} />
            <UnstyledButton
              className={hostClasses.errorClose}
              onClick={() => engineStore.getState().dismissError(shown.id)}
            >
              Dismiss
            </UnstyledButton>
          </div>
        )}
      </section>
    </PopupLayer>
  );
}
