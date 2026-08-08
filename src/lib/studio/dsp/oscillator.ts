/**
 * DSP PRIMITIVES — Oscillators.
 * REAL IMPLEMENTATION. Computes actual sample values.
 *
 * All oscillators are band-limited where it matters (BLEP for saw/square,
 * direct for sine/triangle which are inherently band-limited).
 */

import { Rng } from '../rng';

export type WaveShape = 'saw' | 'square' | 'sine' | 'triangle' | 'noise' | 'wavetable';

/** PolyBLEP helper — corrects the discontinuity of naive waveforms. */
function polyblep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  } else if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x + x + x * x + 1;
  }
  return 0;
}

export class Oscillator {
  shape: WaveShape;
  phase = 0;            // 0..1
  phaseInc = 0;         // per sample
  freq = 440;
  sr: number;
  // FM
  fmAmount = 0;         // in Hz deviation applied per sample
  // sync
  syncEnabled = false;
  syncPhase = 0;        // restart target
  private wavetable: Float32Array | null = null;
  private rng: Rng;
  private noiseState: number;

  constructor(shape: WaveShape, sampleRate: number, seed = 1) {
    this.shape = shape;
    this.sr = sampleRate;
    this.rng = new Rng(seed);
    this.noiseState = this.rng.nextUint32();
  }

  setFrequency(freq: number) {
    this.freq = Math.max(0.0001, freq);
    this.phaseInc = this.freq / this.sr;
  }

  setWavetable(wt: Float32Array) {
    this.wavetable = wt;
  }

  /** Advance one sample and return value in [-1, 1]. */
  process(fmSignal = 0): number {
    let out = 0;
    const inc = this.phaseInc + fmSignal;
    // Wrap phase BEFORE reading so FM/overflow never causes out-of-bounds reads.
    // (Without this, a large FM signal pushes phase to e.g. 52.0, and a wavetable
    //  read at index 52*1023 is out of bounds → undefined → NaN.)
    const p = this.phase - Math.floor(this.phase);

    switch (this.shape) {
      case 'sine':
        out = Math.sin(2 * Math.PI * p);
        break;
      case 'triangle': {
        // phase 0..1 → triangle -1..1
        const v = p < 0.5 ? p * 4 - 1 : 3 - p * 4;
        out = v;
        break;
      }
      case 'saw': {
        const naive = 2 * p - 1;
        const dt = inc;
        out = naive - polyblep(p, dt);
        break;
      }
      case 'square': {
        const naive = p < 0.5 ? 1 : -1;
        const dt = inc;
        out = naive - polyblep(p, dt) + polyblep((p + 0.5) % 1, dt);
        break;
      }
      case 'noise': {
        // xorshift noise, low-cost
        let s = this.noiseState;
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5; s >>>= 0;
        this.noiseState = s;
        out = (s / 2147483648) - 1;
        break;
      }
      case 'wavetable': {
        if (this.wavetable && this.wavetable.length > 1) {
          const idx = p * (this.wavetable.length - 1);
          const i0 = Math.floor(idx);
          const i1 = Math.min(i0 + 1, this.wavetable.length - 1);
          const frac = idx - i0;
          out = this.wavetable[i0] * (1 - frac) + this.wavetable[i1] * frac;
        }
        break;
      }
    }

    // advance phase with FM
    this.phase += inc;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      if (this.syncEnabled) {
        // external sync handled by caller via reset()
      }
    }

    return Math.max(-1.5, Math.min(1.5, out));
  }

  reset(phase = 0) {
    this.phase = phase;
  }
}

/** Build a wavetable from a harmonic recipe (additive). */
export function buildWavetable(harmonics: { n: number; amp: number }[], size = 2048): Float32Array {
  const wt = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = i / size;
    let v = 0;
    for (const h of harmonics) {
      v += h.amp * Math.sin(2 * Math.PI * h.n * t);
    }
    wt[i] = v;
  }
  // normalize
  let max = 0;
  for (let i = 0; i < size; i++) max = Math.max(max, Math.abs(wt[i]));
  if (max > 0) for (let i = 0; i < size; i++) wt[i] /= max;
  return wt;
}

/** Cross-fade two wavetables by position 0..1. */
export function morphWavetables(a: Float32Array, b: Float32Array, pos: number): Float32Array {
  const out = new Float32Array(a.length);
  const p = Math.max(0, Math.min(1, pos));
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] * (1 - p) + b[i] * p;
  }
  return out;
}
