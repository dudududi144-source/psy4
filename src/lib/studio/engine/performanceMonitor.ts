/**
 * PerformanceMonitor — adaptive quality scaling for the PSY4 engine.
 *
 * ── P1 ADAPTIVE QUALITY (Task P1) ────────────────────────────────────────────
 * The engine's node count (lazy allocation + reduced pools) brings the typical
 * count well under the browser's ~300-node "smooth" ceiling. On weak devices
 * (4 cores / 4 GB RAM, cheap smartphones) we still need a fallback that
 * scales the *active* node count down further when the audio thread is
 * struggling, and back up when headroom returns.
 *
 * This monitor watches two signals:
 *   1. Main-thread frame time via requestAnimationFrame (a proxy for the
 *      browser's overall rendering + JS load — when this is high, React
 *      renders, GC, layout, and the scheduler's main-thread work are
 *      competing for time).
 *   2. Engine tick duration via `reportTickDuration()` — the engine calls
 *      this after each `tick()` so we know how long the scheduling +
 *      AudioParam automation took. A tick over 5ms means the audio thread
 *      is likely to underrun (a typical audio quantum is 128 frames =
 *      ~2.9ms at 44.1kHz).
 *
 * Hysteresis:
 *   - When overloaded for 3+ seconds: drop quality one step (high → medium
 *     → low).
 *   - When stable for 10+ seconds: raise quality one step (low → medium
 *     → high).
 *
 * The user can override via `setQuality()` — adaptive scaling then pauses
 * until the user re-enables it via `setAdaptiveEnabled(true)`. This matches
 * the spec: "User can override via UI."
 *
 * Auto-detect on start: if `navigator.hardwareConcurrency < 4` or
 * `navigator.deviceMemory < 4`, start at 'low'. Otherwise 'medium'.
 *
 * NO ScriptProcessorNode. NO per-block allocation. The ring buffer is fixed
 * size (60 samples = ~1 second at 60fps) and reused.
 */

export type QualityLevel = 'low' | 'medium' | 'high';

export interface PerformanceStatus {
  /** 0..1 estimated CPU load (avgFrameMs / 16.67, clamped). */
  cpuLoad: number;
  /** Cumulative count of detected audio-thread dropouts since start(). */
  dropouts: number;
  /** Current quality level (low/medium/high). */
  quality: QualityLevel;
  /** Whether adaptive scaling is enabled (the user can disable it). */
  adaptiveEnabled: boolean;
  /** Recent average main-thread frame time (ms). */
  avgFrameMs: number;
  /** Recent max main-thread frame time (ms). */
  maxFrameMs: number;
  /** Recent average engine tick duration (ms). */
  avgTickMs: number;
  /** Milliseconds the engine has been continuously overloaded (0 if stable). */
  overloadedMs: number;
  /** Milliseconds the engine has been continuously stable (0 if overloaded). */
  stableMs: number;
  /** Suggested reason for the current quality level (for UI display). */
  reason: string;
}

const FRAME_BUFFER_SIZE = 60; // ~1 second at 60fps
const TICK_BUFFER_SIZE = 60;  // ~60 ticks at 15ms = ~1 second
const OVERLOAD_THRESHOLD_MS = 25; // avg frame > 25ms = overloaded
const STABLE_THRESHOLD_MS = 18;   // avg frame < 18ms = stable
const TICK_OVERLOAD_MS = 5;       // tick > 5ms = audio thread at risk
const OVERLOAD_DROP_DELAY_MS = 3000; // 3s of overload → drop quality
const STABLE_RAISE_DELAY_MS = 10000; // 10s of stability → raise quality

const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);

export class PerformanceMonitor {
  private rafHandle: number | null = null;
  private lastFrameTime = 0;
  private frameTimes: number[] = [];
  private tickTimes: number[] = [];
  private dropouts = 0;
  private overloadedSince = 0;  // performance.now() when overload started (0 = not overloaded)
  private stableSince = 0;      // performance.now() when stability started (0 = unstable)
  private quality: QualityLevel = 'medium';
  private adaptiveEnabled = true;
  private onQualityChangeCb?: (q: QualityLevel, reason: string) => void;
  private lastReason = 'initial';

  constructor(opts?: { onQualityChange?: (q: QualityLevel, reason: string) => void }) {
    this.onQualityChangeCb = opts?.onQualityChange;
  }

  /**
   * Start monitoring. Idempotent — safe to call multiple times. SSR-safe
   * (no-ops if requestAnimationFrame is unavailable).
   */
  start(): void {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    if (this.rafHandle !== null) return;
    this.lastFrameTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.rafLoop);
  }

  /** Stop monitoring. Idempotent. */
  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  /**
   * Called by the engine after each tick() — `durationMs` is how long the
   * scheduling pass took. A tick over TICK_OVERLOAD_MS (5ms) is a strong
   * signal that the audio thread is at risk of underrunning.
   */
  reportTickDuration(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.tickTimes.push(durationMs);
    if (this.tickTimes.length > TICK_BUFFER_SIZE) this.tickTimes.shift();
    if (durationMs > TICK_OVERLOAD_MS) {
      this.dropouts++;
      if (this.overloadedSince === 0) this.overloadedSince = performance.now();
      this.stableSince = 0;
    }
  }

  /** Manually set the quality level. Disables adaptive scaling. */
  setQuality(q: QualityLevel, reason = 'user override'): void {
    if (this.quality === q && this.lastReason === reason) return;
    this.quality = q;
    this.lastReason = reason;
    // User override pauses adaptive scaling until they re-enable it.
    this.adaptiveEnabled = false;
    this.onQualityChangeCb?.(q, reason);
  }

  /** Enable / disable adaptive scaling. */
  setAdaptiveEnabled(enabled: boolean): void {
    this.adaptiveEnabled = enabled;
    if (enabled) {
      // Reset hysteresis timers so adaptive logic evaluates fresh.
      this.overloadedSince = 0;
      this.stableSince = performance.now();
    }
  }

  /** Returns true if adaptive scaling is currently enabled. */
  isAdaptiveEnabled(): boolean { return this.adaptiveEnabled; }

  /** Current quality level. */
  getQuality(): QualityLevel { return this.quality; }

  /**
   * Auto-detect the initial quality level from device capabilities.
   * Called by the engine on start(). Returns 'low' for weak devices
   * (< 4 cores OR < 4 GB RAM), 'medium' otherwise.
   */
  autoDetectInitial(): QualityLevel {
    if (typeof navigator === 'undefined') return 'medium';
    const cores = (navigator as unknown as { hardwareConcurrency?: number }).hardwareConcurrency ?? 4;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
    if (cores < 4 || mem < 4) return 'low';
    // Mobile UA hint — phones are weaker than their core count suggests
    // because of thermal throttling and lower single-core perf.
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/Mobi|Android|iPhone|iPad/.test(ua)) return 'low';
    return 'medium';
  }

  /** Snapshot for UI display. */
  getStatus(): PerformanceStatus {
    const avgFrame = this.avg(this.frameTimes);
    const maxFrame = this.frameTimes.length > 0 ? Math.max(...this.frameTimes) : 0;
    const avgTick = this.avg(this.tickTimes);
    const now = performance.now();
    return {
      cpuLoad: clamp(avgFrame / 16.67, 0, 1),
      dropouts: this.dropouts,
      quality: this.quality,
      adaptiveEnabled: this.adaptiveEnabled,
      avgFrameMs: avgFrame,
      maxFrameMs: maxFrame,
      avgTickMs: avgTick,
      overloadedMs: this.overloadedSince ? now - this.overloadedSince : 0,
      stableMs: this.stableSince ? now - this.stableSince : 0,
      reason: this.lastReason,
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private avg(arr: number[]): number {
    if (arr.length === 0) return 0;
    let sum = 0;
    for (const v of arr) sum += v;
    return sum / arr.length;
  }

  private rafLoop = (): void => {
    const now = performance.now();
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;
    // Clamp to filter out tab-backgrounded huge deltas (which would skew the
    // average unfairly — when the tab is backgrounded, rAF pauses).
    if (dt < 1000) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length > FRAME_BUFFER_SIZE) this.frameTimes.shift();
    }

    if (this.adaptiveEnabled) {
      this.evaluateAdaptive(now);
    }

    this.rafHandle = requestAnimationFrame(this.rafLoop);
  };

  private evaluateAdaptive(now: number): void {
    const avgFrame = this.avg(this.frameTimes);
    const avgTick = this.avg(this.tickTimes);
    // Overload condition: avg frame > 25ms OR avg tick > 5ms.
    const overloaded = avgFrame > OVERLOAD_THRESHOLD_MS || avgTick > TICK_OVERLOAD_MS;

    if (overloaded) {
      if (this.overloadedSince === 0) this.overloadedSince = now;
      this.stableSince = 0;
      const dur = now - this.overloadedSince;
      if (dur > OVERLOAD_DROP_DELAY_MS && this.quality !== 'low') {
        const newQ: QualityLevel = this.quality === 'high' ? 'medium' : 'low';
        const reason = `overload ${(dur / 1000).toFixed(1)}s (avg frame ${avgFrame.toFixed(1)}ms, tick ${avgTick.toFixed(1)}ms)`;
        this.applyAdaptiveQuality(newQ, reason);
      }
    } else if (avgFrame < STABLE_THRESHOLD_MS) {
      if (this.stableSince === 0) this.stableSince = now;
      this.overloadedSince = 0;
      const dur = now - this.stableSince;
      if (dur > STABLE_RAISE_DELAY_MS && this.quality !== 'high') {
        const newQ: QualityLevel = this.quality === 'low' ? 'medium' : 'high';
        const reason = `stable ${(dur / 1000).toFixed(1)}s (avg frame ${avgFrame.toFixed(1)}ms)`;
        this.applyAdaptiveQuality(newQ, reason);
      }
    }
    // Hysteresis gap between 18ms and 25ms: no transition triggered.
    // This prevents thrashing when frame times hover near the threshold.
  }

  private applyAdaptiveQuality(q: QualityLevel, reason: string): void {
    if (this.quality === q) return;
    this.quality = q;
    this.lastReason = reason;
    // Reset timers so the next transition needs another full delay window.
    this.overloadedSince = 0;
    this.stableSince = performance.now();
    this.onQualityChangeCb?.(q, reason);
  }
}
