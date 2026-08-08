/**
 * CLOCK & TRANSPORT — Phase 3 (CLOCK stage).
 * REAL IMPLEMENTATION.
 *
 * The master clock that drives every sequencer in the rig. Sample-accurate.
 * This is the Live 12 master clock twin. All devices read tick positions from
 * a single transport instance, which is how synchronization integrity is proven.
 */

export interface TransportConfig {
  bpm: number;
  sampleRate: number;
  /** PPQ — pulses per quarter note (internal tick resolution). */
  ppq: number;
}

export class Transport {
  bpm: number;
  sampleRate: number;
  ppq: number;
  /** Current sample index from start of render. */
  sample = 0;
  /** Current PPQ tick (fractional). */
  tick = 0;
  /** Bar/beat position (fractional beats from start). */
  beat = 0;
  /** Whole bars elapsed (integer). */
  bar = 0;
  /** Sixteenth position within bar (0..15). */
  sixteenth = 0;
  private samplesPerBeat: number;
  private samplesPerTick: number;
  private sixteenthCounter = 0;

  constructor(cfg: TransportConfig) {
    this.bpm = cfg.bpm;
    this.sampleRate = cfg.sampleRate;
    this.ppq = cfg.ppq;
    this.samplesPerBeat = (60 / this.bpm) * this.sampleRate;
    this.samplesPerTick = this.samplesPerBeat / this.ppq;
  }

  /** Advance one audio sample. Updates all position counters. */
  advance() {
    this.sample++;
    this.tick += 1 / this.samplesPerTick;
    this.beat = this.tick / this.ppq;
    this.bar = Math.floor(this.beat / 4);
    const sixteenthRaw = Math.floor(this.beat * 4);
    this.sixteenth = sixteenthRaw % 16;
  }

  /** Advance N samples (for block processing). */
  advanceN(n: number) {
    for (let i = 0; i < n; i++) this.advance();
  }

  /** Seconds elapsed. */
  seconds(): number { return this.sample / this.sampleRate; }

  /** Total beats (fractional). */
  beats(): number { return this.beat; }

  /** Reset to start. */
  reset() {
    this.sample = 0;
    this.tick = 0;
    this.beat = 0;
    this.bar = 0;
    this.sixteenth = 0;
    this.sixteenthCounter = 0;
  }

  /** Convert bars → samples. */
  barsToSamples(bars: number): number {
    return Math.floor(bars * 4 * this.samplesPerBeat);
  }

  /** Convert seconds → samples. */
  secondsToSamples(s: number): number {
    return Math.floor(s * this.sampleRate);
  }

  /** Samples per sixteenth note. */
  samplesPerSixteenth(): number {
    return this.samplesPerBeat / 4;
  }

  /** Samples per bar (4/4). */
  samplesPerBar(): number {
    return this.samplesPerBeat * 4;
  }

  /** Set tempo (recomputes timing). */
  setBpm(bpm: number) {
    this.bpm = bpm;
    this.samplesPerBeat = (60 / this.bpm) * this.sampleRate;
    this.samplesPerTick = this.samplesPerBeat / this.ppq;
  }
}
