// src/lib/psyLive4/scheduler.ts
// The ONLY setInterval in PSY4. Mirrors psyforge-pro.html lines 307-318.
//
// ARCHITECTURAL INVARIANT (the fix for "engine stops after a few minutes"):
//
//   `lastComposedUntil` is monotonic and only ever advances to `now + LOOKAHEAD_S`.
//   If `now` jumps forward (tab return after background), `lastComposedUntil`
//   is NOT caught up — events for [old lastComposedUntil, now] are simply
//   never composed. There is no "missed time" to recover from.
//
// Combined with `ctx.suspend()` on `visibilitychange→hidden` (which freezes
// `ctx.currentTime`), there is no scenario where the scheduler wakes up
// "behind" the audio clock. The bar-index drift that caused voice-pool
// exhaustion in the old psyLive.ts is structurally impossible here.

export interface SchedulerHost {
  readonly ctx: AudioContext;
  /** Compose events for [windowStart, windowEnd) and route to devices. */
  compose(windowStart: number, windowEnd: number): void;
  /** Whether playback is active (Play pressed, not stopped). */
  isRunning(): boolean;
}

const TICK_MS = 25;        // wake interval (matches psyforge-pro.html)
const LOOKAHEAD_S = 0.120; // compose this far ahead of ctx.currentTime
const SKIP_S = 0.020;      // never compose events < 20ms in the future (latency safety)

export class CompositionScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastComposedUntil = 0;     // monotonic — see invariant above
  private lastFireMs = 0;            // for heartbeat diagnostics
  private host: SchedulerHost;

  constructor(host: SchedulerHost) {
    this.host = host;
  }

  start(): void {
    if (this.timer) return;
    // Anchor: everything from "now + SKIP_S" forward.
    this.lastComposedUntil = this.host.ctx.currentTime + SKIP_S;
    this.lastFireMs = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastComposedUntil = 0;
  }

  /**
   * Called by the visibilitychange handler when the tab comes back.
   * After ctx.resume(), currentTime has not jumped (it was frozen during
   * suspend). But to be safe, snap forward if any drift accumulated.
   */
  reanchorAfterBackground(): void {
    const now = this.host.ctx.currentTime;
    if (this.lastComposedUntil < now) {
      // We were suspended; there is no "missed" audio. Skip ahead.
      this.lastComposedUntil = now + SKIP_S;
    }
  }

  private tick(): void {
    if (!this.host.isRunning()) return;
    this.lastFireMs = Date.now();
    const now = this.host.ctx.currentTime;
    const windowEnd = now + LOOKAHEAD_S;
    if (this.lastComposedUntil >= windowEnd) return; // already covered

    const windowStart = Math.max(this.lastComposedUntil, now + SKIP_S);
    if (windowStart >= windowEnd) return;
    this.host.compose(windowStart, windowEnd);
    // Monotonic: NEVER set lastComposedUntil below windowEnd.
    this.lastComposedUntil = windowEnd;
  }

  // ── Diagnostics (used by tests + UI status strip) ──────────────────────
  get staleMs(): number {
    return Date.now() - this.lastFireMs;
  }

  get composedUntil(): number {
    return this.lastComposedUntil;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }
}
