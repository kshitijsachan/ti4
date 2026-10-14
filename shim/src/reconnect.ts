import { log } from "./log.js";

/**
 * After the bot's gateway (re)connects — a resumed session after a stall or a shim restart, or a fresh identify —
 * ask the bot to re-post, in every live game, the waiting player's prompt (turn menu / strategy-card pick / agenda
 * vote) when no open decision offers it (bot PromptRecovery, POST /api/public/selfhost/engine/recover-all). Posts the
 * bot made while the shim was frozen or down may never have landed (soak pbd1204: the next player's turn prompt was
 * lost and the game idled 30 min). Retried while the bot is not ready (503) or unreachable.
 */
export class ReconnectRecovery {
  private timer: NodeJS.Timeout | null = null;
  private wasReady = false;

  constructor(
    private botApi: string,
    private botToken: () => string,
    private opts: { delayMs?: number; retryMs?: number; attempts?: number; fetch?: typeof fetch } = {},
  ) {}

  /** Wire to Gateway.onStatusChange. */
  onStatus(ready: boolean) {
    const rising = ready && !this.wasReady;
    this.wasReady = ready;
    if (!rising) {
      if (!ready && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }
    this.schedule(this.opts.delayMs ?? 20_000, this.opts.attempts ?? 10);
  }

  private schedule(ms: number, attemptsLeft: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(attemptsLeft);
    }, ms);
    this.timer.unref?.();
  }

  /** One call; on 503 / network error, again after retryMs (while attempts remain and the bot stays connected). */
  async run(attemptsLeft: number): Promise<Record<string, string> | null> {
    const f = this.opts.fetch ?? fetch;
    try {
      const res = await f(`${this.botApi}/api/public/selfhost/engine/recover-all?reason=gateway-reconnect`, {
        method: "POST",
        headers: { authorization: `Bot ${this.botToken()}` },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { recovered?: Record<string, string> };
        const rec = body.recovered ?? {};
        const n = Object.keys(rec).length;
        if (n) log.warn(`reconnect recovery: the bot re-posted ${n} missing prompt(s): ${JSON.stringify(rec)}`);
        else log.info("reconnect recovery: no missing prompts");
        return rec;
      }
      if (res.status !== 503) {
        log.warn(`reconnect recovery: bot answered ${res.status}`);
        return null;
      }
    } catch (e) {
      log.info(`reconnect recovery: bot not reachable (${e})`);
    }
    if (attemptsLeft > 1 && this.wasReady) this.schedule(this.opts.retryMs ?? 15_000, attemptsLeft - 1);
    return null;
  }
}
