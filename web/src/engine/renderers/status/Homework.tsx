import { useEffect } from "react";
import { ActionIcon, Button, Group } from "@mantine/core";
import type { Option } from "../../../../../shim/src/engine/types";
import type {
  CommandTokenPools,
  CommandTokensAdjust,
  CommandTokensGainCap,
  StatusAdvance,
  StatusHomework,
  StatusImperial,
} from "../../../../../shim/src/engine/kinds/status";
import { OptionButtons, Waiting, me, myStatus, type StatusRendererProps } from "./shared";
import classes from "./Status.module.css";
import { DecisionFooter } from "../../ui/Popup";
import { useDecisionState } from "../../draftState";
import { useEngine } from "../../store";

/** required.gainCap of a command_tokens.adjust panel (mirrors shim kinds/status.ts commandTokensGainCap). */
function commandTokensGainCap(d: { progress?: { required?: unknown } | null }): CommandTokensGainCap | null {
  const c = (d.progress?.required as { gainCap?: CommandTokensGainCap } | undefined)?.gainCap;
  return c && typeof c.limit === "number" ? c : null;
}

function commandTokensReinforcements(d: { progress?: { required?: unknown } | null }): number | null {
  const r = (d.progress?.required as { reinforcements?: number } | undefined)?.reinforcements;
  return typeof r === "number" ? r : null;
}

const POOLS: (keyof CommandTokenPools)[] = ["tactic", "fleet", "strategy"];
const total = (p: CommandTokenPools) => p.tactic + p.fleet + p.strategy;

/** The homework editor's starting point: the round's gain already placed in tactic, so the one click is e.g. 3/3/0. */
const withGainInTactic = (base: CommandTokenPools, maxTotal: number): CommandTokenPools => ({
  ...base,
  tactic: base.tactic + Math.max(0, maxTotal - total(base)),
});

type EditorProps = {
  base: CommandTokenPools;
  start: CommandTokenPools;
  maxTotal: number;
  gain: number;
  noLoss: boolean;
  onConfirm: (pools: CommandTokenPools) => void;
  /** Status homework: the main button also says ready (one click); `onConfirm` then only sets the tokens. */
  onConfirmAndReady?: (pools: CommandTokenPools) => void;
  readyLabel?: string;
  /** Status homework: every gained token must be placed (Confirm is greyed out with the reason until then; skipping
   * the gain on purpose is the separate "Ready without taking my new tokens" button). */
  requireAll?: boolean;
  /** What the gain is (default "this round": the status phase's gain). */
  gainWhat?: string;
};

/** Set the final tactic / fleet / strategy pools in one go, within base + gain (and no losses for Deliberate Action). */
export function TokenEditor({ base, start, maxTotal, gain, noLoss, onConfirm, onConfirmAndReady, readyLabel, requireAll, draftKey, gainWhat }: EditorProps & { draftKey?: string }) {
  const [pools, setPools] = useDecisionState<CommandTokenPools>(draftKey ?? "tokens", "pools", start);
  const left = maxTotal - total(pools);
  const step = (k: keyof CommandTokenPools, d: number) => setPools((p) => ({ ...p, [k]: p[k] + d }));
  // pbd387 (playtest 6): "Confirm 2/3/0" with 1 left to place silently forfeited the token.
  const blocked = left < 0 || (!!requireAll && left > 0);
  const why = left < 0 ? `${-left} too many` : blocked ? `${left} left to place` : undefined;
  return (
    <div className={classes.section}>
      <p className={classes.hint}>
        {gain > 0 || !gainWhat ? `Gain ${gain} ${gainWhat ?? "this round"}` : "Move tokens between pools"} · {left > 0 ? `${left} left to place` : left === 0 ? "all placed" : `${-left} too many`}
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
          {onConfirmAndReady ? (
            <>
              <Button size="xs" disabled={blocked} title={why} onClick={() => onConfirmAndReady(pools)}>
                Confirm {pools.tactic}/{pools.fleet}/{pools.strategy} · {readyLabel ?? "ready"}
              </Button>
              <Button size="xs" variant="default" disabled={blocked} onClick={() => onConfirm(pools)} title={why ?? "Set the tokens without saying ready yet"}>
                Set only
              </Button>
            </>
          ) : (
            <Button size="xs" disabled={blocked} title={why} onClick={() => onConfirm(pools)}>
              Confirm {pools.tactic}/{pools.fleet}/{pools.strategy}
            </Button>
          )}
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
  /* "Confirm 3/3/0 · ready": the tokens first; once the engine has them, Ready (one decision answers one at a time). */
  const [readyAfter, setReadyAfter] = useDecisionState<CommandTokenPools | null>(decision.id, "readyAfter", null);
  const inFlight = useEngine((s) => !!s.view.pending[decision.id]);
  const failed = useEngine((s) => !!s.view.errors[decision.id]);
  const canReady = !!ready && !ready.disabled && !isReady;
  useEffect(() => {
    if (!readyAfter || inFlight) return;
    if (failed || !canReady || !ready) return setReadyAfter(null);
    if (!tokensSet || !POOLS.every((k) => tokensSet[k] === readyAfter[k])) return;
    setReadyAfter(null);
    answer(ready.id);
  }, [readyAfter, inFlight, failed, canReady, tokensSet, ready, answer, setReadyAfter]);

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
            start={tokensSet ?? withGainInTactic(st.tokensBase, st.tokenMaxTotal)}
            maxTotal={st.tokenMaxTotal}
            requireAll
            gain={st.tokenGain}
            noLoss={st.noTokenLoss}
            onConfirm={(pools) => answer({ optionId: tokens.id, payload: { ...pools } })}
            onConfirmAndReady={
              canReady
                ? (pools) => {
                    setReadyAfter({ ...pools });
                    answer({ optionId: tokens.id, payload: { ...pools } });
                  }
                : undefined
            }
            readyLabel={`ready for the ${next}`}
          />
        )}
        {/* No token editor (the engine typed the option without a payload, or the status facts are missing): the
            original button, which opens the bot's own token panel. */}
        {!isReady && tokens?.value?.action === "command_tokens" && !(st && tokens.value.payload) && (
          <Group>
            <Button size="xs" disabled={tokens.disabled} onClick={() => answer(tokens.id)}>
              {tokens.label}
            </Button>
          </Group>
        )}
      </div>
      <div className={classes.section}>
        <h4 className={classes.heading}>Ready</h4>
        {isReady ? (
          <p className={classes.done}>You are ready for the {next}.</p>
        ) : (
          <>
            {!tokensSet && (
              <p className={classes.hint}>
                {canReady
                  ? "Confirming your command tokens above also says ready (it ends your status phase)."
                  : "Set your command tokens above, then press Ready (it ends your status phase)."}
              </p>
            )}
            {readyAfter && <p className={classes.hint}>Setting your tokens, then ready…</p>}
            {ready && (
              <Group>
                <Button size="xs" variant={tokensSet ? "filled" : "default"} disabled={ready.disabled} onClick={() => answer(ready.id)}>
                  {!tokensSet && (st?.tokenGain ?? 0) > 0 ? `Ready without taking my ${st?.tokenGain} new tokens` : `Ready for the ${next}`}
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
  // The effect that opened the panel grants a fixed number (Acamar 1, Leadership 3 + influence / 3, …): the engine
  // refuses more, so the "gain" buttons are greyed out with the reason once it is reached (or reinforcements run out).
  const cap = commandTokensGainCap(decision);
  const reinforcements = commandTokensReinforcements(decision);
  /* Outside the status phase, a panel with a known grant (Warfare's redistribution: 0, Leadership: 3 + …) is the same
     one-go editor: the engine reaches the pools with the panel's own steps, then presses its Done (pt7). */
  const editorOption = decision.options.find((o) => o.value?.action === "adjust" && (o.value as { editor?: boolean }).editor);
  const now: CommandTokenPools | null =
    acc && typeof acc.tactic === "number" && typeof acc.fleet === "number" && typeof acc.strategy === "number"
      ? { tactic: acc.tactic, fleet: acc.fleet, strategy: acc.strategy }
      : null;
  if (editorOption && cap && now) {
    const left = Math.max(0, Math.min(cap.limit - cap.gained, reinforcements ?? Infinity));
    return (
      <TokenEditor
        draftKey={decision.id}
        base={now}
        start={now}
        maxTotal={total(now) + left}
        gain={left}
        gainWhat={cap.label ? `with ${cap.label}` : "now"}
        noLoss={false}
        onConfirm={(pools) => answer({ optionId: editorOption.id, payload: { ...pools } })}
      />
    );
  }
  const capReached = !!cap && cap.gained >= cap.limit;
  const noneLeft = reinforcements !== null && reinforcements <= 0;
  const blockReason = capReached
    ? `${cap.label ?? "This effect"} grants ${cap.limit}`
    : noneLeft
      ? "No command tokens left in your reinforcements"
      : null;
  const options = (decision.options as Option<unknown>[]).map((o) => {
    const v = o.value as { action?: string; delta?: number } | null | undefined;
    return blockReason && v?.action === "adjust" && (v.delta ?? 0) > 0 ? { ...o, disabled: true } : o;
  });
  return (
    <div className={classes.stack}>
      {cap && (
        <p className={classes.hint}>
          {cap.label ?? "Gain"}: gain {Math.max(0, cap.gained)} of {cap.limit}
        </p>
      )}
      {acc && (
        <p className={classes.done}>
          Now {acc.tactic}/{acc.fleet}/{acc.strategy} (tactic/fleet/strategy).
        </p>
      )}
      {blockReason && <p className={classes.hint}>{blockReason}: no more tokens can be gained here.</p>}
      <OptionButtons options={options} answer={answer} />
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

