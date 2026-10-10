import { useState } from "react";
import { Loader, UnstyledButton } from "@mantine/core";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import cx from "clsx";
import { getToken } from "@/play/session";
import { baseId, type Choice } from "../../model/controls";
import { ChoiceButton } from "../../ui/ChoiceButtons";
import type { RendererProps } from "../types";
import { useRunner, useRunSequence, type Press } from "./runner";
import classes from "./strategy.module.css";

const POOLS = [
  { key: "tactic", label: "Tactic" },
  { key: "fleet", label: "Fleet" },
  { key: "strategy", label: "Strategy" },
] as const;
type Pool = (typeof POOLS)[number]["key"];
type Counts = Record<Pool, number>;

const DONE = /^deleteButtons$/;
const RESET = /^resetCCs$/;

/** The bot's "gain / redistribute command tokens" prompt (status phase, Warfare, abilities): gain and lose buttons. */
export function isTokenStep(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.some((id) => /^increase_\w+_cc$/.test(id)) && ids.some((id) => /^decrease_\w+_cc$/.test(id)) && ids.some((id) => DONE.test(id));
}

/** "Your current command tokens are 4/3/4" or "have gone from 4/3/4 -> 5/3/4": the counts when the prompt opened. */
function originalOf(text: string): Counts | undefined {
  const m = text.match(/(?:are|from)\s*\**(\d+)\/(\d+)\/(\d+)/);
  return m ? { tactic: Number(m[1]), fleet: Number(m[2]), strategy: Number(m[3]) } : undefined;
}

function useHandNotes(gameName: string) {
  const query = useQuery({
    queryKey: ["strategy", "handNotes", gameName],
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`/bot/api/game/${encodeURIComponent(gameName)}/hand`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`hand ${res.status}`);
      return ((await res.json()) as { promissoryNotes?: string[] }).promissoryNotes ?? [];
    },
  });
  return query.data;
}

const sum = (c: Counts) => c.tactic + c.fleet + c.strategy;

/**
 * Command tokens in one panel: the three pools side by side, "now → after" with −/+ each. In the status phase the
 * total must grow by exactly the gain the rules give (2, plus Versatile / Hyper Metabolism / Inheritance Systems /
 * Cybernetic Enhancements, minus Malevolency), never beyond the tokens left in reinforcements; otherwise tokens only
 * move between pools. One confirm presses the bot's lose / gain buttons (losses first), then its Done.
 */
export function TokensBody({ d, data }: RendererProps) {
  const run = useRunSequence();
  const runner = useRunner();
  const notes = useHandNotes(data.gameName);
  const me = data.me;
  const current: Counts = { tactic: me?.tacticalCC ?? 0, fleet: me?.fleetCC ?? 0, strategy: me?.strategicCC ?? 0 };
  const original = originalOf(d.text) ?? current;
  const status = /status/i.test(data.web?.gameState?.phase ?? "");
  const techs = me?.techs ?? [];
  const abilities = me?.abilities ?? [];
  const bonus: string[] = [];
  let gain = 0;
  if (status) {
    gain = 2;
    if (abilities.includes("versatile")) (gain++, bonus.push("Versatile"));
    if (techs.includes("hm")) (gain++, bonus.push("Hyper Metabolism"));
    if (techs.includes("tf-inheritancesystems")) (gain++, bonus.push("Inheritance Systems"));
    if (notes?.includes("ce") && me?.faction !== "sol") (gain++, bonus.push("Cybernetic Enhancements"));
    if (notes?.includes("malevolency")) (gain--, bonus.push("Malevolency −1"));
  }
  const reinf = (me as { ccReinf?: number } | undefined)?.ccReinf;
  /* Tokens already gained on this prompt came out of reinforcements; what is left there is the rest of the cap. */
  const ceiling = sum(current) + (reinf ?? Infinity);
  const required = Math.min(sum(original) + gain, ceiling);
  const [target, setTarget] = useState<Counts | null>(null);
  const after = target ?? current;
  const left = required - sum(after);
  const busy = !!runner.running;

  const step = (k: Pool, by: 1 | -1) => setTarget({ ...after, [k]: after[k] + by });
  const plusReason = left <= 0 ? (gain ? `All ${gain} placed — take one from another pool first` : "Take one from another pool first") : undefined;

  const confirm = () => {
    const presses: Press[] = [];
    const btn = (id: string) => d.choices.find((c) => baseId(c.customId) === id);
    for (const p of POOLS) {
      const c = btn(`decrease_${p.key}_cc`);
      for (let i = 0; c && i < current[p.key] - after[p.key]; i++)
        presses.push({ channelId: d.prompt.channelId, messageId: d.id, customId: c.customId!, label: `Taking a ${p.label.toLowerCase()} token back` });
    }
    for (const p of POOLS) {
      const c = btn(`increase_${p.key}_cc`);
      for (let i = 0; c && i < after[p.key] - current[p.key]; i++)
        presses.push({ channelId: d.prompt.channelId, messageId: d.id, customId: c.customId!, label: `Placing a ${p.label.toLowerCase()} token` });
    }
    const done = d.choices.find((c) => DONE.test(baseId(c.customId)));
    if (done?.customId) presses.push({ channelId: d.prompt.channelId, messageId: d.id, customId: done.customId, label: "Done" });
    void run(`tokens:${d.id}`, presses, (dismiss) => dismiss(d.id));
  };

  const reset = () => {
    setTarget(null);
    const c = d.choices.find((x) => RESET.test(baseId(x.customId)));
    if (c?.customId) void run(`tokens-reset:${d.id}`, [{ channelId: d.prompt.channelId, messageId: d.id, customId: c.customId, label: "Resetting" }]);
  };

  if (runner.running?.startsWith(`tokens:${d.id}`)) {
    return (
      <div className={classes.panel}>
        <div className={classes.progress}>
          <Loader size={14} /> {runner.label} ({runner.step}/{runner.total})
        </div>
      </div>
    );
  }

  return (
    <div className={classes.panel}>
      <span className={classes.sectionLabel}>
        {gain > 0 ? `Place ${required - sum(original)} new token${required - sum(original) === 1 ? "" : "s"}` : "Move tokens between your pools"}
        {left > 0 ? ` · ${left} left` : ""}
      </span>
      {bonus.length > 0 && <p className={classes.sub}>2 for the status phase{bonus.map((b) => `, ${b.includes("−") ? b : `+1 ${b}`}`).join("")}.</p>}
      {reinf !== undefined && sum(original) + gain > ceiling && (
        <p className={cx(classes.sub, classes.warn)}>Only {reinf} token{reinf === 1 ? "" : "s"} left in your reinforcements.</p>
      )}
      <div className={classes.pools}>
        {POOLS.map((p) => (
          <div key={p.key} className={classes.pool}>
            <span className={classes.numberLabel}>
              {p.label} <span className={classes.poolValue}>{`${current[p.key]} → ${after[p.key]}`}</span>
            </span>
            <span className={classes.stepper}>
              <UnstyledButton
                className={classes.stepBtn}
                onClick={() => step(p.key, -1)}
                disabled={busy || after[p.key] <= 0}
                aria-label={`One less ${p.label} token`}
                title={after[p.key] <= 0 ? "Already empty" : undefined}
              >
                <IconMinus size={12} />
              </UnstyledButton>
              <span className={classes.stepValue}>{after[p.key] - current[p.key] > 0 ? "+" : ""}{after[p.key] - current[p.key]}</span>
              <UnstyledButton
                className={classes.stepBtn}
                onClick={() => step(p.key, 1)}
                disabled={busy || left <= 0}
                aria-label={`One more ${p.label} token`}
                title={plusReason}
              >
                <IconPlus size={12} />
              </UnstyledButton>
            </span>
          </div>
        ))}
      </div>
      {left > 0 && <p className={classes.sub}>Place every token to continue.</p>}
      {left < 0 && <p className={cx(classes.sub, classes.warn)}>That is {-left} more than you may have — take some back.</p>}
      <ChoiceButton
        choice={{ key: "tokens-confirm", kind: "button", customId: "tokens-confirm", label: "Confirm tokens", style: 3, disabled: left !== 0, rank: "primary", component: { type: 2 } }}
        onPress={confirm}
        pending={false}
        busy={busy}
        emphasis
      />
      <UnstyledButton className={classes.textLink} onClick={reset} disabled={busy}>
        Reset
      </UnstyledButton>
      {runner.error && <span className={classes.error}>Did not go through: {runner.error}</span>}
    </div>
  );
}
