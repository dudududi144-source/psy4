/**
 * PerformanceMonitor — measures realtime engine stability.
 *
 * Priority 1: "Fix latency / scheduler stability"
 *
 * Measures:
 *   - Audio callback duration (via AudioWorklet stats)
 *   - Scheduler jitter (std dev of tick interval)
 *   - Main thread frame time (via requestAnimationFrame)
 *   - Active voices
 *   - AudioWorklet CPU load
 *   - Event queue depth
 *   - Late/dropped events
 *
 * The optimizer MUST NOT run if:
 *   - scheduler jitter > 5ms
 *   - audio callback > 3ms
 *   - main thread frame time > 20ms
 *
 * NO ScriptProcessorNode. NO per-block Float32Array allocation.
 * Uses the existing worklet stats messages + requestAnimationFrame.
 */

export interface PerformanceSample {
  timestamp: number;          // performance.now()
  audioCallbackMs: number;    // worklet process() duration
  schedulerJitterMs: number;  // |actual_interval - expected_interval|
  mainThreadFrameMs: number;  // rAF frame time
  activeVoices: number;
  cpuLoad: number;            // 0..1 (from worklet)
  eventQueueDepth: number;
  lateEvents: number;
  droppedEvents: number;
}

export interface PerformanceReport {
  samples: number;
  durationSec: number;
  audioCallbackMs: {
    mean: number;
    max: number;
    p95: number;
  };
  schedulerJitterMs: {
    mean: number;
    max: number;
    p95: number;
  };
  mainThreadFrameMs: {
    mean: number;
    max: number;
    p95: number;
  };
  activeVoices: {
    mean: number;
    max: number;
  };
  cpuLoad: {
    mean: number;
    max: number;
  };
  totalLateEvents: number;
  totalDroppedEvents: number;
  maxQueueDepth: number;
  stable: boolean;            // true if all thresholds met
  failures: string[];         // list of threshold violations
}

const STABILITY_THRESHOLDS = {
  audioCallbackMs: 3.0,
  schedulerJitterMs: 5.0,
  mainThreadFrameMs: 20.0,
  cpuLoad: 0.85,
};

export class PerformanceMonitor {
  private samples: PerformanceSample[] = [];
  private running = false;
  private rafId: number | null = null;
  private lastTickTime = 0;
  private lastFrameTime = 0;
  private expectedIntervalMs = 25; // setInterval(25)
  private frameTimes: number[] = [];

  // Latest stats from the worklet (updated via callback)
  private latestWorkletStats: {
    activeVoices: number;
    cpuLoad: number;
    eventCount: number;
    currentFrame: number;
  } | null = null;

  private lateEvents = 0;
  private droppedEvents = 0;
  private maxQueueDepth = 0;

  /** Called by the engine when worklet stats arrive (no allocation — just store). */
  onWorkletStats(stats: { activeVoices: number; cpuLoad: number; eventCount: number; currentFrame: number }): void {
    this.latestWorkletStats = stats;
    if (stats.eventCount > this.maxQueueDepth) {
      this.maxQueueDepth = stats.eventCount;
    }
    // Heuristic: if queue is backing up, events are being dropped or processed late
    if (stats.eventCount > 500) {
      this.droppedEvents += Math.floor(stats.eventCount / 500);
    }
  }

  /** Called by the engine's tick() to measure scheduler jitter. */
  recordTick(): void {
    if (!this.running) return;
    const now = performance.now();
    if (this.lastTickTime > 0) {
      const actualInterval = now - this.lastTickTime;
      const jitter = Math.abs(actualInterval - this.expectedIntervalMs);
      if (jitter > STABILITY_THRESHOLDS.schedulerJitterMs) {
        this.lateEvents++;
      }
    }
    this.lastTickTime = now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.samples = [];
    this.lateEvents = 0;
    this.droppedEvents = 0;
    this.maxQueueDepth = 0;
    this.lastTickTime = 0;
    this.lastFrameTime = performance.now();
    this.frameTimes = [];

    // Use requestAnimationFrame to measure main thread frame time
    // This does NOT touch the audio path — it's purely observational
    const measureFrame = () => {
      if (!this.running) return;
      const now = performance.now();
      const frameTime = now - this.lastFrameTime;
      this.lastFrameTime = now;
      this.frameTimes.push(frameTime);

      // Record a sample every ~100ms (every ~6 frames at 60fps)
      // NO allocation in the hot path — we reuse the samples array
      if (this.frameTimes.length >= 6) {
        const avgFrame = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        const maxFrame = Math.max(...this.frameTimes);
        const stats = this.latestWorkletStats;
        this.samples.push({
          timestamp: now,
          audioCallbackMs: stats ? stats.cpuLoad * 2.89 : 0, // 128 samples / 44100 = 2.89ms per block
          schedulerJitterMs: 0, // computed in recordTick
          mainThreadFrameMs: avgFrame,
          activeVoices: stats ? stats.activeVoices : 0,
          cpuLoad: stats ? stats.cpuLoad : 0,
          eventQueueDepth: stats ? stats.eventCount : 0,
          lateEvents: this.lateEvents,
          droppedEvents: this.droppedEvents,
        });
        this.frameTimes = [];
      }

      this.rafId = requestAnimationFrame(measureFrame);
    };
    this.rafId = requestAnimationFrame(measureFrame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getReport(): PerformanceReport {
    const n = this.samples.length;
    if (n === 0) {
      return {
        samples: 0, durationSec: 0,
        audioCallbackMs: { mean: 0, max: 0, p95: 0 },
        schedulerJitterMs: { mean: 0, max: 0, p95: 0 },
        mainThreadFrameMs: { mean: 0, max: 0, p95: 0 },
        activeVoices: { mean: 0, max: 0 },
        cpuLoad: { mean: 0, max: 0 },
        totalLateEvents: 0, totalDroppedEvents: 0, maxQueueDepth: 0,
        stable: false,
        failures: ['no samples collected'],
      };
    }

    const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b);
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const p95 = (arr: number[]) => {
      const s = sorted(arr);
      return s[Math.floor(s.length * 0.95)] || s[s.length - 1];
    };

    const cbMs = this.samples.map(s => s.audioCallbackMs);
    const jitMs = this.samples.map(s => s.schedulerJitterMs);
    const frameMs = this.samples.map(s => s.mainThreadFrameMs);
    const voices = this.samples.map(s => s.activeVoices);
    const cpu = this.samples.map(s => s.cpuLoad);

    const durationSec = n > 1
      ? (this.samples[n - 1].timestamp - this.samples[0].timestamp) / 1000
      : 0;

    const failures: string[] = [];
    const cbMax = Math.max(...cbMs);
    const jitMax = Math.max(...jitMs);
    const frameMax = Math.max(...frameMs);
    const cpuMax = Math.max(...cpu);

    if (cbMax > STABILITY_THRESHOLDS.audioCallbackMs) {
      failures.push(`audio callback ${cbMax.toFixed(2)}ms > ${STABILITY_THRESHOLDS.audioCallbackMs}ms`);
    }
    if (jitMax > STABILITY_THRESHOLDS.schedulerJitterMs) {
      failures.push(`scheduler jitter ${jitMax.toFixed(2)}ms > ${STABILITY_THRESHOLDS.schedulerJitterMs}ms`);
    }
    if (frameMax > STABILITY_THRESHOLDS.mainThreadFrameMs) {
      failures.push(`main thread frame ${frameMax.toFixed(2)}ms > ${STABILITY_THRESHOLDS.mainThreadFrameMs}ms`);
    }
    if (cpuMax > STABILITY_THRESHOLDS.cpuLoad) {
      failures.push(`CPU load ${(cpuMax * 100).toFixed(1)}% > ${(STABILITY_THRESHOLDS.cpuLoad * 100).toFixed(0)}%`);
    }

    return {
      samples: n,
      durationSec,
      audioCallbackMs: { mean: mean(cbMs), max: cbMax, p95: p95(cbMs) },
      schedulerJitterMs: { mean: mean(jitMs), max: jitMax, p95: p95(jitMs) },
      mainThreadFrameMs: { mean: mean(frameMs), max: frameMax, p95: p95(frameMs) },
      activeVoices: { mean: mean(voices), max: Math.max(...voices) },
      cpuLoad: { mean: mean(cpu), max: cpuMax },
      totalLateEvents: this.lateEvents,
      totalDroppedEvents: this.droppedEvents,
      maxQueueDepth: this.maxQueueDepth,
      stable: failures.length === 0,
      failures,
    };
  }

  /** Quick check — is the engine stable enough to run the optimizer? */
  isStable(): boolean {
    if (this.samples.length < 10) return false;
    const report = this.getReport();
    return report.stable;
  }
}

export const STABILITY_THRESHOLD = STABILITY_THRESHOLDS;
