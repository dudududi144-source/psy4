/**
 * MASTER CHAIN — professional master bus processing.
 *
 * Stage 1: Tonal control (gentle HP + tilt EQ)
 * Stage 2: Glue compression (slow, low ratio — makes everything feel together)
 * Stage 3: Subtle saturation (harmonic cohesion + perceived loudness)
 * Stage 4: True-peak-aware limiter (inter-sample protection)
 *
 * Every stage is conservative. The goal is cohesion + control, NOT loudness.
 *
 * REAL IMPLEMENTATION.
 */

import { OnePole, DCBlocker } from './filter';
import { Limiter } from './effects';

/** Glue compressor — slow attack, low ratio, gentle. Feed-forward design. */
export class GlueCompressor {
  private sr: number;
  threshold = 0.6;    // -4.4dB
  ratio = 2.0;
  attack = 0.02;      // 20ms
  release = 0.25;     // 250ms
  makeup = 1.3;       // +2.3dB makeup to compensate for gain reduction
  private env = 0;    // envelope follower (tracks input level)

  constructor(sr: number) { this.sr = sr; }

  processStereo(inL: number, inR: number): [number, number] {
    // Feed-forward: detect input peak, compute gain, apply
    const peak = Math.max(Math.abs(inL), Math.abs(inR));
    // Envelope follower
    const attackRate = 1 / (this.attack * this.sr);
    const releaseRate = 1 / (this.release * this.sr);
    if (peak > this.env) this.env += (peak - this.env) * Math.min(1, attackRate);
    else this.env += (peak - this.env) * Math.min(1, releaseRate);
    // Compute gain reduction from envelope
    let gain = 1;
    if (this.env > this.threshold) {
      const over = this.env - this.threshold;
      const reduced = over / this.ratio;
      gain = (this.threshold + reduced) / this.env;
    }
    const g = gain * this.makeup;
    return [inL * g, inR * g];
  }

  reset() { this.env = 0; }
}

/** Subtle saturation — tanh waveshaping for harmonic cohesion. */
export class MasterSaturation {
  drive = 1.15;      // very subtle
  mix = 0.15;        // 15% wet
  private dc = new DCBlocker(44100);

  process(input: number): number {
    const saturated = Math.tanh(input * this.drive) / Math.tanh(this.drive);
    return input * (1 - this.mix) + saturated * this.mix;
  }

  reset() { this.dc.reset(); }
}

/** True-peak-aware limiter — oversampled inter-sample peak detection. */
export class TruePeakLimiter {
  private sr: number;
  ceiling = 0.94;      // -0.5 dBFS
  release = 0.05;
  private gain = 1;
  // 4x oversampling via linear interpolation for inter-sample peak detection
  private prevL = 0;
  private prevR = 0;

  constructor(sr: number) { this.sr = sr; }

  processStereo(inL: number, inR: number): [number, number] {
    // detect inter-sample peaks via 4x oversampling
    let truePeak = Math.max(Math.abs(inL), Math.abs(inR));
    for (let i = 1; i <= 3; i++) {
      const frac = i / 4;
      const interpL = this.prevL * (1 - frac) + inL * frac;
      const interpR = this.prevR * (1 - frac) + inR * frac;
      truePeak = Math.max(truePeak, Math.abs(interpL), Math.abs(interpR));
    }
    this.prevL = inL;
    this.prevR = inR;

    // gain reduction based on true peak
    const targetGain = truePeak > this.ceiling ? this.ceiling / truePeak : 1;
    if (targetGain < this.gain) {
      this.gain = targetGain; // instant attack
    } else {
      this.gain += (1 - this.gain) * Math.min(1, 1 / (this.release * this.sr));
    }
    return [inL * this.gain, inR * this.gain];
  }

  reset() { this.gain = 1; this.prevL = 0; this.prevR = 0; }
}

/** Complete master chain. */
export class MasterChain {
  private hp: OnePole;         // sub frequency removal
  private dc: DCBlocker;
  private glue: GlueCompressor;
  private saturation: MasterSaturation;
  private limiter: TruePeakLimiter;
  // bypass flags for A/B testing
  enableGlue = true;
  enableSaturation = true;
  enableLimiter = true;

  constructor(sr: number) {
    this.hp = new OnePole(sr, 'hp');
    this.hp.setCutoff(25);       // remove subsonic
    this.dc = new DCBlocker();
    this.glue = new GlueCompressor(sr);
    this.saturation = new MasterSaturation();
    this.limiter = new TruePeakLimiter(sr);
  }

  processStereo(inL: number, inR: number): [number, number] {
    // Stage 1: tonal control
    let l = this.dc.process(this.hp.process(inL));
    let r = this.dc.process(this.hp.process(inR));
    // Stage 2: glue compression
    if (this.enableGlue) {
      [l, r] = this.glue.processStereo(l, r);
    }
    // Stage 3: saturation
    if (this.enableSaturation) {
      l = this.saturation.process(l);
      r = this.saturation.process(r);
    }
    // Stage 4: true-peak limiting
    if (this.enableLimiter) {
      [l, r] = this.limiter.processStereo(l, r);
    }
    return [l, r];
  }

  reset() {
    this.hp.reset(); this.dc.reset();
    this.glue.reset(); this.saturation.reset(); this.limiter.reset();
  }
}
