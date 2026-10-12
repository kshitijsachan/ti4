import { ActionIcon, Button, Group } from "@mantine/core";
import type { Option } from "../../../../../shim/src/engine/types";
import type {
  CommandTokenPools,
  CommandTokensAdjust,
  StatusAdvance,
  StatusHomework,
  StatusImperial,
} from "../../../../../shim/src/engine/kinds/status";
import { OptionButtons, Waiting, me, myStatus, type StatusRendererProps } from "./shared";
import classes from "./Status.module.css";
import { DecisionFooter } from "../../ui/Popup";
import { useDecisionState } from "../../draftState";

const POOLS: (keyof CommandTokenPools)[] = ["tactic", "fleet", "strategy"];
const total = (p: CommandTokenPools) => p.tactic + p.fleet + p.strategy;

type EditorProps = {
  base: CommandTokenPools;
  start: CommandTokenPools;
  maxTotal: number;
  gain: number;
  noLoss: boolean;
  onConfirm: (pools: CommandTokenPools) => void;
};

/** Set the final tactic / fleet / strategy pools in one go, within base + gain (and no losses for Deliberate Action). */
export function TokenEditor({ base, start, maxTotal, gain, noLoss, onConfirm, draftKey }: EditorProps & { draftKey?: string }) {
  const [pools, setPools] = useDecisionState<CommandTokenPools>(draftKey ?? "tokens", "pools", start);
  const left = maxTotal - total(pools);
  const step = (k: keyof CommandTokenPools, d: number) => setPools((p) => ({ ...p, [k]: p[k] + d }));
  return (
    <div className={classes.section}>
      <p className={classes.hint}>
        Gain {gain} this round · {left > 0 ? `${left} left to place` : left === 0 ? "all placed" : `${-left} too many`}
      </p>
      <div className={classes.pools}>
        {POOLS.map((k) => (
          <div key={k} className={classes.pool}>
            <span className={classes.poolLabel}>{k}</span>
            <span className={classes.poolValue}>{pools[k]}</span>
            <span className={classes.delta}>{pools[k] - base[k] ? `${pools[k] - base[k] > 0 ? "+" : ""}${pools[k] - base[k]}` : " "}</span>
            <Group gap={4}>
              <ActionIcon size="sm" variant="default" aria-label={`One less ${k} token`} disabled={pools[k] <= (noLoss ? base[k] : 0)} onClick={() => step(k, -1)}>
                −
              </ActionIcon>
              <ActionIcon size="sm" variant="default" aria-label={`One more ${k} token`} disabled={left <= 0} onClick={() => step(k, 1)}>
                +
              </ActionIcon>
            </Group>
          </div>
        ))}
      </div>
      <DecisionFooter>
        <Group gap={6}>
          <Button size="xs" disabled={left < 0} onClick={() => onConfirm(pools)}>
            Confirm {pools.tactic}/{pools.fleet}/{pools.strategy}
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setPools(base)}>
            Reset
          </Button>
        </Group>
      </DecisionFooter>
    </div>
  );
}

const NEXT: Record<string, string> = { strategy: "strategy phase", agenda: "agenda phase", edict: "edict phase" };

/**
 * Status homework: set this round's command tokens, then say ready. Both steps are always visible; Ready is never
 * hidden behind the table's "start next phase" step (the engine presses that itself).
 */
export function StatusHomeworkRenderer({ decision, state, answer }: StatusRendererProps<StatusHomework>) {
  const self = me(state);
  const st = myStatus(state);
  if (!self) return null;
  const tokens = decision.options.find((o) => o.value?.action === "command_tokens");
  const ready = decision.options.find((o) => o.value?.action === "ready");
  const others = decision.options.filter((o) => !o.value);
  const isReady = !!decision.window?.responded.includes(self.userId);
  const next = ready?.value?.action === "ready" ? (NEXT[ready.value.next] ?? "the next phase") : "the next phase";
  const tokensSet = st?.tokensConfirmed;

  return (
    <div className={classes.stack}>
      <div className={classes.section}>
        <h4 className={classes.heading}>Command tokens</h4>
        {tokensSet && <p className={classes.done}>Set to {tokensSet.tactic}/{tokensSet.fleet}/{tokensSet.strategy} (tactic/fleet/strategy).</p>}
        {!isReady && st && tokens?.value?.action === "command_tokens" && tokens.value.payload && (
          <TokenEditor
            key={tokensSet ? "set" : "unset"}
            draftKey={`${decision.id}:${tokensSet ? "set" : "unset"}`}
            base={st.tokensBase}
            start={tokensSet ?? st.tokensBase}
            maxTotal={st.tokenMaxTotal}
            gain={st.tokenGain}
            noLoss={st.noTokenLoss}
            onConfirm={(pools) => answer({ optionId: tokens.id, payload: { ...pools } })}
          />
        )}
      </div>
      <div className={classes.section}>
        <h4 className={classes.heading}>Ready</h4>
        {isReady ? (
          <p className={classes.done}>You are ready for the {next}.</p>
        ) : (
          <>
            {!tokensSet && <p className={classes.hint}>Set your command tokens above, then press Ready (it ends your status phase).</p>}
            {ready && (
              <Group>
                <Button size="xs" variant={tokensSet ? "filled" : "default"} disabled={ready.disabled} onClick={() => answer(ready.id)}>
                  Ready for the {next}
                </Button>
              </Group>
            )}
          </>
        )}
      </div>
      <OptionButtons options={others} answer={answer} />
      <Waiting decision={decision} state={state} />
    </div>
  );
}

/** The step-by-step token prompt: in the status phase the same one-go editor; otherwise its own buttons. */
export function CommandTokensAdjustRenderer({ decision, state, answer }: StatusRendererProps<CommandTokensAdjust>) {
  const st = myStatus(state);
  const payloadOption = decision.options.find((o) => o.value?.action === "adjust" && o.value.payload);
  if (payloadOption && st) {
    return (
      <TokenEditor
        draftKey={decision.id}
        base={st.tokensBase}
        start={st.tokensConfirmed ?? st.tokensBase}
        maxTotal={st.tokenMaxTotal}
        gain={st.tokenGain}
        noLoss={st.noTokenLoss}
        onConfirm={(pools) => answer({ optionId: payloadOption.id, payload: { ...pools } })}
      />
    );
  }
  const acc = decision.progress?.accumulated as Partial<CommandTokenPools> | undefined;
  return (
    <div className={classes.stack}>
      {acc && (
        <p className={classes.done}>
          Now {acc.tactic}/{acc.fleet}/{acc.strategy} (tactic/fleet/strategy).
        </p>
      )}
      <OptionButtons options={decision.options as Option<unknown>[]} answer={answer} />
    </div>
  );
}

/** "Start strategy phase": the engine presses it once nobody is still setting tokens; the button is a fallback. */
export function StatusAdvanceRenderer({ decision, answer }: StatusRendererProps<StatusAdvance>) {
  const start = decision.options.find((o) => o.value);
  return (
    <div className={classes.stack}>
      <p className={classes.hint}>Everyone is ready. The strategy phase starts in a moment.</p>
      {start && (
        <Group>
          <Button size="xs" variant="default" onClick={() => answer(start.id)}>
            Start it now
          </Button>
        </Group>
      )}
    </div>
  );
}

/** Imperial primary options (when no strategy-card renderer owns the prompt). */
export function StatusImperialRenderer({ decision, state, answer }: StatusRendererProps<StatusImperial>) {
  const self = me(state);
  return (
    <Group gap={6}>
      {decision.options.map((o) => {
        const v = o.value;
        if (!v) return null;
        if (v.action === "score_imperial") {
          const may = !!self && v.controlsMecatol.includes(self.userId);
          return (
            <Button key={o.id} size="xs" disabled={!may || o.disabled} onClick={() => answer(o.id)}>
              {may ? "Score 1 VP (Mecatol Rex)" : "Mecatol Rex point: you do not control Mecatol Rex"}
            </Button>
          );
        }
        return (
          <Button key={o.id} size="xs" variant="light" disabled={o.disabled} onClick={() => answer(o.id)}>
            Score a public objective…
          </Button>
        );
      })}
    </Group>
  );
}

