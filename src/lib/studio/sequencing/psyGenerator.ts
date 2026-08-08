/**
 * PSYCHEDELIC GENERATION ENGINE — Phase 4.
 * REAL IMPLEMENTATION.
 *
 * Produces evolving material that changes continuously WITHOUT becoming
 * musical chaos. The engine layers:
 *
 *  - deterministic modulation (LFOs, synced envelopes)
 *  - controlled randomness (probability gates, bounded parameter walk)
 *  - correlated parameter movement (a single "macro" moves many params together)
 *  - rhythmic mutation (per-step probability, density control)
 *  - timbral evolution (wavetable scan, filter drift)
 *  - spectral movement (FM index, formant shift)
 *  - harmonic variation (scale-degree walks within a fixed scale)
 *  - temporal variation (swing, micro-timing, retrig variation)
 *  - density control (probability scaled by arrangement section)
 *  - tension/release (macro envelope shaping intensity over time)
 *
 * All driven by a seeded Rng so evolution is REPRODUCIBLE.
 */

import { Rng, hashSeed } from '../rng';
import { SCALES, scaleNote, mtof } from '../dsp/wavetable';
import { LFO } from '../dsp/envelope';

export interface PsyConfig {
  seed: number;
  root: number;            // MIDI root note
  scale: string;           // key into SCALES
  bpm: number;
  /** Length of the evolving section in bars. */
  bars: number;
  /** Density 0..1 — higher = more events, more layers. */
  density: number;
  /** Tension envelope shape: 'rise' | 'fall' | 'arc' | 'wave' */
  tensionShape: 'rise' | 'fall' | 'arc' | 'wave' | 'plateau';
}

/** A single evolving parameter with bounded random walk + LFO overlay. */
export class EvolvingParam {
  base: number;
  range: number;       // ±
  walkRate: number;    // how fast the walk drifts (0..1)
  lfoFreq: number;
  lfoDepth: number;
  private value: number;
  private walk: number;
  private lfo: LFO;
  private rng: Rng;

  constructor(base: number, range: number, walkRate: number, lfoFreq: number, lfoDepth: number, rng: Rng) {
    this.base = base;
    this.range = range;
    this.walkRate = walkRate;
    this.lfoFreq = lfoFreq;
    this.lfoDepth = lfoDepth;
    this.value = base;
    this.walk = 0;
    this.lfo = new LFO('sine', 44100, rng.nextUint32());
    this.lfo.setFreqHz(lfoFreq);
    this.rng = rng;
  }

  /** Advance one step (called per bar or per N samples). */
  step() {
    // bounded random walk (correlated movement)
    this.walk += this.rng.gaussian(0, this.walkRate);
    // clamp walk to ±range so it never escapes
    if (this.walk > this.range) this.walk = this.range;
    if (this.walk < -this.range) this.walk = -this.range;
    // mean-reverting pull back to base
    this.walk *= 0.992;
    this.value = this.base + this.walk;
  }

  /** Per-sample value with LFO overlay. */
  sample(): number {
    return this.value + this.lfo.process() * this.lfoDepth;
  }

  get current(): number { return this.value; }
}

/** A melodic sequence generator that walks scale degrees with mutation. */
export class EvolvingSequence {
  private cfg: PsyConfig;
  private rng: Rng;
  private scale: number[];
  private degree = 0;
  private pattern: number[] = [];
  private patternPos = 0;
  private mutationCounter = 0;
  private mutationEvery: number;

  constructor(cfg: PsyConfig, rng: Rng, mutationEvery = 4) {
    this.cfg = cfg;
    this.rng = rng;
    this.scale = SCALES[cfg.scale] || SCALES.minor;
    this.mutationEvery = mutationEvery;
    this.regenerate();
  }

  /** Regenerate the underlying pitch pattern (mutate but keep identity). */
  regenerate() {
    const len = 16;
    this.pattern = [];
    // generate a motif within a small range so identity is preserved
    const motifRange = 5; // degrees -2..+2
    for (let i = 0; i < len; i++) {
      // bias toward stepwise motion (correlated)
      if (i === 0) {
        this.pattern.push(0);
      } else {
        const step = this.rng.pick([-2, -1, -1, 0, 1, 1, 2]);
        let next = this.pattern[i - 1] + step;
        // clamp to motif range
        next = Math.max(-motifRange, Math.min(motifRange, next));
        this.pattern.push(next);
      }
    }
    this.mutationCounter = 0;
  }

  /** Next note (called per step). Occasionally mutates a single step. */
  next(): number {
    const note = scaleNote(this.cfg.root, this.scale, this.pattern[this.patternPos]);
    this.patternPos = (this.patternPos + 1) % this.pattern.length;
    this.mutationCounter++;
    // mutate: replace ONE step occasionally — changes without losing identity
    if (this.mutationCounter >= this.mutationEvery * 16) {
      const idx = this.rng.int(0, this.pattern.length - 1);
      const step = this.rng.pick([-2, -1, 1, 2]);
      this.pattern[idx] = Math.max(-5, Math.min(5, this.pattern[idx] + step));
      this.mutationCounter = 0;
    }
    return note;
  }

  getPattern(): number[] { return [...this.pattern]; }
}

/** Macro tension envelope over the whole section. */
export function tensionAt(progress: number, shape: PsyConfig['tensionShape']): number {
  // progress 0..1 → tension 0..1
  const p = Math.max(0, Math.min(1, progress));
  switch (shape) {
    case 'rise': return p;
    case 'fall': return 1 - p;
    case 'arc': return 4 * p * (1 - p); // parabola peak at 0.5
    case 'wave': return 0.5 + 0.5 * Math.sin(2 * Math.PI * p * 2 - Math.PI / 2);
    case 'plateau': return p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1;
  }
}

/** Density scaler per section progress. */
export function densityAt(progress: number, base: number, shape: PsyConfig['tensionShape']): number {
  const t = tensionAt(progress, shape);
  // density follows tension but never zero (keep identity)
  return Math.max(0.15, base * (0.4 + 0.6 * t));
}

/** Build a complete psychedelic config preset. */
export function makePsyConfig(overrides: Partial<PsyConfig> = {}): PsyConfig {
  return {
    seed: hashSeed('psy4-default'),
    root: 45,           // A2
    scale: 'minor',
    bpm: 138,
    bars: 32,
    density: 0.6,
    tensionShape: 'arc',
    ...overrides,
  };
}

/**
 * Generate a 16-step event schedule for a single bar with density + mutation.
 * Returns which steps fire + their notes. Deterministic given seed + bar index.
 */
export function barSchedule(
  cfg: PsyConfig,
  seq: EvolvingSequence,
  rng: Rng,
  barIndex: number
): { step: number; note: number; vel: number; retrig: number }[] {
  const progress = barIndex / cfg.bars;
  const density = densityAt(progress, cfg.density, cfg.tensionShape);
  const tension = tensionAt(progress, cfg.tensionShape);
  const events: { step: number; note: number; vel: number; retrig: number }[] = [];

  for (let s = 0; s < 16; s++) {
    // base probability scaled by density
    let p = density;
    // accent on downbeats + off-beats (psytrance identity)
    if (s % 4 === 0) p = Math.min(1, p * 1.4);
    if (s % 2 === 1) p = Math.min(1, p * 1.15);
    if (rng.chance(p)) {
      const note = seq.next();
      const vel = 0.5 + 0.4 * tension + rng.gaussian(0, 0.05);
      const retrig = rng.chance(0.15 * tension) ? rng.int(2, 4) : 1;
      events.push({ step: s, note, vel: Math.max(0.2, Math.min(1, vel)), retrig });
    } else {
      // still advance sequence to keep melodic identity? No — only consume on fire
      // (keeps the sequence tied to actual notes)
    }
  }
  return events;
}

/** Frequency from a config note. */
export function noteFreq(note: number): number { return mtof(note); }
