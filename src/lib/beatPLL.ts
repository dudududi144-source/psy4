/**
 * BeatPLL — Phase-Locked Loop for beat synchronization.
 *
 * BPM alone is NOT a clock. You need phase: "when is the next beat?"
 *
 * This PLL receives beat observations (from kick detection) and:
 *   1. Measures phase error (observed - predicted)
 *   2. Corrects phase slightly (not reset)
 *   3. Corrects tempo slightly (not jump)
 *   4. Predicts next beat time
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
  private bpm = 150;
  private beatTime = 0;
  private beatIndex = 0;
  private initialized = false;
  private locked = false;
  private observationCount = 0;

  // PLL gains — tuned for stability (not too fast, not too slow)
  private readonly phaseGain = 0.18;
  private readonly tempoGain = 0.025;

  private confidence = 0;

  update(obs: BeatObservation): void {
    if (obs.confidence < 0.45) return;

    if (!this.initialized) {
      this.beatTime = obs.time;
      this.initialized = true;
      this.confidence = obs.confidence;
      this.observationCount = 1;
      return;
    }

    const period = 60 / this.bpm;
    const predicted = this.beatTime + period;

    let error = obs.time - predicted;

    // Resolve octave errors (half/double tempo)
    const candidates = [error, error + period, error - period];
    error = candidates.reduce((best, x) =>
      Math.abs(x) < Math.abs(best) ? x : best
    );

    // Phase correction (small adjustment, not reset)
    this.beatTime += error * this.phaseGain;

    // Tempo correction (small adjustment)
    const observedPeriod = obs.time - this.beatTime;
    if (observedPeriod > 60 / 190 && observedPeriod < 60 / 80) {
      const observedBpm = 60 / observedPeriod;
      this.bpm += (observedBpm - this.bpm) * this.tempoGain;
    }

    // Advance beat counter
    this.beatIndex++;

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
  }
}
