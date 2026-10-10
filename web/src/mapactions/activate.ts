import type { PlayConnection } from "@/discord";
import { baseId, type Choice } from "@/decisions/model/controls";
import { buttonsOf, findButton, messageOf, newestId, pressButton, waitForButton, type Scope } from "./driver";
import type { TacticalStep } from "./context";

const CHOOSE = /^(ringTile_|ring_|getTilesThisFarAway_)/;
const AFTER_ACTIVATION = /^(tacticalMoveFrom_|concludeMove_|ChooseDifferentDestination)/;
const MAX_STEPS = 8;

/** "301" → ring 3, slot 1; "000" → ring 0; corners and fracture positions have no ring number. */
export function ringOf(position: string): { ring: number; slot: number } | null {
  if (!/^\d{3,}$/.test(position)) return null;
  return { ring: Number(position.slice(0, -2)), slot: Number(position.slice(-2)) };
}

/** The ring button (of the bot's ring menu) whose sub-menu lists `position`. */
function ringButton(buttons: Choice[], position: string, tried: Set<string>): Choice | undefined {
  const ids = buttons.map((c) => ({ c, id: baseId(c.customId) })).filter(({ c }) => !tried.has(c.customId ?? ""));
  const loc = ringOf(position);
  if (!loc) return ids.find(({ id }) => id === "ring_corners")?.c;
  const total = loc.ring * 6;
  const side = loc.slot >= total / 2 || loc.slot === 1 ? "left" : "right";
  const halves = ids.filter(({ id }) => id === `ring_${loc.ring}_left` || id === `ring_${loc.ring}_right`);
  if (halves.length) return (halves.find(({ id }) => id.endsWith(side)) ?? halves[0]).c;
  const whole = ids.find(({ id }) => id === `ring_${loc.ring}`);
  if (whole) return whole.c;
  /* The distance-based menu ("Get Tiles 2 Spaces Away"): walk outwards. */
  const far = ids
    .map(({ c, id }) => ({ c, d: Number(id.match(/^getTilesThisFarAway_(\d+)/)?.[1] ?? NaN) }))
    .filter(({ d }) => !Number.isNaN(d))
    .sort((a, b) => a.d - b.d);
  return far[0]?.c;
}

export type ActivateDeps = {
  conn: PlayConnection;
  scope: Scope;
  step: TacticalStep;
  onProgress?: (text: string) => void;
};

/**
 * Activates `position` with a tactical action by pressing the bot's own buttons in order — Tactical Action, the
 * ring that holds the system, then the system — waiting for each prompt, as if the player clicked them.
 */
export async function activateSystem(position: string, { conn, scope, step, onProgress }: ActivateDeps) {
  const isChoose = (id: string) => CHOOSE.test(id);
  let prompt =
    step.kind === "choose"
      ? { channelId: step.prompt.channelId, messageId: step.prompt.message.id }
      : null;

  if (!prompt) {
    if (step.kind !== "turn") throw new Error("The game isn't asking for a tactical action right now.");
    const turn = buttonsOf(step.prompt.message, scope.faction).find((c) => baseId(c.customId) === "tacticalAction");
    if (!turn?.customId) throw new Error("No Tactical Action button on your turn prompt.");
    onProgress?.("Starting a tactical action…");
    const baseline = newestId(conn.store.getState(), scope);
    await pressButton(conn, { channelId: step.prompt.channelId, messageId: step.prompt.message.id, customId: turn.customId });
    const next = await waitForButton(conn, scope, isChoose, { after: baseline });
    if (!next) throw new Error("The game didn't offer systems to activate (no tactic token left?).");
    prompt = { channelId: next.channelId, messageId: next.messageId };
  }

  const tried = new Set<string>();
  for (let i = 0; i < MAX_STEPS; i++) {
    const m = messageOf(conn.store.getState(), prompt.channelId, prompt.messageId);
    const buttons = buttonsOf(m, scope.faction);
    const direct = buttons.find((c) => baseId(c.customId) === `ringTile_${position}`);
    const baseline = newestId(conn.store.getState(), scope);
    if (direct?.customId) {
      onProgress?.(`Activating ${position}…`);
      await pressButton(conn, { ...prompt, customId: direct.customId });
      await waitForButton(conn, scope, (id) => AFTER_ACTIVATION.test(id), { after: baseline, timeoutMs: 15000 });
      return;
    }
    const ring = ringButton(buttons, position, tried);
    if (!ring?.customId) throw new Error(`The game doesn't offer ${position} for activation.`);
    tried.add(ring.customId);
    onProgress?.(`Opening ${ring.label}…`);
    await pressButton(conn, { ...prompt, customId: ring.customId });
    const next = await waitForButton(conn, scope, isChoose, { after: baseline });
    if (!next) throw new Error(`The game didn't answer "${ring.label}".`);
    prompt = { channelId: next.channelId, messageId: next.messageId };
  }
  throw new Error(`Couldn't find ${position} in the game's system menu.`);
}

/** Whether a later prompt shows the activation went through. */
export function activationSeen(conn: PlayConnection, scope: Scope, after?: string) {
  return !!findButton(conn.store.getState(), scope, (id) => AFTER_ACTIVATION.test(id), after);
}
