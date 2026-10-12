import type { Command, CommandOption, CommandOptionChoice, InteractionOption } from "../types";
import { OptionType } from "../types";

/** One invocable slash command path, e.g. `/game create_game_button`. */
export type CommandLeaf = {
  key: string;
  path: string[];
  command: Command;
  description: string;
  options: CommandOption[];
};

const isSub = (o: CommandOption) => o.type === OptionType.SubCommand || o.type === OptionType.SubCommandGroup;

/** Flatten chat-input commands into their invocable leaves (subcommand groups → subcommands). */
export function flattenCommands(commands: Command[]): CommandLeaf[] {
  const leaves: CommandLeaf[] = [];
  for (const cmd of commands) {
    if ((cmd.type ?? 1) !== 1) continue;
    const opts = cmd.options ?? [];
    if (!opts.some(isSub)) {
      leaves.push({ key: cmd.name, path: [cmd.name], command: cmd, description: cmd.description ?? "", options: opts });
      continue;
    }
    for (const o of opts) {
      if (o.type === OptionType.SubCommand) {
        leaves.push({ key: `${cmd.name} ${o.name}`, path: [cmd.name, o.name], command: cmd, description: o.description ?? "", options: o.options ?? [] });
        continue;
      }
      for (const sub of o.options ?? []) {
        leaves.push({
          key: `${cmd.name} ${o.name} ${sub.name}`,
          path: [cmd.name, o.name, sub.name],
          command: cmd,
          description: sub.description ?? "",
          options: sub.options ?? [],
        });
      }
    }
  }
  return leaves.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Rank leaves for a typed query: every word must appear in the path; exact and prefix matches on the
 * command name rank first, so `/game cr` finds `game create_game_button` immediately.
 */
export function searchCommands(leaves: CommandLeaf[], query: string, limit = 60): CommandLeaf[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return leaves.slice(0, limit);
  const scored: { leaf: CommandLeaf; score: number }[] = [];
  for (const leaf of leaves) {
    let score = 0;
    let ok = true;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const seg = leaf.path[i];
      if (seg === w) score += 10;
      else if (seg?.startsWith(w)) score += 6;
      else if (leaf.path.some((p) => p.startsWith(w))) score += 3;
      else if (leaf.key.includes(w)) score += 1;
      else ok = false;
    }
    if (ok) scored.push({ leaf, score: score - leaf.path.length * 0.1 });
  }
  scored.sort((a, b) => b.score - a.score || a.leaf.key.localeCompare(b.leaf.key));
  return scored.slice(0, limit).map((s) => s.leaf);
}

export type OptionValues = Record<string, string>;

function convert(o: CommandOption, raw: string): string | number | boolean | undefined {
  if (raw === "") return undefined;
  switch (o.type) {
    case OptionType.Integer:
      return Number.isFinite(parseInt(raw, 10)) ? parseInt(raw, 10) : undefined;
    case OptionType.Number:
      return Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : undefined;
    case OptionType.Boolean:
      return raw === "true";
    default:
      return raw;
  }
}

/** Wrap leaf options in the subcommand / group envelope Discord interactions use. */
function wrap(leaf: CommandLeaf, opts: InteractionOption[]): InteractionOption[] {
  if (leaf.path.length === 1) return opts;
  const sub: InteractionOption = { type: OptionType.SubCommand, name: leaf.path[leaf.path.length - 1], options: opts };
  if (leaf.path.length === 2) return [sub];
  return [{ type: OptionType.SubCommandGroup, name: leaf.path[1], options: [sub] }];
}

/** Interaction options for a `command` op. Autocomplete display names map back to their values. */
export function buildOptions(
  leaf: CommandLeaf,
  values: OptionValues,
  choiceCache: Record<string, CommandOptionChoice[]> = {},
): InteractionOption[] {
  const opts: InteractionOption[] = [];
  for (const o of leaf.options) {
    const raw = resolveChoice(values[o.name] ?? "", choiceCache[o.name]);
    const value = convert(o, raw);
    if (value === undefined) continue;
    opts.push({ type: o.type, name: o.name, value });
  }
  return wrap(leaf, opts);
}

/** Options for an `autocomplete` op: everything typed so far, with the focused option flagged. */
export function buildAutocompleteOptions(leaf: CommandLeaf, values: OptionValues, focused: string): InteractionOption[] {
  const opts: InteractionOption[] = [];
  for (const o of leaf.options) {
    const raw = values[o.name] ?? "";
    if (o.name === focused) {
      opts.push({ type: o.type, name: o.name, value: raw, focused: true });
      continue;
    }
    const value = convert(o, raw);
    if (value !== undefined) opts.push({ type: o.type, name: o.name, value });
  }
  return wrap(leaf, opts);
}

function resolveChoice(raw: string, choices: CommandOptionChoice[] | undefined): string {
  const hit = choices?.find((c) => c.name === raw);
  return hit ? String(hit.value) : raw;
}

export function missingRequired(leaf: CommandLeaf, values: OptionValues): CommandOption[] {
  return leaf.options.filter((o) => o.required && !(values[o.name] ?? "").trim());
}

export const OPTION_TYPE_LABEL: Record<number, string> = {
  3: "text",
  4: "integer",
  5: "true/false",
  6: "user",
  7: "channel",
  8: "role",
  9: "user or role",
  10: "number",
  11: "file",
};
