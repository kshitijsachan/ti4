import { loadavg } from "node:os";
import { log } from "./log.js";

/**
 * Event-loop lag monitor: the shim is one thread, so a long synchronous stretch (a scan over every game, a big save)
 * holds up every HTTP request, the bot's REST calls and the watchdog's /healthz. When a tick of LAG_TICK_MS arrives
 * more than LAG_WARN_MS late, it logs a WARN naming what ran meanwhile:
 *  - `sync`: instrumented synchronous work (syncSpan / Slicer) that took > SLOW_SLICE_MS in the window, slowest first;
 *  - `open`: async activities still in progress (activity()), oldest first;
 *  - `cpu`: the shim's own CPU time over the window's wall time. Near 100% = the shim itself was busy; far below =
 *    it was starved (host CPU contention: see `load`) or stopped (GC pauses show as heap growth).
 */
const LAG_TICK_MS = 250;
const LAG_WARN_MS = Number(process.env.SHIM_LAG_WARN_MS ?? 1000);
const SLOW_SLICE_MS = 50;

type Span = { label: string; start: number; ms: number };
const slow: Span[] = [];
const open = new Map<number, { label: string; start: number }>();
let nextId = 0;

function record(label: string, start: number, ms: number) {
  if (ms < SLOW_SLICE_MS) return;
  slow.push({ label, start, ms });
  if (slow.length > 300) slow.splice(0, slow.length - 300);
}

/** Marks an async activity as in progress (shown under `open` while it lasts); call the returned function when done. */
export function activity(label: string): () => void {
  const id = ++nextId;
  open.set(id, { label, start: performance.now() });
  if (open.size > 5000) open.delete(open.keys().next().value!);
  return () => {
    open.delete(id);
  };
}

/** Runs synchronous work, recording it when it takes longer than SLOW_SLICE_MS. */
export function syncSpan<T>(label: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(label, start, performance.now() - start);
  }
}

/**
 * For long loops in async code whose iterations rarely really await (an `await` on an already-settled promise does not
 * let timers or I/O run): `await slicer.tick()` in the loop yields to the event loop once the current slice has run
 * for `budgetMs`, and records the slices. `busyMs` is the loop's total synchronous time so far.
 */
export class Slicer {
  busyMs = 0;
  private start = performance.now();
  constructor(
    readonly label: string,
    private budgetMs = 20,
  ) {}

  async tick() {
    const now = performance.now();
    if (now - this.start < this.budgetMs) return;
    this.close(now);
    await new Promise((r) => setImmediate(r));
    this.start = performance.now();
  }

  /** Ends the current slice (call when the loop is done); returns busyMs. */
  done() {
    this.close(performance.now());
    this.start = Number.POSITIVE_INFINITY;
    return this.busyMs;
  }

  private close(now: number) {
    if (!Number.isFinite(this.start)) return;
    const ms = now - this.start;
    this.busyMs += ms;
    record(this.label, this.start, ms);
  }
}

function summarize(spans: Span[]) {
  const by = new Map<string, { n: number; ms: number; max: number }>();
  for (const s of spans) {
    const e = by.get(s.label) ?? { n: 0, ms: 0, max: 0 };
    e.n++;
    e.ms += s.ms;
    e.max = Math.max(e.max, s.ms);
    by.set(s.label, e);
  }
  return [...by]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 8)
    .map(([label, e]) => `${label} ${Math.round(e.ms)}ms${e.n > 1 ? ` (${e.n}x, max ${Math.round(e.max)}ms)` : ""}`);
}

/** Starts the monitor (once per process). */
export function startLagMonitor() {
  let last = performance.now();
  let lastCpu = process.cpuUsage();
  let lastHeap = process.memoryUsage().heapUsed;
  // Worst lag per minute, logged once a minute when it was notable but below the WARN threshold.
  let worst = 0;
  let worstAt = Date.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - last - LAG_TICK_MS;
    const cpu = process.cpuUsage();
    const heap = process.memoryUsage().heapUsed;
    if (lag > LAG_WARN_MS) {
      const wall = now - last;
      const cpuMs = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000;
      const from = last;
      const sync = summarize(slow.filter((s) => s.start + s.ms >= from));
      const oldest = [...open.values()]
        .sort((a, b) => a.start - b.start)
        .slice(0, 6)
        .map((o) => `${o.label} (${Math.round((now - o.start) / 1000)}s)`);
      log.warn(
        `event loop blocked ${Math.round(lag)}ms; cpu ${Math.round((100 * cpuMs) / wall)}% of it; load ${loadavg()
          .map((x) => x.toFixed(1))
          .join(" ")}; heap ${Math.round(lastHeap / 1048576)}->${Math.round(heap / 1048576)}MB; sync: ${sync.join("; ") || "nothing instrumented"}; open: ${oldest.join("; ") || "none"}`,
      );
    } else if (lag > worst) worst = lag;
    if (Date.now() - worstAt >= 60_000) {
      if (worst > 300) log.info(`event loop: worst lag ${Math.round(worst)}ms in the last minute`);
      worst = 0;
      worstAt = Date.now();
    }
    last = now;
    lastCpu = cpu;
    lastHeap = heap;
  }, LAG_TICK_MS);
  timer.unref();
}
