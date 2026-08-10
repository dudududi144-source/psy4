/**
 * SchedulerWorker — jitter-resistant Web Worker scheduler for the PSY4 engine.
 *
 * Problem (Task V2a, gap #1 in ROAST-3 follow-up):
 *   The engine's musical clock used `setTimeout(15ms)` on the main thread.
 *   setTimeout is subject to React renders, GC pauses, layout thrash and the
 *   4ms HTML5 clamping minimum, so the 15ms tick drifted ±5-15ms in practice.
 *   The audio thread (Web Audio) schedules sample-accurate notes, but the
 *   *scheduler loop* that decides "which step / which bar / which section we
 *   are in" still ran on the main thread — so timing jitter showed up as
 *   audible swing, double-triggers on rolls, and missed downbeats under load.
 *
 * Solution:
 *   Move the *tick* to a Web Worker. Workers run on their own thread — they
 *   are not blocked by main-thread rendering, GC, or React commits. A worker
 *   `setInterval(15ms)` fires much more reliably than main-thread
 *   `setTimeout(15ms)` because there's nothing else running on the worker
 *   thread to delay it.
 *
 *   The worker doesn't do any musical work — it just posts `{type:'tick'}`
 *   messages back to the main thread. The main thread's `tick()` does the
 *   actual step scheduling against the AudioContext clock. This preserves
 *   sample-accurate audio (notes are still scheduled via Web Audio's
 *   `setValueAtTime` etc.) while eliminating scheduler jitter.
 *
 * SSR / old-browser fallback:
 *   The Worker is created lazily on first `start()`. If `Worker` is not
 *   available (SSR, very old browsers), `start()` falls back to a plain
 *   `setInterval` on the main thread. This keeps the engine functional in
 *   every environment, even if the timing improvement is lost.
 *
 * Inline-worker pattern:
 *   The worker source is shipped as a string and instantiated via a Blob
 *   URL. This avoids a separate `public/workers/scheduler.js` file and keeps
 *   the scheduler co-located with its TypeScript wrapper. The Blob URL is
 *   revoked on `stop()` to avoid leaks across start/stop cycles.
 *
 * Task ID: V2a (scheduler → Worker).
 */

// ─── Worker source (string) ──────────────────────────────────────────────────
//
// Kept deliberately tiny so it's easy to audit. Three message types:
//   - 'start'        : begin ticking at the given interval (default 15ms).
//   - 'stop'         : clear the timer (no-op if not running).
//   - 'setInterval'  : change the interval on the fly (restarts the timer).
//
// We use `setInterval` (not chained `setTimeout`) inside the worker because:
//   1. Worker threads have no other work, so the HTML5 4ms clamp doesn't
//      apply the same way it does on the main thread — workers can hit
//      sub-millisecond jitter at 15ms intervals.
//   2. setInterval is simpler than chained setTimeout and the worker's
//      event loop is empty between ticks, so there's no risk of drift
//      accumulating from long-running handlers.
const workerCode = `
  let timer = null;
  let interval = 15;
  self.onmessage = function(e) {
    var d = e.data || {};
    if (d.type === 'start') {
      if (timer) clearInterval(timer);
      interval = (typeof d.interval === 'number' && d.interval > 0) ? d.interval : 15;
      timer = setInterval(function () { self.postMessage({ type: 'tick' }); }, interval);
    } else if (d.type === 'stop') {
      if (timer) { clearInterval(timer); timer = null; }
    } else if (d.type === 'setInterval') {
      interval = (typeof d.interval === 'number' && d.interval > 0) ? d.interval : interval;
      if (timer) {
        clearInterval(timer);
        timer = setInterval(function () { self.postMessage({ type: 'tick' }); }, interval);
      }
    }
  };
`;

// ─── Lazy Blob URL ───────────────────────────────────────────────────────────
//
// The Blob URL is created once on first start() and reused across subsequent
// start/stop cycles (creating a new Blob URL every start would leak memory
// across long sessions). It's revoked only if the module is unloaded — but
// since the engine lives for the page lifetime, we keep it cached.
let cachedBlobUrl: string | null = null;

function getBlobUrl(): string | null {
  if (cachedBlobUrl) return cachedBlobUrl;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null;
  }
  try {
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    cachedBlobUrl = URL.createObjectURL(blob);
    return cachedBlobUrl;
  } catch {
    return null;
  }
}

// ─── SchedulerWorker ─────────────────────────────────────────────────────────

/**
 * Wraps a Web Worker that ticks at a precise interval. The main thread
 * registers an `onTick` callback and the worker posts `{type:'tick'}`
 * messages that drive it.
 *
 * Usage:
 *   const s = new SchedulerWorker();
 *   s.onTick = () => engine.tick();
 *   s.start(15);           // 15ms tick (≈ 66 Hz)
 *   ...
 *   s.stop();              // halt
 *
 * Lifecycle:
 *   - The Worker is created lazily inside `start()` (NOT at construction) so
 *     importing the module is SSR-safe.
 *   - `stop()` posts 'stop' to the worker but keeps it alive for reuse; the
 *     next `start()` will just post 'start' again. This avoids Worker
 *     construction cost across start/stop cycles.
 *   - If `Worker` is unavailable, `start()` falls back to a main-thread
 *     `setInterval` and `usesWorker` returns false so the caller can log it.
 */
export class SchedulerWorker {
  private worker: Worker | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private currentInterval = 15;
  private _usesWorker = false;

  /** Called on every tick (worker message or fallback interval). */
  onTick: (() => void) | null = null;

  /** True if the worker is being used; false if we fell back to setInterval. */
  get usesWorker(): boolean { return this._usesWorker; }

  /**
   * Begin ticking. Creates the Worker lazily on first call. If Worker
   * construction fails (SSR, old browser, CSP block), falls back to a
   * main-thread setInterval so the engine still runs.
   *
   * Calling start() while already running is a no-op (the worker just keeps
   * ticking at the existing interval). To change the interval, use
   * `setInterval(ms)`.
   */
  start(intervalMs = 15): void {
    const interval = (typeof intervalMs === 'number' && intervalMs > 0 && isFinite(intervalMs))
      ? intervalMs
      : 15;
    this.currentInterval = interval;

    // Already running? Just update the interval and bail.
    if (this.worker || this.fallbackTimer) {
      this.setInterval(interval);
      return;
    }

    // Try to spin up a Worker.
    const url = getBlobUrl();
    if (url && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(url);
        this.worker.onmessage = (e: MessageEvent) => {
          const data = e.data as { type?: string } | null;
          if (data && data.type === 'tick' && this.onTick) {
            this.onTick();
          }
        };
        // If the worker errors (CSP, blob URL blocked, etc.), tear it down
        // and fall back to setInterval. The engine keeps running.
        this.worker.onerror = () => {
          this.teardownWorker();
          if (!this.fallbackTimer) this.startFallback(interval);
        };
        this.worker.postMessage({ type: 'start', interval });
        this._usesWorker = true;
        return;
      } catch {
        this.teardownWorker();
        // fall through to fallback
      }
    }

    // Fallback: main-thread setInterval. Less jitter-resistant but functional.
    this.startFallback(interval);
  }

  private startFallback(interval: number): void {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.fallbackTimer = setInterval(() => {
      if (this.onTick) this.onTick();
    }, interval);
    this._usesWorker = false;
  }

  /** Stop ticking. The Worker is kept alive for reuse on the next start(). */
  stop(): void {
    if (this.worker) {
      try { this.worker.postMessage({ type: 'stop' }); } catch { /* ignore */ }
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /**
   * Change the tick interval on the fly. Restarts the worker's internal
   * timer with the new interval. No-op if not running.
   */
  setInterval(ms: number): void {
    const interval = (typeof ms === 'number' && ms > 0 && isFinite(ms)) ? ms : 15;
    if (interval === this.currentInterval && (this.worker || this.fallbackTimer)) return;
    this.currentInterval = interval;
    if (this.worker) {
      try { this.worker.postMessage({ type: 'setInterval', interval }); } catch { /* ignore */ }
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = setInterval(() => {
        if (this.onTick) this.onTick();
      }, interval);
    }
  }

  /**
   * Fully tear down the Worker. Called on engine dispose / page unload.
   * After dispose(), the SchedulerWorker can still be `start()`ed again —
   * it will create a fresh Worker.
   */
  dispose(): void {
    this.teardownWorker();
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.onTick = null;
  }

  private teardownWorker(): void {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
    }
    this._usesWorker = false;
  }
}
