/**
 * Forensic DSP — isomorphic TypeScript port of psy4-engine.js DSP.
 *
 * This is the EXACT same DSP as the realtime AudioWorklet, ported to pure TS
 * so it can run:
 *   - In Node.js (offline rendering, analysis)
 *   - In the browser (deterministic comparison)
 *
 * DETERMINISM: No Math.random(). All randomness comes from the Rng class.
 * Same seed + same params => same output, bit-for-bit.
 *
 * This is NOT a simplified version. Every filter coefficient, every envelope
 * curve, every saturation curve matches the worklet exactly.
 */

import { Rng } from './prng';

// ─── Fast tanh via lookup table ────────────────────────────────────────────

const TANH_TABLE_SIZE = 2048;
const tanhTable = new Float32Array(TANH_TABLE_SIZE + 1);
for (let i = 0; i <= TANH_TABLE_SIZE; i++) {
  const x = (i / TANH_TABLE_SIZE) * 2 - 1; // -1..1
  tanhTable[i] = Math.tanh(x);
}

export function fastTanh(x: number): number {
  if (x >= 1) return 1;
  if (x <= -1) return -1;
  const idx = (x + 1) * 0.5 * TANH_TABLE_SIZE;
  const i0 = idx | 0;
  const f = idx - i0;
  return tanhTable[i0] * (1 - f) + tanhTable[i0 + 1] * f;
}

// ─── polyBLEP ──────────────────────────────────────────────────────────────

export function polyBlep(phase: number, inc: number): number {
  if (phase < inc) {
    const t = phase / inc;
    return 2 * t - t * t - 1;
  } else if (phase > 1 - inc) {
    const t = (phase - 1) / inc;
    return t * t + 2 * t + 1;
  }
  return 0;
}

// ─── Moog Ladder Filter (4-stage tanh, stateful) ───────────────────────────

export class MoogLadder {
  s0 = 0; s1 = 0; s2 = 0; s3 = 0;
  g = 0;
  lastCutoff = -1;

  reset(): void {
    this.s0 = this.s1 = this.s2 = this.s3 = 0;
  }

  process(x: number, cutoff: number, res: number, drive: number, sr: number): number {
    if (Math.abs(cutoff - this.lastCutoff) > 0.5) {
      const fc = Math.min(0.45, cutoff / sr);
      this.g = 1 - Math.exp(-2 * Math.PI * fc);
      this.lastCutoff = cutoff;
    }
    const g = this.g;
    const fb = res * 4 * fastTanh(this.s3);
    const u = fastTanh((x - fb) * drive);
    let prev = u;
    this.s0 += g * (fastTanh(prev) - this.s0); prev = this.s0;
    this.s1 += g * (fastTanh(prev) - this.s1); prev = this.s1;
    this.s2 += g * (fastTanh(prev) - this.s2); prev = this.s2;
    this.s3 += g * (fastTanh(prev) - this.s3);
    return this.s3 / (1 + res * 0.5);
  }
}

// ─── One-pole lowpass ──────────────────────────────────────────────────────

export class OnePoleLP {
  v = 0;
  reset(): void { this.v = 0; }
  process(x: number, cutoff: number, sr: number): number {
    const a = (1 / sr) * 2 * Math.PI * cutoff;
    this.v += a * (x - this.v) / (1 + a);
    return this.v;
  }
}

// ─── Pink noise (deterministic via Rng) ────────────────────────────────────

export class PinkNoise {
  private b = new Float32Array(7);
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  reset(): void { this.b.fill(0); }

  next(): number {
    const w = this.rng.range(-1, 1);
    this.b[0] = 0.99886 * this.b[0] + w * 0.0555179;
    this.b[1] = 0.99332 * this.b[1] + w * 0.0750759;
    this.b[2] = 0.96900 * this.b[2] + w * 0.1538520;
    this.b[3] = 0.86650 * this.b[3] + w * 0.3104856;
    this.b[4] = 0.55000 * this.b[4] + w * 0.5329522;
    this.b[5] = -0.7616 * this.b[5] - w * 0.0168980;
    const p = this.b[0] + this.b[1] + this.b[2] + this.b[3] + this.b[4] + this.b[5] + this.b[6] + w * 0.5362;
    this.b[6] = w * 0.115926;
    return p * 0.11;
  }

  process(): number {
    return this.next();
  }
}

// ─── ADSR Envelope ─────────────────────────────────────────────────────────

export class ADSR {
  stage = 4;
  t = 0;
  value = 0;
  a = 0; d = 0; s = 0; r = 0;

  trigger(a: number, d: number, s: number, r: number): void {
    this.stage = 0; this.t = 0;
    this.a = a; this.d = d; this.s = s; this.r = r;
    this.value = 0;
  }

  release(): void {
    if (this.stage < 3) { this.stage = 3; this.t = 0; }
  }

  process(dt: number): number {
    if (this.stage >= 4) return 0;
    this.t += dt;
    if (this.stage === 0) {
      this.value = this.t / Math.max(0.0001, this.a);
      if (this.t >= this.a) { this.stage = 1; this.t = 0; this.value = 1; }
    } else if (this.stage === 1) {
      this.value = 1 - (1 - this.s) * (this.t / Math.max(0.0001, this.d));
      if (this.t >= this.d) { this.stage = 2; this.value = this.s; }
    } else if (this.stage === 2) {
      this.value = this.s;
    } else if (this.stage === 3) {
      this.value = this.s * (1 - this.t / Math.max(0.0001, this.r));
      if (this.t >= this.r) { this.stage = 4; this.value = 0; }
    }
    return Math.max(0, Math.min(1, this.value));
  }

  get done(): boolean { return this.stage >= 4; }
}

// ─── Exponential decay envelope ────────────────────────────────────────────

export class DecayEnv {
  t = 0;
  decay = 0.1;
  active = false;

  trigger(decay: number): void {
    this.t = 0;
    this.decay = Math.max(0.001, decay);
    this.active = true;
  }

  process(dt: number): number {
    if (!this.active) return 0;
    this.t += dt;
    const v = Math.exp(-this.t / this.decay);
    if (v < 0.0001) { this.active = false; return 0; }
    return v;
  }

  get done(): boolean { return !this.active; }
}

// ─── Band-limited sawtooth oscillator (polyBLEP) ───────────────────────────

export class BLSaw {
  phase = 0;
  freq = 220;

  setFreq(f: number): void { this.freq = f; }

  process(inc: number): number {
    const val = 2 * this.phase - 1;
    const corrected = val - polyBlep(this.phase, inc);
    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    return corrected;
  }

  reset(): void { this.phase = 0; }
}

// ─── Band-limited square oscillator (polyBLEP) ─────────────────────────────

export class BLSquare {
  phase = 0;
  freq = 220;

  setFreq(f: number): void { this.freq = f; }

  process(inc: number): number {
    let val = this.phase < 0.5 ? 1 : -1;
    val += polyBlep(this.phase, inc);
    let p2 = this.phase + 0.5;
    if (p2 >= 1) p2 -= 1;
    val -= polyBlep(p2, inc);
    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    return val;
  }

  reset(): void { this.phase = 0; }
}
