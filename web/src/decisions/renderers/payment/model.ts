import type { PlayerData } from "@/entities/data/types";
import { getPlanetData } from "@/entities/lookup/planets";
import { baseId, cleanLabel, type Choice } from "../../model/controls";

export type PayKind = "resources" | "influence";

/** A planet I could exhaust for this payment (or one already exhausted, shown disabled). */
export type PayPlanet = {
  id: string;
  name: string;
  res: number;
  inf: number;
  choice?: Choice;
  exhausted?: boolean;
};

/** A discount the bot offers as a button (Sarween Tools, AI Development Algorithm…): pressed before paying. */
export type Discount = { key: string; label: string; amount: number; choice: Choice };

export const SPEND_ID = /^(spend_|reduceTG_|reduceComm_|resetSpend_)/;
const DONE_ID = /^deleteButtons(_|$)/;

/** A bot payment prompt: exhaust-planet buttons and/or trade-good buttons, with a Done. */
export function isPaymentPrompt(choices: Choice[]) {
  const ids = choices.map((c) => baseId(c.customId));
  return ids.some((id) => /^(spend_|reduceTG_)/.test(id)) && ids.some((id) => DONE_ID.test(id));
}

/** What the payment is counted in, from the `_inf` / `_res…` suffix the bot puts on its spend buttons. */
export function payKind(choices: Choice[], text: string): PayKind {
  const ids = choices.map((c) => baseId(c.customId)).filter((id) => SPEND_ID.test(id));
  if (ids.some((id) => /_inf\w*$/.test(id))) return "influence";
  if (ids.some((id) => /_res\w*$/.test(id))) return "resources";
  return /influence/i.test(text) && !/resource/i.test(text) ? "influence" : "resources";
}

/** "Jeol Ir (2/3)" → name and values (labels may carry emoji names before the numbers). */
function planetFromLabel(c: Choice) {
  const m = cleanLabel(c.label).match(/^(.*?)\s*\((\d+)\/(\d+)\)\s*$/);
  return m ? { name: m[1].trim(), res: Number(m[2]), inf: Number(m[3]) } : { name: c.label, res: 0, inf: 0 };
}

/** Planets offered by the prompt, then my exhausted planets (greyed out) so the whole economy is visible. */
export function payPlanets(choices: Choice[], me?: PlayerData): PayPlanet[] {
  const offered = choices
    .filter((c) => /^spend_/.test(baseId(c.customId)))
    .map((c) => {
      const id = baseId(c.customId).split("_")[1];
      return { id, ...planetFromLabel(c), choice: c };
    });
  const seen = new Set(offered.map((p) => p.id));
  const exhausted = (me?.exhaustedPlanets ?? [])
    .filter((id) => !seen.has(id) && me?.planets.includes(id))
    .map((id) => {
      const data = getPlanetData(id);
      return { id, name: data?.name ?? id, res: data?.resources ?? 0, inf: data?.influence ?? 0, exhausted: true };
    });
  return [...offered, ...exhausted];
}

export function valueOf(p: PayPlanet, kind: PayKind) {
  return kind === "resources" ? p.res : p.inf;
}

/** Trade goods the prompt lets me spend (its biggest button is 3, but presses repeat). */
export function tgOffer(choices: Choice[], me?: PlayerData) {
  const has = choices.some((c) => /^reduceTG_/.test(baseId(c.customId)));
  return has ? (me?.tg ?? 0) : 0;
}

export function commOffer(choices: Choice[], me?: PlayerData) {
  const has = choices.some((c) => /^reduceComm_/.test(baseId(c.customId)));
  return has ? (me?.commodities ?? 0) : 0;
}

/** Mirror Computing doubles every trade good spent. */
export function tgWorth(me?: PlayerData) {
  return me?.techs?.includes("mc") ? 2 : 1;
}

const DISCOUNTS: { id: RegExp; amount: (c: Choice) => number; label: string }[] = [
  { id: /^useTech_(absol_)?st$/, amount: () => 1, label: "Sarween Tools" },
  { id: /^useTech_tf-sledfactories$/, amount: () => 1, label: "Sled Factories" },
  { id: /^exhaustTech_(absol_)?aida/, amount: (c) => Number(c.label.match(/\((\d+)r\)/)?.[1] ?? 1), label: "AI Development Algorithm" },
];

/** Discount buttons on the prompt, as toggles that lower what is left to pay. */
export function discounts(choices: Choice[]): Discount[] {
  const out: Discount[] = [];
  for (const c of choices) {
    const id = baseId(c.customId);
    const d = DISCOUNTS.find((x) => x.id.test(id));
    if (d) out.push({ key: c.key, label: d.label, amount: d.amount(c), choice: c });
  }
  return out;
}

export function isDiscount(c: Choice) {
  return DISCOUNTS.some((d) => d.id.test(baseId(c.customId)));
}

export const isPlanetChoice = (c: Choice) => /^spend_/.test(baseId(c.customId));
export const isTgChoice = (c: Choice) => /^reduceTG_/.test(baseId(c.customId));
export const isCommChoice = (c: Choice) => /^reduceComm_/.test(baseId(c.customId));
export const isResetChoice = (c: Choice) => /^resetSpend/.test(baseId(c.customId));
export const isDoneChoice = (c: Choice) => DONE_ID.test(baseId(c.customId));

/** What the bot's edited prompt says I have already spent ("for a total spend of 4 resources"). */
export function alreadySpent(content: string): number {
  const m = content.match(/total spend of (\d+) (?:resource|influence)/i);
  return m ? Number(m[1]) : 0;
}

/**
 * The cost the prompt is for, from the bot's own words: "pay a cost of 7", "(preceding build cost 7 resources)",
 * the custodians' "spend <:Influence_6:>". Undefined when the prompt does not say.
 */
export function statedCost(content: string): number | undefined {
  const hit =
    content.match(/pay a cost of (\d+)/i) ??
    content.match(/preceding build cost (\d+)/i) ??
    content.match(/spend\s*<a?:Influence_(\d+):\d+>/i) ??
    content.match(/spend (\d+) influence/i);
  return hit ? Number(hit[1]) : undefined;
}

export type Pick = { planets: string[]; tg: number; comm: number };

/**
 * The cheapest way to pay `need`: no trade goods if planets cover it, then the least overpay, then planets whose
 * other value is lowest (keep influence when paying resources and the reverse), then the fewest planets. Trade goods
 * (then commodities) only top up what planets cannot.
 */
export function suggest(planets: PayPlanet[], kind: PayKind, need: number, tg: number, comm: number, worth: number): Pick {
  if (need <= 0) return { planets: [], tg: 0, comm: 0 };
  const ready = planets.filter((p) => !p.exhausted && p.choice && valueOf(p, kind) > 0).slice(0, 16);
  const other = (p: PayPlanet) => (kind === "resources" ? p.inf : p.res);
  type Score = [number, number, number, number];
  let best: { pick: Pick; score: Score } | undefined;
  const better = (a: Score, b: Score) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  for (let mask = 0; mask < 1 << ready.length; mask++) {
    let sum = 0;
    let kept = 0;
    let count = 0;
    const ids: string[] = [];
    for (let i = 0; i < ready.length; i++) {
      if (!(mask & (1 << i))) continue;
      sum += valueOf(ready[i], kind);
      kept += other(ready[i]);
      count++;
      ids.push(ready[i].id);
    }
    const short = Math.max(0, need - sum);
    const useTg = Math.min(tg, Math.ceil(short / worth));
    const useComm = Math.min(comm, Math.ceil(Math.max(0, short - useTg * worth) / worth));
    const paid = sum + (useTg + useComm) * worth;
    if (paid < need) continue;
    const score: Score = [useTg + useComm, paid - need, kept, count];
    if (!best || better(score, best.score)) best = { pick: { planets: ids, tg: useTg, comm: useComm }, score };
  }
  if (best) return best.pick;
  return { planets: ready.map((p) => p.id), tg, comm };
}

/** "5 trade goods" → presses of the bot's 3 / 2 / 1 buttons. */
export function tgChunks(n: number): number[] {
  const out: number[] = [];
  let left = n;
  while (left > 0) {
    const k = Math.min(3, left);
    out.push(k);
    left -= k;
  }
  return out;
}
