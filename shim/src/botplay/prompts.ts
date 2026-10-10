import type { Json, StoredMessage } from "../store.js";

/** A pressable control of a message: a button, or a string select (answered with its first option). */
export type Control = { custom_id: string; label: string; kind: "button" | "select"; values?: string[]; options?: { value: string; label: string }[] };

/** A bot message with controls in one of the game's channels, as one autopilot seat sees it. */
export type Prompt = { ch: Json; m: StoredMessage; controls: Control[] };

export function controlsOf(components: Json[] | undefined): Control[] {
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

/** The custom id without its `FFCC_<faction>_` lock. */
export const baseId = (id: string) => id.replace(/^FFCC_[^_]+_/, "");

/** The faction a control is locked to, if any. */
export const lockOf = (id: string) => /^FFCC_([^_]+)_/.exec(id)?.[1];

export const snowflakeAfter = (a: string, b: string | undefined) => !b || BigInt(a) > BigInt(b);
