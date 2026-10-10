import type { PlayConnection } from "@/discord";
import type {
  EntityData,
  PlayerData,
  PlayerDataResponse,
  StateCounts,
} from "@/entities/data/types";
import { lookupUnit } from "@/entities/lookup/units";
import { getToken } from "@/play/session";
import { baseId } from "@/decisions/model/controls";
import {
  buttonsOf,
  newestId,
  pressButton,
  waitForButton,
  messageOf,
  sleep,
  type Scope,
} from "./driver";

/** Units that never leave their planet. */
const STRUCTURES = new Set(["pd", "sd"]);
/** Units that ride in a ship's capacity rather than flying on their own. */
const CARGO = new Set(["ff", "gf", "mf"]);
const GROUND = new Set(["gf", "mf"]);

/** One kind of my units in one place of an origin system, e.g. 2 carriers (1 damaged) in space. */
export type UnitGroup = {
  /** "space" or a planet id. */
  holder: string;
  /** asyncId: cv, ff, gf, … */
  unit: string;
  name: string;
  /** Per state: healthy, damaged, galvanized, galvanized + damaged. */
  states: StateCounts;
  total: number;
  move: number;
  capacity: number;
  /** Rides in capacity (fighters, ground forces). */
  cargo: boolean;
};

export const groupKey = (g: { holder: string; unit: string }) =>
  `${g.holder}:${g.unit}`;

function statesOf(e: EntityData): StateCounts {
  const s = e.unitStates;
  if (s && s.some((n) => n > 0))
    return [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0];
  const damaged = Math.min(e.sustained ?? 0, e.count);
  return [e.count - damaged, damaged, 0, 0];
}

function groupOf(holder: string, e: EntityData, me: PlayerData): UnitGroup {
  const model = lookupUnit(e.entityId, me.faction, me);
  return {
    holder,
    unit: e.entityId,
    name: model?.name ?? e.entityId,
    states: statesOf(e),
    total: e.count,
    move: model?.moveValue ?? 0,
    capacity: model?.capacityValue ?? 0,
    cargo: CARGO.has(e.entityId),
  };
}

/** My movable units in a system: ships, fighters and ground forces in space, ground forces on its planets. */
export function unitsAt(
  position: string,
  me: PlayerData,
  web?: PlayerDataResponse,
): UnitGroup[] {
  const data = web?.tileUnitData?.[position];
  if (!data) return [];
  const out: UnitGroup[] = [];
  for (const e of data.space?.[me.faction] ?? []) {
    if (e.entityType !== "unit" || e.count < 1 || STRUCTURES.has(e.entityId))
      continue;
    out.push(groupOf("space", e, me));
  }
  for (const [planet, p] of Object.entries(data.planets ?? {})) {
    for (const e of p.entities?.[me.faction] ?? []) {
      if (e.entityType !== "unit" || e.count < 1 || !GROUND.has(e.entityId))
        continue;
      out.push(groupOf(planet, e, me));
    }
  }
  const order = ["ws", "fs", "dn", "ca", "cv", "dd", "ff", "mf", "gf"];
  return out.sort(
    (a, b) =>
      (a.holder === "space" ? 0 : 1) - (b.holder === "space" ? 0 : 1) ||
      order.indexOf(a.unit) - order.indexOf(b.unit),
  );
}

/** Planned moves: origin position → group key → how many. */
export type MovePlan = Record<string, Record<string, number>>;

/** Healthy units go first; damaged ones only once the healthy ones are all taken. */
export function splitStates(states: StateCounts, n: number): StateCounts {
  const out: StateCounts = [0, 0, 0, 0];
  let left = n;
  for (const i of [0, 2, 1, 3] as const) {
    const take = Math.min(left, states[i]);
    out[i] = take;
    left -= take;
  }
  return out;
}

export type PlanSummary = {
  ships: number;
  capacity: number;
  cargo: number;
  /** "2 Carrier, 4 Fighter". */
  text: string;
  empty: boolean;
};

export function summarize(
  plan: MovePlan,
  groups: Record<string, UnitGroup[]>,
): PlanSummary {
  let ships = 0;
  let capacity = 0;
  let cargo = 0;
  const names = new Map<string, number>();
  for (const [origin, picks] of Object.entries(plan)) {
    for (const g of groups[origin] ?? []) {
      const n = picks[groupKey(g)] ?? 0;
      if (!n) continue;
      if (g.cargo) cargo += n;
      else ships += n;
      capacity += n * g.capacity;
      names.set(g.name, (names.get(g.name) ?? 0) + n);
    }
  }
  const text = [...names.entries()]
    .map(([name, n]) => `${n} ${name}`)
    .join(", ");
  return { ships, capacity, cargo, text, empty: names.size === 0 };
}

type UnitCount = { unitType: string; colorID: string; counts: number[] };

/** The bot's movement payload: `"<pos>-space"` / `"<pos>-<planet>"` → unit counts per state. */
export function displacementOf(
  plan: MovePlan,
  groups: Record<string, UnitGroup[]>,
  color: string,
) {
  const out: Record<string, UnitCount[]> = {};
  for (const [origin, picks] of Object.entries(plan)) {
    for (const g of groups[origin] ?? []) {
      const n = picks[groupKey(g)] ?? 0;
      if (!n) continue;
      const key = `${origin}-${g.holder}`;
      (out[key] ??= []).push({
        unitType: g.unit,
        colorID: color,
        counts: [...splitStates(g.states, n)],
      });
    }
  }
  return out;
}

async function postMovement(
  gameName: string,
  target: string,
  displacement: Record<string, UnitCount[]>,
) {
  const token = getToken();
  const res = await fetch(
    `/bot/api/game/${encodeURIComponent(gameName)}/movement`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ targetPosition: target, displacement }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text.slice(0, 200) || `The game refused the move (${res.status}).`,
    );
  }
}

export type CommitDeps = {
  gameName: string;
  conn: PlayConnection;
  scope: Scope;
  /** The bot's "Tactical Action in system …" prompt (with Done moving). */
  prompt: { channelId: string; messageId: string };
  onProgress?: (text: string) => void;
};

/** Whether the bot's movement prompt already records units moved by its own buttons. */
export function promptHasMoves(
  conn: PlayConnection,
  prompt: { channelId: string; messageId: string },
) {
  const m = messageOf(
    conn.store.getState(),
    prompt.channelId,
    prompt.messageId,
  );
  return /\bmoved\b/i.test(m?.content ?? "");
}

const CONCLUDE = (target: string) => (id: string) =>
  id === `concludeMove_${target}`;

/**
 * Moves the planned units into `target` through the bot's movement API (the one built for its website), then
 * presses the bot's own "Done moving" so the action continues (space cannon, combat, landing) as usual. Falls
 * back to pressing the bot's per-unit move buttons when the API path fails.
 */
export async function commitMove(
  target: string,
  plan: MovePlan,
  groups: Record<string, UnitGroup[]>,
  color: string,
  deps: CommitDeps,
) {
  const { conn, scope, prompt, onProgress } = deps;
  const conclude = CONCLUDE(target);
  const empty = summarize(plan, groups).empty;
  let donePrompt: { channelId: string; messageId: string } | null = prompt;

  if (!empty) {
    const baseline = newestId(conn.store.getState(), scope);
    onProgress?.("Moving your fleet…");
    try {
      await postMovement(
        deps.gameName,
        target,
        displacementOf(plan, groups, color),
      );
      const posted = await waitForButton(conn, scope, conclude, {
        after: baseline,
        timeoutMs: 15000,
      });
      donePrompt = posted ?? prompt;
      /* The bot answered with a fresh prompt; its first one is settled too (as if pressed). */
      if (posted)
        conn.actions.noteInteraction(prompt.channelId, prompt.messageId);
    } catch (apiError) {
      onProgress?.("Moving with the game's buttons…");
      await moveWithButtons(target, plan, groups, deps).catch((e: Error) => {
        throw new Error(`${(apiError as Error).message} — ${e.message}`);
      });
    }
  }
  const m = messageOf(
    conn.store.getState(),
    donePrompt.channelId,
    donePrompt.messageId,
  );
  const done = buttonsOf(m, scope.faction).find((c) =>
    conclude(baseId(c.customId)),
  );
  if (!done?.customId)
    throw new Error(
      "The game's Done moving button is gone — finish in the popup.",
    );
  onProgress?.("Done moving…");
  await pressButton(conn, { ...donePrompt, customId: done.customId });
}

/** `unitTacticalMove_<pos>_<n>_<unit>[_<state>][_<planet>]_<color>` → how many of which unit from where. */
function parseUnitMove(id: string): { n: number; key: string } | null {
  const parts = id.split("_");
  if (
    parts[0] !== "unitTacticalMove" ||
    parts.at(-1) === "reverse" ||
    parts.length < 5
  )
    return null;
  const n = Number(parts[2]);
  if (!n) return null;
  const rest = parts.slice(4, -1);
  while (rest[0] === "dmg" || rest[0] === "glv") rest.shift();
  return { n, key: `${parts[3]}:${rest.length ? rest.join("_") : "space"}` };
}

/**
 * The bot's button chain: open each origin system (`tacticalMoveFrom_<pos>`), press its "Move N <unit>" buttons
 * until the planned number is reached, then "Done with this system".
 */
async function moveWithButtons(
  target: string,
  plan: MovePlan,
  groups: Record<string, UnitGroup[]>,
  deps: CommitDeps,
) {
  const { conn, scope, prompt } = deps;
  for (const [origin, picks] of Object.entries(plan)) {
    const want = new Map<string, number>();
    for (const g of groups[origin] ?? []) {
      const n = picks[groupKey(g)] ?? 0;
      if (n) want.set(`${g.unit}:${g.holder}`, n);
    }
    if (!want.size) continue;
    const open = buttonsOf(
      messageOf(conn.store.getState(), prompt.channelId, prompt.messageId),
      scope.faction,
    ).find((c) => baseId(c.customId) === `tacticalMoveFrom_${origin}`);
    if (!open?.customId)
      throw new Error(`The game doesn't offer moving from ${origin}.`);
    await pressButton(conn, { ...prompt, customId: open.customId });
    await sleep(600);
    for (
      let guard = 0;
      guard < 40 && [...want.values()].some((n) => n > 0);
      guard++
    ) {
      const buttons = buttonsOf(
        messageOf(conn.store.getState(), prompt.channelId, prompt.messageId),
        scope.faction,
      );
      const pick = buttons
        .map((c) => ({ c, parsed: parseUnitMove(baseId(c.customId)) }))
        .filter(
          ({ parsed }) => parsed && (want.get(parsed.key) ?? 0) >= parsed.n,
        )
        .map(({ c, parsed }) => ({ c, ...parsed! }))
        .sort((a, b) => b.n - a.n)[0];
      if (!pick?.c.customId) break;
      await pressButton(conn, { ...prompt, customId: pick.c.customId });
      want.set(pick.key, (want.get(pick.key) ?? 0) - pick.n);
      await sleep(500);
    }
    const back = buttonsOf(
      messageOf(conn.store.getState(), prompt.channelId, prompt.messageId),
      scope.faction,
    ).find((c) => /^doneWithOneSystem/.test(baseId(c.customId)));
    if (back?.customId) {
      await pressButton(conn, { ...prompt, customId: back.customId });
      await sleep(600);
    }
  }
  void target;
}
