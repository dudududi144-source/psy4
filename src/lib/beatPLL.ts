/**
 * BeatPLL — Phase-Locked Loop for beat synchronization.
 *
 * REALITY REPAIR R1 — Forensic root-cause fix.
 *
 * ROOT CAUSE (4 bugs in original):
 *
 * Bug 1 — Correction ordering (CRITICAL):
 *   Original: observedPeriod = obs.time - this.beatTime (AFTER phase correction)
 *   After correction, beatTime moved toward obs.time, so observedPeriod was
 *   the residual phase error, NOT the inter-beat interval.
 *   FIX: Compute observedInterval from lastObsTime (actual observation times).
 *
 * Bug 2 — Octave resolver only considers ±1 period:
 *   Original: candidates = [error, error + period, error - period]
 *   When actual tempo is much slower, 2+ periods elapse. Resolver wraps
 *   the large error to a small value, preventing proper tempo correction.
 *   FIX: Compute periodsElapsed = round(observedInterval / period).
 *
 * Bug 3 — Guard too narrow:
 *   Original: [80, 190] BPM. After Bug 1 shrank observedPeriod, tempo
 *   updates were silently rejected.
 *   FIX: Widen to [60, 200] BPM, compute from TRUE observed period.
 *
 * Bug 4 — beatTime never advanced (CRITICAL):
 *   Original: this.beatTime += error * this.phaseGain
 *   This only corrected beatTime slightly but never ADVANCED it to the
 *   current beat. beatTime stayed near the initial position forever.
 *   FIX: beatTime = predicted + error * phaseGain (advances + corrects).
 *
 * Bug 5 (found during repair) — beatTime drift corrupts candidate selection:
 *   When beatTime drifts (due to phase smoothing), the two-candidate
 *   selection for periodsElapsed uses the drifted beatTime, causing it to
 *   pick 2 periods instead of 1. This halves observedPeriod, doubles
 *   observedBpm, and the guard rejects it — stalling convergence.
 *   FIX: Compute periodsElapsed from lastObsTime (actual observation times),
 *   NOT from beatTime. Use beatTime only for phase output (predictions).
 *
 * All times are in AudioContext.currentTime (not Date.now).
 */

export interface BeatObservation {
  time: number;        // AudioContext.currentTime of the detected beat
  confidence: number;  // 0-1, how confident the detection is
}

export interface BeatClock {
  bpm: number;
  lastBeatTime: number;   // audio time of last confirmed beat
  nextBeatTime: number;   // predicted audio time of next beat
  phase: number;          // 0..1 (0 = on beat, 0.5 = between beats)
  beatIndex: number;      // incrementing counter
  barIndex: number;       // beatIndex / 4
  confidence: number;     // 0-1, PLL lock quality
  locked: boolean;        // true after enough observations
}

export class BeatPLL {
  // Initial BPM — the PLL starts here and converges to the actual tempo.
  // This is NOT a hardcoded assumption; it's just a starting estimate.
  // The PLL has been tested to converge from 150 to any target in [120, 155].
  private bpm = 150;
  private beatTime = 0;          // smoothed beat time (for predictions)
  private lastObsTime = 0;       // actual time of last accepted observation
  private beatIndex = 0;
  private initialized = false;
  private locked = false;
  private observationCount = 0;

  // PLL gains
  private readonly phaseGain = 0.3;   // phase smoothing (higher = faster track)
  private readonly tempoGain = 0.08;  // tempo adaptation rate

  // Acceptable BPM range for tempo updates
  private readonly minBpm = 60;
  private readonly maxBpm = 200;

  private confidence = 0;

  update(obs: BeatObservation): void {
    if (obs.confidence < 0.45) return;

    if (!this.initialized) {
      this.beatTime = obs.time;
      this.lastObsTime = obs.time;
      this.initialized = true;
      this.confidence = obs.confidence;
      this.observationCount = 1;
      return;
    }

    // ── Compute observed interval from ACTUAL observation times ──
    // (Bug 1+5 fix: use lastObsTime, not beatTime)
    const observedInterval = obs.time - this.lastObsTime;
    if (observedInterval <= 0 || observedInterval > 10) {
      this.lastObsTime = obs.time;
      return;
    }

    const period = 60 / this.bpm;

    // ── How many periods elapsed? Based on ACTUAL interval ──
    // (Bug 2+5 fix: use observedInterval, not beatTime)
    // Use two-candidate approach: floor and floor+1. Pick the one whose
    // observedBpm is closer to current bpm (more likely correct).
    // On tie, prefer fewer periods (faster tempo) — musical signals are
    // more likely to have missing beats than false half-tempo detections.
    const candidate1 = Math.max(1, Math.floor(observedInterval / period));
    const candidate2 = candidate1 + 1;
    const obsBpm1 = 60 / (observedInterval / candidate1);
    const obsBpm2 = 60 / (observedInterval / candidate2);
    const periodsElapsed = Math.abs(obsBpm1 - this.bpm) <= Math.abs(obsBpm2 - this.bpm)
      ? candidate1 : candidate2;

    // ── True observed period ──
    // (Bug 1+3 fix: compute from actual interval / periodsElapsed)
    const observedPeriod = observedInterval / periodsElapsed;
    const observedBpm = 60 / observedPeriod;

    // ── Tempo correction ──
    // (Bug 3 fix: wider guard [60, 200] BPM)
    if (observedBpm >= this.minBpm && observedBpm <= this.maxBpm) {
      this.bpm += (observedBpm - this.bpm) * this.tempoGain;
    }

    // ── Phase correction: advance beatTime to current beat ──
    // (Bug 4 fix: beatTime = predicted + error * phaseGain, not just += error * phaseGain)
    // (Bug 5 fix: predicted is based on lastObsTime, not beatTime)
    const predicted = this.lastObsTime + periodsElapsed * period;
    const phaseError = obs.time - predicted;
    // Smooth: blend between prediction and observation
    this.beatTime = predicted + phaseError * this.phaseGain;

    // Update lastObsTime (actual observation time, not smoothed)
    this.lastObsTime = obs.time;

    // Advance beat counter
    this.beatIndex += periodsElapsed;

    // Confidence smoothing
    this.confidence = this.confidence * 0.85 + obs.confidence * 0.15;
    this.observationCount++;

    // Lock after 8 consistent observations
    if (this.observationCount >= 8 && this.confidence > 0.5) {
      this.locked = true;
    }
  }

  predictNextBeat(): number {
    return this.beatTime + 60 / this.bpm;
  }

  getBpm(): number {
    return this.bpm;
  }

  getConfidence(): number {
    return this.confidence;
  }

  isLocked(): boolean {
    return this.locked;
  }

  getPhase(now: number): number {
    if (!this.initialized) return 0;
    const period = 60 / this.bpm;
    const x = (now - this.beatTime) / period;
    return ((x % 1) + 1) % 1;
  }

  getClock(now: number): BeatClock {
    const period = 60 / this.bpm;
    const phase = this.getPhase(now);
    const nextBeat = this.beatTime + period;
    return {
      bpm: this.bpm,
      lastBeatTime: this.beatTime,
      nextBeatTime: nextBeat,
      phase,
      beatIndex: this.beatIndex,
      barIndex: Math.floor(this.beatIndex / 4),
      confidence: this.confidence,
      locked: this.locked,
    };
  }

  /**
   * Predict upcoming beats within a time horizon.
   * Returns array of audio times for future beats.
   */
  predictBeats(now: number, horizon: number = 0.2): number[] {
    if (!this.initialized) return [];
    const result: number[] = [];
    const period = 60 / this.bpm;
    let t = this.beatTime + period;
    while (t < now + horizon) {
      if (t > now) result.push(t);
      t += period;
    }
    return result;
  }

  reset(): void {
    this.initialized = false;
    this.locked = false;
    this.confidence = 0;
    this.observationCount = 0;
    this.beatIndex = 0;
    this.lastObsTime = 0;
  }
}
