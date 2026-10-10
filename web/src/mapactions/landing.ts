import type { PlayConnection } from "@/discord";
import { controlSignature } from "@/discord/client/store";
import { baseId } from "@/decisions/model/controls";
import {
  buttonsOf,
  messageOf,
  pressButton,
  waitFor,
  type Scope,
} from "./driver";

/** What the bot's landing prompt offers: per planet, which of my ground units can land (and how many at most). */
export type LandingOffer = {
  target: string;
  planets: string[];
  /** unit asyncId → planets it may land on. */
  units: Record<string, string[]>;
};

/** `landUnits_<pos>_<n><unit>_<planet>_<color>` */
const LAND = /^landUnits_([^_]+)_(\d)([a-z]{2})(?:damaged)?_(.+)_([a-z]+)$/;

export function landingOffer(
  conn: PlayConnection,
  scope: Scope,
  prompt: { channelId: string; messageId: string },
): LandingOffer | null {
  const m = messageOf(
    conn.store.getState(),
    prompt.channelId,
    prompt.messageId,
  );
  let target = "";
  const planets: string[] = [];
  const units: Record<string, string[]> = {};
  for (const c of buttonsOf(m, scope.faction)) {
    const hit = baseId(c.customId).match(LAND);
    if (!hit) continue;
    const [, pos, , unit, planet] = hit;
    target = pos;
    if (!planets.includes(planet)) planets.push(planet);
    const list = (units[unit] ??= []);
    if (!list.includes(planet)) list.push(planet);
  }
  return target ? { target, planets, units } : null;
}

/** planet → unit → how many to land. */
export type LandingPlan = Record<string, Record<string, number>>;

export type LandDeps = {
  conn: PlayConnection;
  scope: Scope;
  prompt: { channelId: string; messageId: string };
  onProgress?: (text: string) => void;
};

/**
 * Lands the planned ground forces by pressing the bot's own "Land 1/2 Infantry on X" buttons on its landing prompt
 * (each press edits the prompt, so each next press waits for the edit), then "Done Landing Troops".
 */
export async function commitLanding(
  plan: LandingPlan,
  { conn, scope, prompt, onProgress }: LandDeps,
) {
  const current = () =>
    messageOf(conn.store.getState(), prompt.channelId, prompt.messageId);
  for (const [planet, units] of Object.entries(plan)) {
    for (const [unit, total] of Object.entries(units)) {
      let left = total;
      while (left > 0) {
        const want = Math.min(2, left);
        const buttons = buttonsOf(current(), scope.faction);
        const pick =
          buttons.find((c) => matches(c.customId, unit, planet, want)) ??
          buttons.find((c) => matches(c.customId, unit, planet, 1));
        if (!pick?.customId)
          throw new Error(
            `The game no longer offers landing ${unit === "mf" ? "mechs" : "infantry"} on ${planet}.`,
          );
        const n = Number(baseId(pick.customId).match(LAND)?.[2] ?? 1);
        onProgress?.(`Landing ${n} on ${planet}…`);
        const before = controlSignature(current()?.components);
        await pressButton(conn, { ...prompt, customId: pick.customId });
        await waitFor(
          conn,
          (s) =>
            controlSignature(
              s.messages[prompt.channelId]?.byId[prompt.messageId]?.components,
            ) !== before
              ? true
              : null,
          6000,
        );
        left -= n;
      }
    }
  }
  const done = buttonsOf(current(), scope.faction).find((c) =>
    /^doneLanding/.test(baseId(c.customId)),
  );
  if (!done?.customId)
    throw new Error(
      "The game's Done Landing Troops button is gone — finish in the popup.",
    );
  onProgress?.("Done landing…");
  await pressButton(conn, { ...prompt, customId: done.customId });
}

function matches(
  customId: string | undefined,
  unit: string,
  planet: string,
  n: number,
) {
  const hit = baseId(customId).match(LAND);
  return !!hit && hit[3] === unit && hit[4] === planet && Number(hit[2]) === n;
}
