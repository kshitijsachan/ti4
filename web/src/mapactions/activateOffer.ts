/*
 * The engine's open "activate a system" decision (tactical.activate), read as the map's activation targets. The bot's
 * own system menu is the authority there: it already applied the rules of this activation (Thunder's Edge Warfare
 * activates without a tactic token and may pick a system holding my token), so the map lights exactly what it offers
 * instead of re-deriving the usual token rules (playtest 7, pbd436: 0 tactic tokens greyed every system).
 * Pure (no imports with runtime effects): unit-tested.
 */

type ActivateOption = { disabled?: boolean; value?: unknown };

export type EngineActivation = {
  /** Every system the menu leads to: its direct systems and those under each ring / distance step. */
  positions: Set<string>;
  /** Whether activating spends a tactic token (false: Warfare and other token-free activations). */
  token: boolean;
};

type ActivateValue = { step?: unknown; position?: unknown; positions?: unknown; token?: unknown } | null | undefined;

/** The systems an open tactical.activate decision offers, or null when it lists none (then the usual rules apply). */
export function engineActivation(options: ActivateOption[] | undefined): EngineActivation | null {
  if (!options) return null;
  const positions = new Set<string>();
  let token = true;
  for (const o of options) {
    const v = o.value as ActivateValue;
    if (o.disabled || !v || typeof v !== "object") continue;
    if (v.token === false) token = false;
    if (v.step === "system" && typeof v.position === "string") positions.add(v.position);
    else if (Array.isArray(v.positions)) for (const p of v.positions) if (typeof p === "string") positions.add(p);
  }
  return positions.size ? { positions, token } : null;
}

export type OfferedActivation = { ok: true } | { ok: false; reason: string };

/**
 * Whether `position` can be activated under the engine's menu. A system the menu does not offer keeps the most telling
 * reason: my own token there (when this activation places one), else no tactic token, else just not offered.
 */
export function offeredActivation(
  position: string,
  offer: EngineActivation,
  ctx: { hasMyToken: boolean; tacticTokens: number },
): OfferedActivation {
  if (offer.positions.has(position)) return { ok: true };
  if (offer.token && ctx.hasMyToken) return { ok: false, reason: "Your command token is already here" };
  if (offer.token && ctx.tacticTokens < 1) return { ok: false, reason: "No command tokens in your tactic pool" };
  return { ok: false, reason: "This system can't be activated right now" };
}

/** A start-of-turn menu: a live Tactical action and no End turn yet (the post-action menu is not one). */
export function isStartMenu(d: { kind: string; options: { disabled?: boolean; value?: unknown }[] }): boolean {
  const action = (o: { value?: unknown }) => (o.value as { action?: unknown } | null | undefined)?.action;
  return (
    d.kind === "turn.action" &&
    d.options.some((o) => !o.disabled && action(o) === "tactical") &&
    !d.options.some((o) => !o.disabled && action(o) === "end_turn")
  );
}
