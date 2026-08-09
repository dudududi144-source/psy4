/**
 * Latency Monitor — measures realtime engine performance during playback.
 *
 * Attaches to the Psy4LiveEngine and records:
 *   - AudioContext latency
 *   - Scheduler jitter (std dev of step timing)
 *   - Late/dropped events
 *   - Underruns
 *   - Active voice count
 *   - CPU load (from worklet stats)
 *   - UI render count
 *   - Worklet message count
 *
 * After 60 seconds of playback, produces a PERFORMANCE REPORT.
 */

export interface LatencySample {
  time: number;            // seconds since start
  scheduledStepTime: number;
  actualStepTime: number;
  jitter: number;          // actual - scheduled
  activeVoices: number;
  cpuLoad: number;
  eventCount: number;
}

export class LatencyMonitor {
  private samples: LatencySample[] = [];
  private startTime: number = 0;
  private running: boolean = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastStepTime: number = 0;
  private lateEvents: number = 0;
  private droppedEvents: number = 0;
  private underruns: number = 0;
  private uiRenderCount: number = 0;
  private workletMessageCount: number = 0;

  start(): void {
    this.samples = [];
    this.startTime = performance.now();
    this.running = true;
    this.lateEvents = 0;
    this.droppedEvents = 0;
    this.underruns = 0;
    this.uiRenderCount = 0;
    this.workletMessageCount = 0;
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Called by the UI each time it re-renders during playback. */
  recordUIRender(): void {
    if (this.running) this.uiRenderCount++;
  }

  /** Called each time the worklet sends a stats message. */
  recordWorkletMessage(): void {
    if (this.running) this.workletMessageCount++;
  }

  /** Record a latency sample from the engine. */
  recordSample(
    scheduledStepTime: number,
    actualStepTime: number,
    activeVoices: number,
    cpuLoad: number,
    eventCount: number,
  ): void {
    if (!this.running) return;
    const jitter = actualStepTime - scheduledStepTime;
    if (Math.abs(jitter) > 0.005) this.lateEvents++;
    if (eventCount > 100) this.droppedEvents++; // heuristic: queue backing up
    this.samples.push({
      time: (performance.now() - this.startTime) / 1000,
      scheduledStepTime,
      actualStepTime,
      jitter,
      activeVoices,
      cpuLoad,
      eventCount,
    });
  }

  /** Mark an underrun (detected externally). */
  recordUnderrun(): void {
    if (this.running) this.underruns++;
  }

  /** Compute the final metrics. */
  getMetrics(durationSec: number): {
    audioContextLatency: number;
    averageJitter: number;
    maxJitter: number;
    lateEvents: number;
    droppedEvents: number;
    underruns: number;
    activeVoices: number;
    cpuLoad: number;
    uiRenderCount: number;
    workletMessageCount: number;
  } | null {
    if (this.samples.length === 0) return null;

    const jitterValues = this.samples.map(s => Math.abs(s.jitter));
    const avgJitter = jitterValues.reduce((a, b) => a + b, 0) / jitterValues.length;
    const maxJitter = Math.max(...jitterValues);
    const avgVoices = this.samples.reduce((a, s) => a + s.activeVoices, 0) / this.samples.length;
    const avgCpu = this.samples.reduce((a, s) => a + s.cpuLoad, 0) / this.samples.length;

    return {
      audioContextLatency: 0.003, // typical Web Audio latency (will be overridden)
      averageJitter: avgJitter,
      maxJitter: maxJitter,
      lateEvents: this.lateEvents,
      droppedEvents: this.droppedEvents,
      underruns: this.underruns,
      activeVoices: Math.round(avgVoices),
      cpuLoad: avgCpu,
      uiRenderCount: Math.round(this.uiRenderCount / durationSec),
      workletMessageCount: Math.round(this.workletMessageCount / durationSec),
    };
  }

  get isRunning(): boolean {
    return this.running;
  }
}
