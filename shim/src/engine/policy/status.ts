/**
 * Autopilot policy for the status phase kinds (G7). Pure: (decision, state, me, my other open decisions) → choice.
 * Returns undefined for kinds that are not ours (chooseTyped continues), null for "ours, but do nothing now".
 */
import type { CommandTokenPools, StatusDecision } from "../kinds/status.js";
import type { Decision, GameState, Option } from "../types.js";

export type StatusChoice = { option: Option<any>; why: string; payload?: Record<string, unknown> };

const KINDS = new Set<string>([
  "status.score",
  "status.score_secret",
  "status.reveal_objective",
  "status.homework",
  "status.advance",
  "status.imperial",
  "command_tokens.adjust",
  "action_card.discard",
]);

/** Action cards worth keeping when we must discard (most valuable first); anything else goes first. */
const KEEP = ["sabo", "sabotage", "dh", "direct_hit", "sh", "shields_holding", "mb", "morale_boost", "maneuvering_jets", "rise_of_a_messiah", "war_effort", "infiltrate", "ghost_ship", "plague", "upgrade"];
/** Lower = keep longer. Card ids carry copy numbers and set suffixes: "sabo2", "direct_hit3_acd2", "morale_boost_ds". */
const keepRank = (id: string | null) => {
  if (!id) return 999;
  const base = id.replace(/_(acd2|ds|pbd\d+)$/, "").replace(/\d+$/, "");
  const i = KEEP.indexOf(base);
  return i < 0 ? 999 : i;
};

/** Fill the pools from base up to the allowed total: tactic, strategy, tactic, fleet, … */
export function plannedTokens(base: CommandTokenPools, maxTotal: number): CommandTokenPools {
  const out = { ...base };
  const order: (keyof CommandTokenPools)[] = ["tactic", "strategy", "tactic", "fleet"];
  let left = maxTotal - (base.tactic + base.fleet + base.strategy);
  for (let i = 0; left > 0; i++, left--) out[order[i % order.length]]++;
  return out;
}

export function chooseStatus(d: Decision, state: GameState | null, me: string, mine: Decision[] = []): StatusChoice | null | undefined {
  if (!KINDS.has(d.kind)) return undefined;
  const sd = d as StatusDecision;
  const live = (sd.options as Option<any>[]).filter((o) => !o.disabled && !o.needsInput && o.value);
  const find = (pred: (v: any) => boolean) => live.find((o) => pred(o.value));
  const st = state?.status?.players[me];
  switch (sd.kind) {
    case "status.score": {
      const forMe = sd.scope === "player" ? sd.target?.userId === me : !!sd.window && sd.window.eligible.includes(me) && !sd.window.responded.includes(me);
      if (!forMe) return null;
      const publics = live.filter((o) => o.value.action === "score_public" && o.value.eligible.includes(me));
      publics.sort((a, b) => b.value.points - a.value.points);
      // Imperial's own list: just the best public we meet.
      if (sd.scope === "player") return publics[0] ? { option: publics[0], why: "Imperial: score a public objective we meet" } : null;
      if (!st || st.publicScored === null) {
        if (publics[0]) return { option: publics[0], why: `status: score ${publics[0].value.objective}` };
        const no = find((v) => v.action === "no_public");
        return no ? { option: no, why: "status: no public objective met" } : null;
      }
      if (st.secretScored === null) {
        const lists = mine.filter((x) => x.kind === "status.score_secret" && x.createdAt >= sd.createdAt);
        const anyMet = lists.some((x) => x.options.some((o: Option<any>) => !o.disabled && o.value?.met === true && o.value?.phase === "status"));
        if (lists.length && anyMet) return null; // the list answers it
        const handSecrets = Object.keys(state?.players.find((p) => p.userId === me)?.hand?.secretObjectives ?? {}).length;
        const ask = find((v) => v.action === "score_secret");
        if (!lists.length && handSecrets > 0 && ask) return { option: ask, why: "status: look for a secret objective we meet" };
        const no = find((v) => v.action === "no_secret");
        return no ? { option: no, why: "status: no secret objective met" } : null;
      }
      return null;
    }
    case "status.score_secret": {
      if (sd.target?.userId !== me) return null;
      const inStatus = !!state?.status;
      const opts = live.filter((o) => o.value.met === true && (!inStatus || o.value.phase === "status"));
      opts.sort((a, b) => b.value.points - a.value.points);
      return opts[0] ? { option: opts[0], why: `score secret objective ${opts[0].value.secretObjective}` } : null;
    }
    case "status.reveal_objective": {
      if (sd.target?.userId !== me) return null;
      const reveal = live.filter((o) => o.value.action === "reveal");
      const pick = reveal[0] ?? find((v) => v.action === "continue") ?? find((v) => v.action === "end_game");
      return pick ? { option: pick, why: "status: speaker reveals the next public objective" } : null;
    }
    case "status.homework": {
      if (!sd.window || !sd.window.eligible.includes(me) || sd.window.responded.includes(me) || !st) return null;
      const tokens = find((v) => v.action === "command_tokens" && v.payload);
      if (!st.tokensConfirmed && tokens) {
        const payload = plannedTokens(st.tokensBase, st.tokenMaxTotal);
        return { option: tokens, payload: { ...payload }, why: `status: command tokens ${payload.tactic}/${payload.fleet}/${payload.strategy}` };
      }
      const ready = find((v) => v.action === "ready");
      return ready ? { option: ready, why: `status: ready for ${ready.value.next} phase` } : null;
    }
    case "command_tokens.adjust": {
      if (sd.target?.userId !== me || !st || st.tokensConfirmed) return null;
      const opt = find((v) => v.action === "adjust" && v.payload);
      if (!opt) return null;
      const payload = plannedTokens(st.tokensBase, st.tokenMaxTotal);
      return { option: opt, payload: { ...payload }, why: "status: set command tokens in one go" };
    }
    case "action_card.discard": {
      if (sd.target?.userId !== me) return null;
      const opts = [...live].sort((a, b) => keepRank(b.value.actionCard) - keepRank(a.value.actionCard));
      return opts[0] ? { option: opts[0], why: `discard ${opts[0].value.actionCard ?? "an action card"}` } : null;
    }
    // status.advance is pressed by the engine itself; Imperial's table options stay with the strategy-card policy.
    default:
      return null;
  }
}
