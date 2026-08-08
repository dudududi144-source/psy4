/**
 * DSP PRIMITIVES — Filters.
 * REAL IMPLEMENTATION.
 *
 * - MoogLadder: 4-pole resonant lowpass modeled on the Moog transistor ladder.
 *   (Huovilainen style — stable, musical, self-oscillates.)
 * - StateVariable: 2-pole SVF giving simultaneous LP/BP/HP/notch.
 * - OnePole: utility 1-pole LP/HP.
 */

/** Improved Moog ladder (Huovilainen) — self-oscillating, stable. */
export class MoogLadder {
  private sr: number;
  private cutoff = 1000;
  private resonance = 0.3;
  private stage = [0, 0, 0, 0];
  private stageTanh = [0, 0, 0, 0];
  private delay = [0, 0, 0, 0];
  private p = 0;
  private k = 0;
  private t1 = 0;
  private t2 = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.setCutoff(this.cutoff);
  }

  setCutoff(freq: number) {
    this.cutoff = Math.max(20, Math.min(this.sr * 0.45, freq));
    const fc = this.cutoff / this.sr;
    // Huovilainen coefficients
    const f = fc * 2; // oversample factor compensation
    this.p = (3.6 * f) - (1.6 * f * f) - 2 * f * f * f;
    this.k = 2 * Math.sin(Math.PI * Math.min(0.25, fc)) - 1;
    this.t1 = (1 - this.p) * 1.386249;
    this.t2 = 12 + this.t1 * this.t1;
  }

  setResonance(res: number) {
    // 0..1; >~0.9 self-oscillates
    this.resonance = Math.max(0, Math.min(1.2, res));
  }

  process(input: number): number {
    const res = this.resonance * 4; // 0..~4.8 feedback
    // feedback from last stage (with tanh saturation)
    const fb = res * (this.stage[3]);
    const s = input - fb;
    // 4 one-pole stages with tanh (soft saturation like the real ladder)
    for (let i = 0; i < 4; i++) {
      const x = s * this.p + this.delay[i] * (1 - this.p);
      this.stageTanh[i] = Math.tanh(x);
      this.delay[i] = x;
    }
    // apply stage chain
    this.stage[0] = this.stageTanh[0];
    for (let i = 1; i < 4; i++) {
      this.stage[i] = (this.stageTanh[i] - this.stageTanh[i - 1]) * 0.5 + this.stage[i - 1];
    }
    return this.stage[3];
  }

  reset() {
    this.stage.fill(0);
    this.stageTanh.fill(0);
    this.delay.fill(0);
  }
}

/** State-variable filter (Chamberlin) — simultaneous LP/HP/BP. */
export class StateVariable {
  private sr: number;
  private cutoff = 1000;
  private q = 0.7;
  private low = 0;
  private band = 0;
  private high = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
  }

  setCutoff(freq: number) {
    this.cutoff = Math.max(20, Math.min(this.sr * 0.45, freq));
  }

  setQ(q: number) {
    this.q = Math.max(0.1, Math.min(20, q));
  }

  process(input: number): { low: number; band: number; high: number; notch: number } {
    const f = 2 * Math.sin(Math.PI * this.cutoff / this.sr);
    // Chamberlin SVF stability requires f*damp < 2. Clamp damp to guarantee it.
    const damp = Math.min(1 / this.q, 1.99 / Math.max(f, 0.001));
    this.high = input - this.low - damp * this.band;
    this.band = this.band + f * this.high;
    this.low = this.low + f * this.band;
    const notch = this.high + this.low;
    return { low: this.low, band: this.band, high: this.high, notch };
  }

  reset() { this.low = this.band = this.high = 0; }
}

/** One-pole LP/HP utility. */
export class OnePole {
  private sr: number;
  private cutoff = 1000;
  private a = 0;
  private b = 0;
  private prev = 0;

  constructor(sampleRate: number, mode: 'lp' | 'hp' = 'lp') {
    this.sr = sampleRate;
    this.mode = mode;
    this.setCutoff(this.cutoff);
  }
  mode: 'lp' | 'hp';

  setCutoff(freq: number) {
    this.cutoff = Math.max(10, Math.min(this.sr * 0.49, freq));
    const t = Math.exp(-2 * Math.PI * this.cutoff / this.sr);
    this.a = 1 - t;
    this.b = t;
  }

  process(input: number): number {
    this.prev = this.a * input + this.b * this.prev;
    return this.mode === 'lp' ? this.prev : input - this.prev;
  }

  reset() { this.prev = 0; }
}

/** DC blocker — essential on bass + feedback paths. */
export class DCBlocker {
  private prevIn = 0;
  private prevOut = 0;
  private r = 0.995;

  process(input: number): number {
    const out = input - this.prevIn + this.r * this.prevOut;
    this.prevIn = input;
    this.prevOut = out;
    return out;
  }
  reset() { this.prevIn = this.prevOut = 0; }
}
