import type { PlayConnection } from "@/discord";
import { engineStore } from "@/engine/store";
import { myDecisions } from "@/engine/reducer";
import type { AnswerPayload } from "@/engine/link";
import type { AnswerResult, Decision } from "../../../shim/src/engine/types";
import type {
  LandRequest,
  MoveRequest,
  TacticalActivate,
  TacticalLand,
  TacticalMove,
} from "../../../shim/src/engine/kinds/tactical";
import { isStartMenu } from "./step";

/*
 * The map's tactical actions over the engine's typed decisions (docs/ENGINE.md): activation answers
 * turn.action → tactical.activate by the systems each menu step lists, movement and landing are one direct action
 * each (`move` / `land`). Decisions are read from the page's engine stream (engineStore); answers go over the play
 * socket's `op:"answer"` and resolve with the engine's AnswerResult (rejecting with its error).
 */

const ANSWER_TIMEOUT_MS = 60000;
const WAIT_MS = 15000;

/** My open decisions in the game on screen (the engine stream's view). */
export function currentDecisions(conn: PlayConnection): Decision[] {
  return myDecisions(engineStore.getState().view, conn.store.getState().me?.id);
}

/** The current copy of a decision (it is edited in place: answers need its latest seq), if still open. */
export function latest<D extends Decision>(d: D): D | undefined {
  return engineStore.getState().view.decisions[d.id] as D | undefined;
}

/** The current copy of a decision, else my newest open decision of its kind (a step re-posted as a new prompt). */
function currentOf<D extends Decision>(conn: PlayConnection, d: D): D | undefined {
  return latest(d) ?? (currentDecisions(conn).filter((x) => x.kind === d.kind).sort((a, b) => b.seq - a.seq)[0] as D | undefined);
}

/** Answers a decision over the play socket and waits for the engine's result. Rejects with the engine's error. */
export function answerEngine(conn: PlayConnection, decision: Decision, a: AnswerPayload): Promise<AnswerResult> {
  const d = latest(decision) ?? decision;
  return new Promise<AnswerResult>((resolve, reject) => {
    let nonce: string | null = null;
    const finish = (fn: () => void) => {
      off();
      window.clearTimeout(timer);
      fn();
    };
    const off = conn.onEngineFrame((frame) => {
      if (frame.type !== "answer" || !nonce || frame.nonce !== nonce) return;
      const r = frame.result;
      if (r.ok) finish(() => resolve(r as AnswerResult));
      else finish(() => reject(new Error(r.error ?? `The game refused (${r.status}).`)));
    });
    const timer = window.setTimeout(() => finish(() => reject(new Error("No response from the game server."))), ANSWER_TIMEOUT_MS);
    const key = a.action ?? a.optionId ?? "payload";
    nonce = conn.send({
      op: "answer",
      game: d.game,
      decisionId: d.id,
      ...a,
      expectedSeq: d.seq,
      requestId: `${d.id}:${d.revision ?? d.seq}:${key}:map:${Date.now().toString(36)}`,
    });
    if (!nonce) finish(() => reject(new Error("Not connected to the game server — reconnecting.")));
  });
}

/** Resolves with the first value `pick` finds in my decisions (now or as the stream changes); null after 15 s. */
export function waitForDecision<T>(conn: PlayConnection, pick: (ds: Decision[]) => T | undefined, timeoutMs = WAIT_MS): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      off();
      window.clearTimeout(timer);
      resolve(v);
    };
    const check = () => {
      const hit = pick(currentDecisions(conn));
      if (hit !== undefined && hit !== null) finish(hit);
    };
    const off = engineStore.subscribe(check);
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    check();
  });
}

const isActivate = (d: Decision): d is TacticalActivate => d.kind === "tactical.activate";

/**
 * Activates `position`: starts a tactical action from the turn menu if needed, then follows the menu step whose
 * `positions` list it, then picks it, and waits for the movement step.
 */
export async function activateViaEngine(position: string, conn: PlayConnection, onProgress?: (text: string) => void): Promise<void> {
  const ds = currentDecisions(conn);
  let act: TacticalActivate | undefined = ds.filter(isActivate).sort((a, b) => b.seq - a.seq)[0];
  if (!act) {
    const menu = ds.find(isStartMenu);
    const opt = menu?.options.find((o) => !o.disabled && o.value?.action === "tactical");
    if (!menu || !opt) throw new Error("The game isn't asking for a tactical action right now.");
    onProgress?.("Starting a tactical action…");
    await answerEngine(conn, menu, { optionId: opt.id });
    act = (await waitForDecision(conn, (all) => all.find(isActivate))) ?? undefined;
    if (!act) throw new Error("The game didn't offer systems to activate (no tactic token left?).");
  }
  const tried = new Set<string>();
  for (let i = 0; i < 6 && act; i++) {
    const opts = act.options.filter((o) => !o.disabled && o.value);
    const system = opts.find((o) => o.value!.step === "system" && o.value!.position === position);
    if (system) {
      onProgress?.(`Activating ${position}…`);
      const before = engineStore.getState().view.seq;
      await answerEngine(conn, act, { optionId: system.id });
      /* Settle once the next step (movement, or anything after it) is up, so the map does not flash the old one. */
      await waitForDecision(conn, (all) => all.find((d) => d.seq > before && d.kind !== "tactical.activate"), 15000);
      return;
    }
    const menu = opts.find((o) => {
      const v = o.value!;
      return v.step !== "system" && v.positions.includes(position) && !tried.has(o.id);
    });
    if (!menu) throw new Error(`The game doesn't offer ${position} for activation.`);
    tried.add(menu.id);
    onProgress?.(`Opening ${menu.label}…`);
    const prev = latest(act) ?? act;
    await answerEngine(conn, prev, { optionId: menu.id });
    act =
      (await waitForDecision(conn, (all) =>
        all.find((d): d is TacticalActivate => isActivate(d) && (d.id !== prev.id || d.revision !== prev.revision)),
      )) ?? undefined;
  }
  throw new Error(`Couldn't find ${position} in the game's system menu.`);
}

/** Moves exactly these units into the active system and finishes movement (the tactical.move decision's `move`). */
export async function moveViaEngine(conn: PlayConnection, decision: TacticalMove, units: MoveRequest["units"]): Promise<AnswerResult> {
  const d = currentOf(conn, decision);
  if (!d) throw new Error("The game is no longer asking for movement.");
  return answerEngine(conn, d, { action: "move", body: { units, conclude: true } satisfies Omit<MoveRequest, "userId"> });
}

/** Lands these ground forces and finishes landing (the tactical.land decision's `land`). */
export async function landViaEngine(conn: PlayConnection, decision: TacticalLand, landings: LandRequest["landings"]): Promise<AnswerResult> {
  const d = currentOf(conn, decision);
  if (!d) throw new Error("The game is no longer asking where to land.");
  return answerEngine(conn, d, { action: "land", body: { landings, done: true } satisfies Omit<LandRequest, "userId"> });
}

/** Presses one option of a decision (an ability on the movement step, the rift roll on the landing step). */
export async function pressOption(conn: PlayConnection, decision: Decision, optionId: string): Promise<AnswerResult> {
  const d = latest(decision);
  if (!d) throw new Error("That step is over.");
  return answerEngine(conn, d, { optionId });
}
