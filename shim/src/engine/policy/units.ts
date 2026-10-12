/**
 * Bot policy for manual unit edits and the combat tails around them (pure functions of decision + me). A bot never
 * edits the board by hand; when one of these prompts is addressed to it, it closes or confirms it so nothing waits on
 * the bot.
 *
 *  - units.modify (Modify Units menu): Done ("Delete these buttons") on every step.
 *  - production.produce opened from that menu (context genericBuild / genericModifyAllTiles): build nothing.
 *  - combat.automate: the opponent asked to automate our ground combat → confirm (the only option); the vote prompt
 *    (no owner, optional) is left to the people.
 *  - combat.modifier: "Resolve <action card>" after we played it / Supercharge → apply it (the only option).
 */
import type { Option } from "../types.js";
import type { CombatAutomate, CombatModifier, UnitsModify } from "../kinds/combat.js";
import type { ProductionProduce } from "../kinds/production.js";

export type UnitsChoice = { option: Option<any>; why: string };
const live = <V>(o: Option<V>) => !o.disabled && !o.needsInput && !o.id.includes("dummyPlayerSpoof");

export function chooseUnitsModify(d: UnitsModify, me: string): UnitsChoice | null {
  if (d.target?.userId !== me) return null;
  const done = d.options.find((o) => live(o) && o.value?.action === "done") ?? d.options.find((o) => live(o) && /^deleteButtons/.test(o.handler));
  return done ? { option: done, why: "modify units: bots do not edit the board by hand" } : null;
}

/** Production contexts a bot only reaches through the Modify Units menu: build nothing (one payload: Done). */
export const MANUAL_BUILD_CONTEXTS = new Set(["genericBuild", "genericModifyAllTiles"]);

export function chooseManualBuild(d: ProductionProduce, me: string): { payload: Record<string, unknown>; why: string } | null {
  if (d.target?.userId !== me) return null;
  const context = String((d.progress?.required as Record<string, unknown> | undefined)?.context ?? "");
  if (!MANUAL_BUILD_CONTEXTS.has(context)) return null;
  return { payload: { units: [] }, why: `modify units (${context}): build nothing` };
}

export function chooseCombatAutomate(d: CombatAutomate, me: string): UnitsChoice | null {
  if (d.scope !== "player" || d.target?.userId !== me) return null;
  const confirm = d.options.find((o) => live(o) && o.value?.confirmed);
  return confirm ? { option: confirm, why: `ground combat on ${confirm.value!.planet}: the opponent asked to automate it` } : null;
}

export function chooseCombatModifier(d: CombatModifier, me: string): UnitsChoice | null {
  if (d.target?.userId !== me) return null;
  const apply = d.options.find((o) => live(o) && o.value);
  return apply ? { option: apply, why: `apply combat modifier ${apply.value!.source}:${apply.value!.card}` } : null;
}
