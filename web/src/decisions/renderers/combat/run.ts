import { create } from "zustand";
import { usePlayConnection, type Message } from "@/discord";
import { compareSnowflakes } from "@/discord/shared/snowflake";
import { usePressButton } from "@/play/usePressButton";
import { choicesOf, baseId } from "../../model/controls";

type RunState = {
  /** Key of the flow being pressed (one at a time). */
  running: string | null;
  step: number;
  total: number;
  label: string;
  error: string | null;
  startedAt: number;
  set: (s: Partial<RunState>) => void;
};

/** Progress of a multi-press flow, kept outside the popup: the popup remounts as presses retire prompts. */
export const useCombatRun = create<RunState>((set) => ({
  running: null,
  step: 0,
  total: 0,
  label: "",
  error: null,
  startedAt: 0,
  set: (s) => set(s),
}));

type Conn = ReturnType<typeof usePlayConnection>;

export type Target = { channelId: string; messageId: string };

/**
 * A flow: optionally press an opener that makes the bot post a fresh prompt (e.g. "Manually Assign Hits" posts the
 * per-unit buttons), then press `ids` on that prompt (or on `target`), each once the bot has applied the last, then
 * `finish` (its Done) if given.
 */
export type Flow = {
  key: string;
  opener?: Target & { customId: string; label: string };
  /** Recognises the prompt the opener makes the bot post. */
  isFollowUp?: (m: Message) => boolean;
  target?: Target;
  ids: { customId: string; label: string }[];
  finish?: (m: Message | undefined) => string | undefined;
};

function stamp(conn: Conn, t: Target) {
  const m = conn.store.getState().messages[t.channelId]?.byId[t.messageId];
  /* The bot's edit may only swap the buttons (no new edit time): count that as settled too. */
  return m ? `${m.edited_timestamp ?? m.timestamp}|${JSON.stringify(m.components ?? [])}|${m.content}` : "gone";
}

/** Resolves once `test` holds for the store (or after `ms`, with false). */
function waitFor(conn: Conn, test: () => boolean, ms: number) {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(ok);
    };
    const unsubscribe = conn.store.subscribe(() => test() && finish(true));
    const timer = setTimeout(() => finish(false), ms);
    if (test()) finish(true);
  });
}

/** The newest message in a channel posted after `afterId` that passes `test`. */
function newestAfter(conn: Conn, channelId: string, afterId: string, test: (m: Message) => boolean) {
  const data = conn.store.getState().messages[channelId];
  if (!data) return undefined;
  for (let i = data.ids.length - 1; i >= 0; i--) {
    const m = data.byId[data.ids[i]];
    if (!m || compareSnowflakes(m.id, afterId) <= 0) break;
    if (test(m)) return m;
  }
  return undefined;
}

function lastId(conn: Conn, channelId: string) {
  const ids = conn.store.getState().messages[channelId]?.ids ?? [];
  return ids[ids.length - 1] ?? "0";
}

/** Runs a {@link Flow}; progress and errors land in {@link useCombatRun}. */
export function useRunFlow() {
  const press = usePressButton();
  const conn = usePlayConnection();
  return async (flow: Flow) => {
    const run = useCombatRun.getState();
    if (run.running && Date.now() - run.startedAt < 60_000) {
      run.set({ error: `Still pressing “${run.label}” — try again in a moment.` });
      return false;
    }
    const total = flow.ids.length + (flow.opener ? 1 : 0) + (flow.finish ? 1 : 0);
    run.set({ running: flow.key, step: 0, total, label: "", error: null, startedAt: Date.now() });
    const fail = (error: string) => {
      useCombatRun.getState().set({ running: null, error });
      return false;
    };
    let step = 0;
    const tick = (label: string) => useCombatRun.getState().set({ step: ++step, label });

    let target = flow.target;
    if (flow.opener) {
      const o = flow.opener;
      tick(o.label);
      const before = lastId(conn, o.channelId);
      const result = await press(o.channelId, o.messageId, o.customId);
      if (result.error) return fail(result.error);
      let found: Message | undefined;
      await waitFor(conn, () => !!(found = newestAfter(conn, o.channelId, before, flow.isFollowUp ?? (() => true))), 10_000);
      if (!found) return fail("The game did not offer the unit buttons. Try again, or use the game's buttons under More options.");
      target = { channelId: o.channelId, messageId: found.id };
    }
    if (!target) return fail("Nothing to press.");
    const on: Target = target;
    for (const p of flow.ids) {
      tick(p.label);
      console.info("[combat] press", p.customId, "on", on.messageId);
      const before = stamp(conn, on);
      const result = await press(on.channelId, on.messageId, p.customId);
      if (result.error) return fail(result.error);
      /* The bot acknowledges before it has applied a press; the next one must wait for its edit or it can be lost. */
      await waitFor(conn, () => stamp(conn, on) !== before, 4000);
      await new Promise((r) => setTimeout(r, 150));
    }
    const m = conn.store.getState().messages[on.channelId]?.byId[on.messageId];
    const finishId = flow.finish?.(m);
    console.info("[combat] finish", finishId ?? "(none)", "on", on.messageId);
    if (finishId) {
      tick("Done");
      const result = await press(on.channelId, on.messageId, finishId);
      if (result.error) return fail(result.error);
    }
    useCombatRun.getState().set({ running: null, step: 0, total: 0, label: "" });
    return true;
  };
}

/** The Done button of a unit-pick prompt ("Done Removing/Sustaining Units"). */
export function doneOf(m: Message | undefined) {
  if (!m) return undefined;
  return choicesOf(m).find((c) => baseId(c.customId) === "deleteButtons")?.customId;
}
