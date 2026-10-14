import type { Json, StoredMessage } from "../store.js";

/** A pressable control of a message: a button, or a string select (answered with its first option). */
export type Control = { custom_id: string; label: string; kind: "button" | "select"; values?: string[]; options?: { value: string; label: string }[] };

/** A bot message with controls in one of the game's channels, as one autopilot seat sees it. */
export type Prompt = { ch: Json; m: StoredMessage; controls: Control[] };

/**
 * controlsOf per components array: every autopilot seat walks every recent prompt's components on each pass (decide,
 * the planner's prompt lists, the stall checks), ~25% of the shim's autopilot CPU. A stored message's components are
 * replaced, never edited in place (Hub.editMessage / normalizeComponents), so the array identity is the revision.
 * Callers treat the result as read-only (they filter / map into new arrays).
 */
const controlsMemo = new WeakMap<Json[], Control[]>();

export function controlsOf(components: Json[] | undefined): Control[] {
  if (!Array.isArray(components)) return walkControls(components);
  let hit = controlsMemo.get(components);
  if (!hit) controlsMemo.set(components, (hit = walkControls(components)));
  return hit;
}

function walkControls(components: Json[] | undefined): Control[] {
  const out: Control[] = [];
  const walk = (list: Json[] | undefined) => {
    for (const c of list ?? []) {
      if (!c || typeof c !== "object") continue;
      if (c.type === 2 && !c.disabled && c.style !== 5 && c.custom_id) {
        out.push({ custom_id: c.custom_id, label: String(c.label ?? c.emoji?.name ?? ""), kind: "button" });
      } else if (c.type === 3 && !c.disabled && c.custom_id && c.options?.length) {
        const min = Math.max(1, c.min_values ?? 1);
        out.push({
          custom_id: c.custom_id,
          label: String(c.placeholder ?? "select"),
          kind: "select",
          values: c.options.slice(0, min).map((o: Json) => o.value),
          options: c.options.map((o: Json) => ({ value: String(o.value), label: String(o.label ?? o.value) })),
        });
      }
      walk(c.components);
      if (c.accessory) walk([c.accessory]);
      if (c.component) walk([c.component]);
    }
  };
  walk(components);
  return out;
}

/**
 * The custom id without its `FFCC_<faction>_` lock, and without the bot's DoneRole tag on deleteButtons closers
 * (`deleteButtons_<ctx>~pay`, `~prod`, `~ccgain`, `~ccredist`, `~cclose`, `~fleetlose`): those say what the closer
 * finishes in the id instead of the label, and every match here is on the plain closer id.
 */
/** The handler id: no FFCC_<faction>_ lock, no DoneRole suffix (~pay…), no strategy-card re-offer suffix (~o<n>, ScOffer). */
export const baseId = (id: string) => id.replace(/^FFCC_[^_]+_/, "").replace(/~o\d+$/, "").replace(/~(pay|prod|ccgain|ccredist|cclose|fleetlose)$/, "");

/** The faction a control is locked to, if any. */
export const lockOf = (id: string) => /^FFCC_([^_]+)_/.exec(id)?.[1];

/** Keleres is drafted as one faction and played as one of three (keleresa / keleresm / keleresx). */
const factionFamily = (f: string | undefined) => (f?.startsWith("keleres") ? "keleres" : f);

/**
 * Whether a control is locked to `faction`. The autopilot names Keleres by its family ("keleres") while the bot locks
 * its buttons to the flavour (FFCC_keleresa_): live pbd114, the unit-limit desk never recognised its own removal list
 * and the rule table pressed "Done Removing" on it 178 times in 10 minutes.
 */
export const lockIs = (id: string, faction: string | undefined) => {
  const lock = lockOf(id);
  return !!lock && !!faction && factionFamily(lock) === factionFamily(faction);
};

export const snowflakeAfter = (a: string, b: string | undefined) => !b || BigInt(a) > BigInt(b);
