import type { PlayConnection } from "@/discord";
import { getToken } from "@/play/session";
import type { AnswerResult, Decision } from "../../../shim/src/engine/types";
import type {
  LandRequest,
  MoveRequest,
  TacticalActivate,
  TacticalLand,
  TacticalMove,
  TurnAction,
} from "../../../shim/src/engine/kinds/tactical";

/*
 * The map's tactical actions over the engine's typed decisions (docs/ENGINE.md): activation answers
 * turn.action → tactical.activate by the systems each menu step lists, movement and landing are one direct action
 * each (`move` / `land`). Every function resolves `null` when the engine API is unavailable (or the decision is not
 * there), so the callers fall back to driving the bot's buttons.
 */

const POLL_MS = 400;
const WAIT_MS = 15000;

type Mine = { conn: PlayConnection; gameName: string };

const base = (gameName: string) => `/bot/api/game/${encodeURIComponent(gameName)}/engine`;

function headers(): Record<string, string> {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** My open decisions in the game (target = me), or null when the engine API does not answer. */
export async function myDecisions({ conn, gameName }: Mine): Promise<Decision[] | null> {
  const me = conn.store.getState().me?.id;
  if (!me) return null;
  try {
    const res = await fetch(`${base(gameName)}/decisions`, { headers: headers() });
    if (!res.ok) return null;
    const body = (await res.json()) as { decisions?: Decision[] };
    return (body.decisions ?? []).filter((d) => d.target?.userId === me);
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown): Promise<AnswerResult> {
  const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as AnswerResult | null;
  if (!json) throw new Error(`The game refused (${res.status}).`);
  if (!json.ok) throw new Error(json.error ?? `The game refused (${json.status}).`);
  return json;
}

function answer(gameName: string, d: Decision, optionId: string) {
  return post(`${base(gameName)}/decisions/${encodeURIComponent(d.id)}/answer`, { optionId, expectedSeq: d.seq });
}

/** Polls my decisions until `pick` finds one (≤15 s). */
async function waitForDecision<T>(mine: Mine, pick: (ds: Decision[]) => T | undefined): Promise<T | null> {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    const ds = await myDecisions(mine);
    const hit = ds ? pick(ds) : undefined;
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

const isStartMenu = (d: Decision): d is TurnAction =>
  d.kind === "turn.action" &&
  d.options.some((o) => !o.disabled && o.value?.action === "tactical") &&
  !d.options.some((o) => !o.disabled && o.value?.action === "end_turn");

/**
 * Activates `position`: starts a tactical action from the turn menu if needed, then follows the menu step whose
 * `positions` list it, then picks it. Resolves false when the engine is not available (fall back to buttons).
 */
export async function activateViaEngine(position: string, mine: Mine, onProgress?: (text: string) => void): Promise<boolean> {
  const ds = await myDecisions(mine);
  if (!ds) return false;
  let act = ds.find((d): d is TacticalActivate => d.kind === "tactical.activate");
  if (!act) {
    const menu = ds.find(isStartMenu);
    const opt = menu?.options.find((o) => !o.disabled && o.value?.action === "tactical");
    if (!menu || !opt) return false;
    onProgress?.("Starting a tactical action…");
    await answer(mine.gameName, menu, opt.id);
    act = (await waitForDecision(mine, (all) => all.find((d): d is TacticalActivate => d.kind === "tactical.activate"))) ?? undefined;
    if (!act) throw new Error("The game didn't offer systems to activate (no tactic token left?).");
  }
  const tried = new Set<string>();
  for (let i = 0; i < 6 && act; i++) {
    const opts = act.options.filter((o) => !o.disabled && o.value);
    const system = opts.find((o) => o.value!.step === "system" && o.value!.position === position);
    if (system) {
      onProgress?.(`Activating ${position}…`);
      await answer(mine.gameName, act, system.id);
      return true;
    }
    const menu = opts.find((o) => {
      const v = o.value!;
      return v.step !== "system" && v.positions.includes(position) && !tried.has(o.id);
    });
    if (!menu) throw new Error(`The game doesn't offer ${position} for activation.`);
    tried.add(menu.id);
    onProgress?.(`Opening ${menu.label}…`);
    const prev = act;
    await answer(mine.gameName, act, menu.id);
    act =
      (await waitForDecision(mine, (all) =>
        all.find((d): d is TacticalActivate => d.kind === "tactical.activate" && (d.id !== prev.id || d.revision !== prev.revision)),
      )) ?? undefined;
  }
  throw new Error(`Couldn't find ${position} in the game's system menu.`);
}

/** Moves exactly these units into the active system and finishes movement. Null: no engine (use buttons). */
export async function moveViaEngine(
  units: MoveRequest["units"],
  target: string,
  mine: Mine,
): Promise<AnswerResult | null> {
  const ds = await myDecisions(mine);
  const d = ds?.find(
    (x): x is TacticalMove =>
      x.kind === "tactical.move" && x.options.some((o) => !o.disabled && o.value?.action === "done" && o.value.position === target),
  );
  if (!d) return null;
  return post(`${base(mine.gameName)}/decisions/${encodeURIComponent(d.id)}/move`, {
    units,
    conclude: true,
    expectedSeq: d.seq,
  } satisfies Omit<MoveRequest, "userId">);
}

/** Lands these ground forces and finishes landing. Null: no engine (use buttons). */
export async function landViaEngine(landings: LandRequest["landings"], mine: Mine): Promise<AnswerResult | null> {
  const ds = await myDecisions(mine);
  const d = ds?.find((x): x is TacticalLand => x.kind === "tactical.land");
  if (!d) return null;
  return post(`${base(mine.gameName)}/decisions/${encodeURIComponent(d.id)}/land`, {
    landings,
    done: true,
    expectedSeq: d.seq,
  } satisfies Omit<LandRequest, "userId">);
}
