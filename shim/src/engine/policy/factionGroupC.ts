/**
 * Faction group C (Jol-Nar, Winnu, Xxcha, Yin, Yssaril, Keleres) overrides on top of the shared faction policy
 * (policy/faction.ts, kinds leader.use / faction.ability). Mirrors bot kinds/FactionSteps{Jolnar,Winnu,Xxcha,Yin,
 * Yssaril,Keleres}.java. Only the steps where the generic default (decline optional offers, else the first choice) is
 * a poor play are decided here; everything else returns undefined and falls through to chooseFaction.
 */
import type { Decision, GameState, Option } from "../types.js";
import type { FactionDecision, FactionStepFields } from "../kinds/faction.js";

export type GroupCChoice = { option: Option<any>; why: string };
type V = FactionStepFields & Record<string, any>;

const live = (o: Option<any>) => !o.disabled && !o.needsInput;

/** Action cards a bot would rather keep (cancel effects first). */
const KEEP_AC = /^(sabo|sabotage|tf-shatter)/;

export function chooseFactionGroupC(d: Decision, state: GameState | null, me: string): GroupCChoice | undefined {
  if (d.kind !== "leader.use" && d.kind !== "faction.ability") return undefined;
  const f = d as FactionDecision;
  if (f.scope !== "player" || f.target?.userId !== me) return undefined;
  const self = state?.players.find((p) => p.userId === me) ?? null;
  const typed = (f.options as Option<any>[]).filter((o) => live(o) && o.value) as Option<V>[];
  if (!typed.length) return undefined;
  const id = (o: Option<V>) => (o.value!.id ?? o.value!.leader) as string;
  const of = (comp: string, step?: string) =>
    typed.filter((o) => id(o) === comp && (step === undefined || o.value!.step === step));

  // Peace Accords: a free planet next to ours. Claim the first one offered.
  const peace = of("peace_accords");
  if (peace.length) return { option: peace[0], why: "Peace Accords: claim an adjacent planet" };

  // Reclamation (Mecatol Rex): free structures. A space dock first, then the PDS.
  const recl = of("reclamation");
  if (recl.length) {
    const pick = recl.find((o) => o.value!.unit === "sd" || o.value!.unit === "spacedock") ?? recl[0];
    return { option: pick, why: "Reclamation: place the free structure" };
  }

  // Scheming + Minister of Policy: a free action card.
  const minister = of("scheming", "yssarilMinisterOfPolicy");
  if (minister.length) return { option: minister[0], why: "Minister of Policy: draw the action card" };

  // Indoctrination (start of ground combat): replace an enemy infantry; a mech when offered.
  const indoc = of("indoctrination", "indoctrinate");
  if (indoc.length) {
    const pick = indoc.find((o) => o.value!.unit === "mf" || o.value!.unit === "mech") ?? indoc[0];
    return { option: pick, why: "Indoctrination: replace an opposing infantry" };
  }

  // Nullification Field: end the attacker's turn, but keep a strategy token for following cards.
  const nf = of("nf");
  if (nf.length) {
    if ((self?.commandTokens?.strategy ?? 0) >= 2) return { option: nf[0], why: "Nullification Field: end the attacker's turn" };
    return undefined; // decline (generic)
  }

  // Devotion / Impulse Core hit: the biggest opposing ship, an already-damaged one first (no sustain).
  const hits = of("hit_opponent");
  if (hits.length) {
    const rank = ["ws", "fs", "dn", "cv", "ca", "dd", "mf", "gf", "ff"];
    const score = (o: Option<V>) => (rank.indexOf(o.value!.unit ?? "") + 1 || 99) - (o.value!.damaged ? 0.5 : 0);
    const pick = [...hits].sort((a, b) => score(a) - score(b))[0];
    return { option: pick, why: "assign the ability's hit to the biggest opposing ship" };
  }

  // Yssaril hero: we must offer one action card; give the least useful one.
  const offer = of("yssarilhero", "yssarilHeroInitialOffering");
  if (offer.length) {
    const pick = offer.find((o) => o.value!.actionCard && !KEEP_AC.test(o.value!.actionCard)) ?? offer[offer.length - 1];
    return { option: pick, why: "Yssaril hero: offer the least useful action card" };
  }

  // Taking a card from another hand (Spy Net, Mageon Implants, Yssaril hero): a Sabotage first.
  const take = of("take_ac");
  if (take.length) {
    const pick = take.find((o) => o.value!.actionCard && KEEP_AC.test(o.value!.actionCard)) ?? take[0];
    return { option: pick, why: "take an action card" };
  }

  // Yssaril hero (as Yssaril): take the offered card rather than rejecting.
  const reject = of("yssarilhero", "yssarilHeroRejection");
  if (reject.length) {
    const takeIt = (f.options as Option<any>[]).find((o) => live(o) && o.value?.step === "takeAC");
    if (takeIt) return { option: takeIt, why: "Yssaril hero: accept the offered card" };
  }
  return undefined;
}
