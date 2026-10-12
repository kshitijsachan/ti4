/**
 * Autopilot policy for perpetual / optional / undo prompts, preferences and select-only prompts (c12). Pure:
 * (decision, state, me) → option. Returns undefined for kinds it does not own, null for "do not answer".
 *
 * - ui.undo_affordance / ui.optional / ui.info_menu: never answered. They are not questions (`awaits` is false), so
 *   a bot never waits on them and never presses an undo, a shortcut or a help-menu button by itself.
 * - player.preference: the defaults the legacy rule table used (auto-pass secret scoring and Sabotage, auto-react on
 *   agendas), plus "no stats" for the statistics opt-in; anything else gets its first answer so the question goes.
 * - choose.select: the select's preselected (default) value, else its first value.
 */
import { isAffordance, type Decision, type GameState, type Option } from "../types.js";

export type UiChoice = { option: Option<any>; why: string };

/** Preferences, in order: [preference, choice]. Same answers as the old RULES (sandbagPref_bot, setAutoPassMedian_1). */
const PREFERRED: ReadonlyArray<readonly [string, string]> = [
  ["sandbag", "bot"],
  ["auto_pass_sabotage", "1"],
  ["agenda", "true"],
  ["stats", "declineAll"],
  ["pillage_own_transactions", "no"],
];

export function choosePerpetual(d: Decision, _state: GameState | null, me: string): UiChoice | null | undefined {
  if (isAffordance(d)) return null;
  if (d.kind !== "player.preference" && d.kind !== "choose.select") return undefined;
  // Never another seat's prompt, never an unaddressed one (a select-only settings menu belongs to the steward).
  if (d.scope !== "player" || d.target?.userId !== me) return null;
  const live = (d.options as Option<any>[]).filter((o) => !o.disabled && !o.needsInput);
  if (!live.length) return null;
  if (d.kind === "choose.select") return selectChoice(d, live);
  return preference(live);
}

function preference(live: Option<any>[]): UiChoice | null {
  const typed = live.filter((o) => o.value);
  for (const [pref, choice] of PREFERRED) {
    const o = typed.find((x) => x.value.preference === pref && x.value.choice === choice);
    if (o) return { option: o, why: `preferences: ${pref} = ${choice}` };
  }
  // Statistics toggles (stats:<key>) edit the prompt in place without finishing it: answer something final.
  const final = typed.filter((o) => !String(o.value.preference).startsWith("stats:"));
  const pick = final.find((o) => ["true", "yes", "bot"].includes(String(o.value.choice))) ?? final[0];
  return pick ? { option: pick, why: `preferences: ${pick.value.preference} = ${pick.value.choice} (default)` } : null;
}

function selectChoice(d: Decision, live: Option<any>[]): UiChoice | null {
  for (const input of d.inputs ?? []) {
    const field = input.fields?.[0];
    const preset = field?.choices?.find((c) => c.selected) ?? field?.choices?.[0];
    if (!preset) continue;
    const o = live.find((x) => x.id === `${input.id}#${preset.value}`);
    if (o) return { option: o, why: `select: ${preset.selected ? "keep the preselected" : "first"} value` };
  }
  return { option: live[0], why: "select: first value" };
}
