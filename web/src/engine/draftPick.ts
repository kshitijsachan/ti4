import { useCallback } from "react";
import type { Decision } from "./contract";
import { useEngineAnswer } from "./link";
import { engineStore } from "./store";

/** How long the draft board waits for the engine's verdict on a pick before giving up on it. */
const VERDICT_MS = 20000;

/** `milty_<category>_<pick>` → its engine option value. */
function parsePick(customId: string): { category: string; pick: string } | null {
  const m = /^milty_([a-z]+)_(.+)$/.exec(customId);
  return m ? { category: m[1], pick: m[2] } : null;
}

/** The open `draft.milty.pick` decision that offers this board button, and the option for it. */
export function findDraftOption(decisions: Record<string, Decision>, customId: string) {
  const wanted = parsePick(customId);
  for (const d of Object.values(decisions)) {
    if (d.kind !== "draft.milty.pick") continue;
    const option =
      d.options.find((o) => o.id === customId || o.handler === customId) ??
      (wanted
        ? d.options.find((o) => {
            const v = o.value as { category?: unknown; pick?: unknown } | undefined;
            return v?.category === wanted.category && String(v?.pick) === wanted.pick;
          })
        : undefined);
    if (option) return { decision: d, option };
  }
  return null;
}

/**
 * The draft board's picks answered through the engine (typed `draft.milty.pick`) instead of pressing the bot's
 * button: resolves with `{error}` when the engine refuses it, or `{}` once it is accepted.
 */
export function useEngineDraftPick() {
  const answer = useEngineAnswer();
  return useCallback(
    (customId: string): Promise<{ error?: string }> => {
      const found = findDraftOption(engineStore.getState().view.decisions, customId);
      if (!found) return Promise.resolve({ error: "That pick is not open right now — wait for your turn." });
      if (found.option.disabled) return Promise.resolve({ error: "That pick is not available." });
      const id = found.decision.id;
      answer(found.decision, found.option.id);
      return new Promise((resolve) => {
        let done = false;
        const finish = (r: { error?: string }) => {
          if (done) return;
          done = true;
          off();
          window.clearTimeout(timer);
          resolve(r);
        };
        const check = () => {
          const v = engineStore.getState().view;
          if (v.errors[id]) return finish({ error: v.errors[id] });
          if (!v.pending[id] || !v.decisions[id]) finish({});
        };
        const off = engineStore.subscribe(check);
        const timer = window.setTimeout(() => finish({ error: "No response from the game server." }), VERDICT_MS);
        check();
      });
    },
    [answer],
  );
}
