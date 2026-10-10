import { baseId, lockOf, snowflakeAfter, type Control, type Prompt } from "./prompts.js";
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
  if (p.controls.some((c) => lockOf(c.custom_id) === faction)) return true;
  if (p.controls.some((c) => lockOf(c.custom_id) && lockOf(c.custom_id) !== faction)) return false;
  if (p.m._prompted_for) return p.m._prompted_for === me;
  return String(p.m.content ?? "").includes(`<@${me}>`);
}

/** Finding prompts and pressing their controls for one multi-step job, without double presses. */
export class Steps {
  /** `${message id}:${custom id}` → the message's controls when pressed. */
  readonly pressed = new Map<string, string>();
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
      if (!promptForMe(this.seat, p, faction)) continue;
      const c = p.controls.find((x) => (!lockOf(x.custom_id) || lockOf(x.custom_id) === faction) && match(baseId(x.custom_id), x));
      if (c) return { p, c };
    }
    return null;
  }

  /** Presses unless we pressed this very control on this unchanged message moments ago (the bot has not answered). */
  async press(p: Prompt, c: Control, why: string, repeatable = false): Promise<boolean> {
    const key = `${p.m.id}:${c.custom_id}`;
    if (this.pressed.get(key) === sig(p) && Date.now() - this.lastPress < (repeatable ? 1500 : 8000)) return false;
    this.pressed.set(key, sig(p));
    this.lastPress = Date.now();
    const err = await this.seat.press(p, c, `plan: ${why}`);
    if (err) this.seat.log(`plan step "${c.label}" failed: ${err}`);
    return true;
  }

  wasPressed(p: Prompt, c: Control) {
    return this.pressed.has(`${p.m.id}:${c.custom_id}`);
  }
}
