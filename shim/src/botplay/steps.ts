import { baseId, lockIs, lockOf, snowflakeAfter, type Control, type Prompt } from "./prompts.js";
import type { Seat } from "./seat.js";

const sig = (p: Prompt) =>
  p.controls
    .map((c) => c.custom_id)
    .sort()
    .join("|");

/** Whether a prompt waits on this seat: only it sees it, its faction's buttons, it answers our press, or it pings us. */
export function promptForMe(seat: Seat, p: Prompt, faction: string) {
  const me = seat.userId;
  if (p.m._ephemeral_for) return p.m._ephemeral_for === me;
  if (p.controls.some((c) => lockIs(c.custom_id, faction))) return true;
  if (p.controls.some((c) => lockOf(c.custom_id) && !lockIs(c.custom_id, faction))) return false;
  // A ping names whose prompt it is; `_prompted_for` (who pressed last before the bot posted) can be someone else.
  const pings = [...String(p.m.content ?? "").matchAll(/<@!?(\d+)>/g)].map((x) => x[1]);
  if (pings.length) return pings.includes(me);
  if (p.m._prompted_for) return p.m._prompted_for === me;
  return false;
}

/** Finding prompts and pressing their controls for one multi-step job, without double presses. */
export class Steps {
  /** `${message id}:${custom id}` → the message's controls when pressed. */
  readonly pressed = new Map<string, string>();
  /** Messages the shim says no longer exist (a stale copy may linger in a remote view): never pressed again. */
  readonly gone = new Set<string>();
  lastPress = 0;

  constructor(
    readonly seat: Seat,
    readonly game: string,
    public since: string | undefined,
  ) {}

  /** The newest prompt for me (newer than `after`, default the job's start) with a control whose base id matches. */
  find(faction: string, match: (base: string, c: Control) => boolean, after?: string): { p: Prompt; c: Control } | null {
    const prompts = this.seat.prompts(this.game);
    for (let i = prompts.length - 1; i >= 0; i--) {
      const p = prompts[i];
      if (!snowflakeAfter(p.m.id, after ?? this.since)) break;
      if (this.gone.has(p.m.id) || !(promptForMe(this.seat, p, faction) || this.ours(p, faction))) continue;
      const c = p.controls.find((x) => (!lockOf(x.custom_id) || lockIs(x.custom_id, faction)) && match(baseId(x.custom_id), x));
      if (c) return { p, c };
    }
    return null;
  }

  /**
   * A prompt this job already pressed (and not locked to another faction) stays ours after the bot edits it: a bill
   * whose ping is gone after the first planet ("… exhausted the following: … WARNING: Have not spent enough"; posted
   * for a typed production answer, so no `_prompted_for`) was never found again (live pbd158: 4 production bills
   * stuck after one planet, the tactical action never concluded). Also a prompt that names only us (no ping).
   */
  private ours(p: Prompt, faction: string): boolean {
    if (p.controls.some((c) => lockOf(c.custom_id) && !lockIs(c.custom_id, faction))) return false;
    const prefix = `${p.m.id}:`;
    for (const k of this.pressed.keys()) if (k.startsWith(prefix)) return true;
    // Or it names only us, the bot's way ("<faction emoji>Bot Gamma 5 <colour emoji>**Black** …"), with no ping.
    const content = String(p.m.content ?? "");
    return !!this.seat.name && content.includes(`${this.seat.name} <:`) && !/<@!?\d+>/.test(content);
  }

  /** Presses unless we pressed this very control on this unchanged message moments ago (the bot has not answered). */
  async press(p: Prompt, c: Control, why: string, repeatable = false): Promise<boolean> {
    const key = `${p.m.id}:${c.custom_id}`;
    if (this.pressed.get(key) === sig(p) && Date.now() - this.lastPress < (repeatable ? 1500 : 8000)) return false;
    this.pressed.set(key, sig(p));
    this.lastPress = Date.now();
    const err = await this.seat.press(p, c, `plan: ${why}`);
    if (err) {
      this.seat.log(`plan step "${c.label}" failed: ${err}`);
      if (/no longer exists|is gone/i.test(err)) {
        this.gone.add(p.m.id);
        return false;
      }
    }
    return true;
  }

  wasPressed(p: Prompt, c: Control) {
    return this.pressed.has(`${p.m.id}:${c.custom_id}`);
  }
}
