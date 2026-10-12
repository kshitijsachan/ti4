/**
 * Prophecy of Kings faction steps (Titans, Mahact, Cabal, Empyrean, Argent, Nomad) on the shared kinds leader.use /
 * faction.ability (bot FactionSteps{Titans,Mahact,Cabal,Empyrean,Argent,Nomad}.java). Keyed by value.step (the
 * handler prefix). Runs before the generic chooseFaction (policy/faction.ts): returns undefined when the decision is
 * not one of these steps, null when the step should wait (e.g. Edict while the combat is still on).
 */
import type { Decision, GameState, Option } from "../types.js";

type V = Record<string, unknown> & { step: string; action: string; optional: boolean };
type Opt = Option<V | null>;
type StepPolicy = (opts: Opt[], state: GameState | null, me: string, history: string[]) => Opt | null;

const UNIT_COST: Record<string, number> = {
  warsun: 12, ws: 12, flagship: 8, fs: 8, dreadnought: 4, dn: 4, carrier: 3, cv: 3, cruiser: 2, ca: 2,
  mech: 2, mf: 2, destroyer: 1, dd: 1, fighter: 0.5, ff: 0.5, infantry: 0.5, inf: 0.5, gf: 0.5,
};
const cost = (u: unknown) => UNIT_COST[String(u ?? "").toLowerCase()] ?? 0;
const typed = (opts: Opt[]) => opts.filter((o) => o.value);
const first = (opts: Opt[]) => typed(opts)[0] ?? null;
const dismiss = (opts: Opt[]) => opts.find((o) => !o.value && /^deleteButtons/.test(o.handler)) ?? null;
const mostExpensive = (opts: Opt[]) => [...typed(opts)].sort((a, b) => cost(b.value!.unit) - cost(a.value!.unit))[0] ?? null;
const self = (state: GameState | null, me: string) => state?.players.find((p) => p.userId === me) ?? null;

/** Edict reminder ("if you win this combat"): we won when no combat is on and we hold space where they have nothing. */
function wonAgainst(state: GameState | null, me: string, color: string) {
  if (!state || state.combat) return null;
  const mine = self(state, me)?.faction;
  return state.tiles.some((t) => {
    const space = t.holders.find((h) => h.name === "space");
    if (!space) return false;
    const ours = space.units.some((u) => u.owner === mine && u.count > 0);
    const theirs = space.units.some((u) => u.color === color && u.count > 0);
    return ours && !theirs;
  });
}

export const POK_STEPS: Record<string, StepPolicy> = {
  // Titans of Ul: sleepers are free value; awaken into mech + infantry when we can; free flagship.
  putSleeperOnPlanet: first,
  removeSleeperFromPlanet: first,
  replaceSleeperWith: (opts) => typed(opts).find((o) => o.value!.unit === "mech") ?? first(opts),
  replacePDSWithFS: first,
  terraformPlanet: first,
  titansConstructionMechDeployStep2: first,
  titansHeroPlanet: first,
  // Mahact: give up another player's token before our own; Edict only after a won combat; Starlancer always.
  loseMahactCC: (opts, state, me) => typed(opts).find((o) => o.value!.color !== self(state, me)?.color) ?? first(opts),
  mahactStealCC: (opts, state, me) => {
    const won = wonAgainst(state, me, String(first(opts)?.value?.color ?? ""));
    if (won === null) return null;
    return won ? first(opts) : dismiss(opts);
  },
  mahactMechHit: first,
  benedictionStep1: first,
  mahactBenedictionFrom: first,
  // Construction follow: bots follow normally with their own token (they never use Jae Mir Kan here).
  placeHolderOfConInSystem: (opts) => typed(opts).find((o) => o.value!.step === "reinforcements_cc_placement") ?? dismiss(opts),
  reinforcements_cc_placement: first,
  // Genetic Recombination aimed at us: vote as asked rather than lose a fleet token.
  geneticRecombination: (opts) => typed(opts).find((o) => o.value!.choice === "accept") ?? first(opts),
  // Vuil'raith Cabal: capture the most expensive unit; keep prisoners.
  cabalAgentCapture: mostExpensive,
  cabalVortextCapture: mostExpensive,
  cabalRelease: (opts) => dismiss(opts) ?? first(opts),
  cabalHeroTile: first,
  cabalHeroAll: first,
  // Empyrean Dynamo: repair our own units first.
  empyreanFlagshipAbilityStep1: first,
  empyreanFlagshipAbilityStep2: (opts, state, me) => typed(opts).find((o) => o.value!.target === self(state, me)?.faction) ?? first(opts),
  // Argent hero: move up to 3 units, then Done.
  argentHeroStep2: first,
  argentHeroStep3: first,
  argentHeroStep4: (opts, _s, _m, history) => (history.length >= 3 ? dismiss(opts) : null) ?? first(opts) ?? dismiss(opts),
  // Nomad: Mercer moves the first offered force; TCS readies only our own agents, never spends a token for others.
  mercerMove: first,
  exhaustTCS: (opts, state, me) => {
    const mine = self(state, me)?.faction ?? "~";
    return typed(opts).find((o) => String(o.value!.leader ?? "").startsWith(mine)) ?? dismiss(opts);
  },
  useTCS: (opts) => dismiss(opts) ?? first(opts),
};

/** Leaders worth exhausting whenever they are offered alone (free value for a bot). */
const USE_AGENTS = new Set(["cabalagent", "nomadagentartuno", "empyreanagent"]);

export function choosePokFaction(
  d: Decision,
  state: GameState | null,
  me: string,
  history: string[] = [],
): { option: Option<any>; why: string } | null | undefined {
  if (d.kind !== "leader.use" && d.kind !== "faction.ability") return undefined;
  if (d.scope !== "player" || d.target?.userId !== me) return undefined;
  const opts = (d.options as Opt[]).filter((o) => !o.disabled && !o.needsInput && (!o.owner || o.owner.userId === me));
  const lead = typed(opts)[0]?.value;
  if (!lead) return undefined;
  if (d.kind === "leader.use" && lead.step === "exhaustAgent" && USE_AGENTS.has(String(lead.leader))) {
    return { option: typed(opts)[0], why: `leader.use ${String(lead.leader)}: worth using` };
  }
  const policy = POK_STEPS[lead.step];
  if (!policy) return undefined;
  const pick = policy(opts, state, me, history);
  return pick ? { option: pick, why: `${d.kind} ${lead.step}: PoK policy` } : null;
}
