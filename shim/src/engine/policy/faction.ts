/**
 * Autopilot policy for the shared faction kinds (leader.use, faction.ability). Bots never start a leader, a
 * faction ability or a faction note on their own initiative; they take free gains, finish what is already under way
 * and always answer a prompt addressed to them (decline when they may, else the first legal choice).
 *
 * Returns undefined for other kinds, null when the decision is not this seat's to answer.
 */
import type { Decision, GameState, Option } from "../types.js";
import type { FactionDecision, FactionStepFields } from "../kinds/faction.js";

export type FactionChoice = { option: Option<any>; why: string };

const live = (o: Option<any>) => !o.disabled && !o.needsInput;
const isUndo = (o: Option<any>) => /^ultimateUndo/.test(o.handler);

/** Offers worth accepting whenever they appear (free or cheap gains). */
const TAKE: Record<string, (v: FactionStepFields, tg: number) => boolean> = {
  gain1tgFromLetnevCommander: () => true,
  gain1tgFromMuaatCommander: () => true,
  utilizeSolCommander: () => true,
  saarMechRes: (_v, tg) => tg >= 1,
  // Magen Defense Grid ΩΩ / Black Trench Bulwark: "When any player activates a system that contains 1 or more of your
  // structures, place 1 infantry ... with each of those structures" — mandatory and free; answered at once so the
  // active player's tactical action never waits on it (soak pbd1859: answered 60 s late, the planner stalled).
  useMagenDefense: () => true,
};

export function chooseFaction(d: Decision, state: GameState | null, me: string): FactionChoice | null | undefined {
  if (d.kind !== "leader.use" && d.kind !== "faction.ability") return undefined;
  const f = d as FactionDecision;
  if (f.scope !== "player" || f.target?.userId !== me) return null;
  const self = state?.players.find((p) => p.userId === me) ?? null;
  const opts = (f.options as Option<any>[]).filter((o) => live(o) && !isUndo(o));
  const typed = opts.filter((o) => o.value) as Option<FactionStepFields & Record<string, any>>[];
  const decline = opts.find((o) => !o.value && /^deleteButtons/.test(o.handler));
  const skip = typed.find((o) => o.value!.action === "skip");

  const take = typed.find((o) => TAKE[o.value!.step]?.(o.value!, self?.tg ?? 0));
  if (take) return { option: take, why: `${f.kind} ${take.value!.step}: free gain` };

  // Mitosis (mandatory, status phase): a mech when offered, else an infantry; then the first planet.
  const mitosis = typed.filter((o) => o.value!.step === "mitosis");
  if (mitosis.length) {
    const pick = mitosis.find((o) => o.value!.unit === "mf") ?? mitosis[0];
    return { option: pick, why: `Mitosis: ${pick.value!.unit === "mf" ? "replace an infantry with a mech" : "place an infantry"}` };
  }
  const placement = typed.filter((o) => o.value!.step === "mitoMechPlacement");
  if (placement.length) {
    const pick = placement.find((o) => o.value!.planet) ?? placement[0];
    return { option: pick, why: "Mitosis: mech placement" };
  }

  // A choice inside an effect already under way: prefer ourselves where a player is picked (own agent / gains),
  // else the first target.
  const targets = typed.filter((o) => o.value!.action === "target");
  if (targets.length && !targets.every((o) => o.value!.optional)) {
    const pick = targets.find((o) => o.value!.target && o.value!.target === self?.faction) ?? targets[0];
    return { option: pick, why: `${f.kind} ${pick.value!.step}: first legal choice` };
  }

  // Optional offers (abilities, notes, leaders): decline.
  if (decline) return { option: decline, why: `${f.kind}: decline the optional ${typed[0]?.value?.step ?? "effect"}` };
  if (skip) return { option: skip, why: `${f.kind}: finish without using it` };
  if (targets.length) {
    const pick = targets.find((o) => o.value!.target && o.value!.target === self?.faction) ?? targets[0];
    return { option: pick, why: `${f.kind} ${pick.value!.step}: first choice (no decline offered)` };
  }
  // Nothing to decline with: the first option (never leave a prompt addressed to a bot unanswered).
  const first = typed[0] ?? opts[0];
  return first ? { option: first, why: `${f.kind}: only way forward` } : null;
}
