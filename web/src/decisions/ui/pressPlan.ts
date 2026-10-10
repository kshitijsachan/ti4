import { usePlayConnection, type Message } from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { usePressButton } from "@/play/usePressButton";
import { baseId, choicesOf, type Choice } from "../model/controls";
import { useRunner } from "../renderers/strategy/runner";

type Conn = ReturnType<typeof usePlayConnection>;
export type PlayStore = ReturnType<Conn["store"]["getState"]>;

/** One bot button to press. */
export type Target = { channelId: string; messageId: string; customId: string };

/** What a run has done so far, for steps that depend on it. */
export type PlanContext = {
  /** The message of the last press (a prompt the bot posts in answer is newer than it). */
  lastMessageId: string;
  /** Presses made so far. */
  presses: number;
};

/**
 * One press of a plan. `find` runs when the step comes up, against the store as it is then, so a step can press a
 * prompt the bot posted in answer to an earlier press. `null` = not there (yet).
 */
export type PlanStep = {
  label: string;
  find: (state: PlayStore, ctx: PlanContext) => Target | null;
  /** Wait this long for `find` to return a target (a prompt the bot is about to post). Default: no wait. */
  waitMs?: number;
  /** A missing target is fine (skip). Otherwise the run stops with an error. */
  optional?: boolean;
  /** Run the step again after each press while `find` still returns a target, at most this many times (a ladder). */
  repeat?: number;
};

const SETTLE_MS = 4000;

/** The message's last edit (or "gone"), to tell when the bot has finished with a press. */
function stamp(state: PlayStore, t: Target) {
  const m = state.messages[t.channelId]?.byId[t.messageId];
  return m ? (m.edited_timestamp ?? m.timestamp) : "gone";
}

/**
 * The bot acknowledges a press before it has applied it; a second press on its heels can race it and lose a change.
 * Wait until the bot edited or deleted the message (or posted a newer one in the channel), or a short while.
 */
function settled(conn: Conn, t: Target, before: string, newestBefore: string | undefined) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      unsubscribe();
      clearTimeout(timer);
      setTimeout(resolve, 150);
    };
    const check = () => {
      const s = conn.store.getState();
      if (stamp(s, t) !== before) return finish();
      const ids = s.messages[t.channelId]?.ids;
      const newest = ids?.[ids.length - 1];
      if (newest && newestBefore && compareSnowflakes(newest, newestBefore) > 0) finish();
    };
    const unsubscribe = conn.store.subscribe(check);
    const timer = setTimeout(finish, SETTLE_MS);
    check();
  });
}

function waitFor(conn: Conn, step: PlanStep, ctx: PlanContext, ms: number) {
  return new Promise<Target | null>((resolve) => {
    let done = false;
    const finish = (t: Target | null) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(t);
    };
    const check = () => {
      const t = step.find(conn.store.getState(), ctx);
      if (t) finish(t);
    };
    const unsubscribe = conn.store.subscribe(check);
    const timer = setTimeout(() => finish(null), ms);
    check();
  });
}

function newestId(state: PlayStore, channelId: string) {
  const ids = state.messages[channelId]?.ids;
  return ids?.[ids.length - 1];
}

/**
 * Runs a plan of bot presses in order, each after the bot settled the one before; then `after`. Shares the strategy
 * runner's progress store, so only one multi-press flow runs at a time across the decision panels and
 * `RunProgress` shows where it is. Resolves `true` when every required step went through.
 */
export function usePressPlan() {
  const press = usePressButton();
  const conn = usePlayConnection();
  return async (key: string, steps: PlanStep[], after?: () => void) => {
    const runner = useRunner.getState();
    if (runner.running && Date.now() - runner.startedAt < 60_000) {
      runner.set({ error: `Still pressing “${runner.label}” — try again in a moment.` });
      return false;
    }
    runner.set({ running: key, step: 0, total: steps.length, label: "", error: null, startedAt: Date.now() });
    const ctx: PlanContext = { lastMessageId: "0", presses: 0 };
    const fail = (error: string) => {
      useRunner.getState().set({ running: null, error });
      return false;
    };
    for (const [i, step] of steps.entries()) {
      for (let round = 0; round <= (step.repeat ?? 0); round++) {
        useRunner.getState().set({ step: i + 1, label: step.label, startedAt: Date.now() });
        const target = step.waitMs ? await waitFor(conn, step, ctx, step.waitMs) : step.find(conn.store.getState(), ctx);
        if (!target) {
          if (round > 0 || step.optional) break;
          console.warn("[quantity] no button for", step.label);
          return fail(`The game did not offer “${step.label}”.`);
        }
        const state = conn.store.getState();
        const before = stamp(state, target);
        const newestBefore = newestId(state, target.channelId);
        console.info("[quantity] press", target.customId, "on", target.messageId);
        const result = await press(target.channelId, target.messageId, target.customId);
        if (result.error) return fail(result.error);
        ctx.lastMessageId = target.messageId;
        ctx.presses++;
        await settled(conn, target, before, newestBefore);
      }
    }
    after?.();
    useRunner.getState().set({ running: null, step: 0, total: 0, label: "" });
    return true;
  };
}

/** A message's enabled button whose id (without the faction lock) passes `test`. */
export function buttonOn(m: Message | undefined, test: (id: string, c: Choice) => boolean): Choice | undefined {
  if (!m) return undefined;
  return choicesOf(m).find((c) => c.kind === "button" && !c.disabled && !!c.customId && test(baseId(c.customId), c));
}

/** The newest bot message in a channel, newer than `afterId`, with a button passing `test`. */
export function newestPrompt(state: PlayStore, channelId: string, afterId: string, test: (id: string, c: Choice) => boolean) {
  const data = state.messages[channelId];
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const id = data.ids[i];
    if (compareSnowflakes(id, afterId) <= 0) return undefined;
    const m = data.byId[id];
    if (m?.author.bot && buttonOn(m, test)) return m;
  }
  return undefined;
}

/** A step pressing a button of one known message, picked by id at press time. */
export function pressOn(channelId: string, messageId: string, label: string, test: (id: string) => boolean, extra?: Partial<PlanStep>): PlanStep {
  return {
    label,
    find: (s) => {
      const c = buttonOn(s.messages[channelId]?.byId[messageId], test);
      return c?.customId ? { channelId, messageId, customId: c.customId } : null;
    },
    ...extra,
  };
}

/** `n` presses of the same button of one message ("Gain 1 commodity" ×3). */
export function pressTimes(channelId: string, messageId: string, label: (i: number) => string, test: (id: string) => boolean, n: number): PlanStep[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => pressOn(channelId, messageId, label(i), test));
}

/** A step pressing a button of the prompt the bot posts in answer to the previous press (waits for it). */
export function pressNext(channelId: string, label: string, test: (id: string) => boolean, extra?: Partial<PlanStep>): PlanStep {
  return {
    label,
    waitMs: 15_000,
    find: (s, ctx) => {
      const m = newestPrompt(s, channelId, ctx.lastMessageId, test);
      const c = buttonOn(m, test);
      return m && c?.customId ? { channelId, messageId: m.id, customId: c.customId } : null;
    },
    ...extra,
  };
}
