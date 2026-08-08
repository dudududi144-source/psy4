/**
 * STEREO ENGINE — frequency-aware stereo width with mono low-end.
 *
 * Architecture:
 *   - Low frequencies (<120Hz) stay MONO (kick/bass/sub)
 *   - Mid frequencies get controlled width per channel
 *   - High frequencies can be wider
 *
 * Uses Mid/Side processing: extract Mid (L+R) and Side (L-R), apply width
 * gain to Side, but ONLY above the crossover frequency. Below crossover,
 * Side = 0 (forced mono).
 *
 * REAL IMPLEMENTATION.
 */

import { OnePole } from './filter';

export interface StereoProfile {
  pan: number;         // -1..1
  width: number;       // 0..1 (0 = mono, 1 = full stereo)
  depth: number;       // 0..1 (0 = front, 1 = back)
}

export const STEREO_PROFILES: Record<string, StereoProfile> = {
  kick:      { pan: 0,    width: 0,    depth: 0 },    // dead center, mono, front
  bass:      { pan: 0,    width: 0,    depth: 0 },    // dead center, mono, front
  snare:     { pan: 0,    width: 0.2,  depth: 0.1 },  // near center
  clap:      { pan: 0,    width: 0.3,  depth: 0.2 },
  hat:       { pan: 0.1,  width: 0.5,  depth: 0.3 },  // moderate width
  shaker:    { pan: -0.1, width: 0.6,  depth: 0.4 },  // wider
  percussion:{ pan: 0.15, width: 0.4,  depth: 0.3 },
  lead:      { pan: -0.1, width: 0.4,  depth: 0.2 },  // controlled width
  pad:       { pan: 0.1,  width: 0.7,  depth: 0.5 },  // wide
  texture:   { pan: -0.15,width: 0.8,  depth: 0.7 },  // very wide
  atmosphere:{ pan: 0,    width: 0.9,  depth: 0.9 },  // widest, back
  fx:        { pan: 0,    width: 0.85, depth: 0.8 },  // wide, moving
};

/** Stereo widener with frequency-aware mono bass. */
export class StereoEngine {
  private sr: number;
  private crossoverFreq: number;  // below this = mono
  private midLp: OnePole;         // LP for mid (low frequencies)
  private sideLp: OnePole;        // LP for side (low frequencies to remove)
  private widthGain = 1;          // current width multiplier (for smooth changes)

  constructor(sr: number, crossoverHz = 120) {
    this.sr = sr;
    this.crossoverFreq = crossoverHz;
    this.midLp = new OnePole(sr, 'lp');
    this.midLp.setCutoff(crossoverHz);
    this.sideLp = new OnePole(sr, 'lp');
    this.sideLp.setCutoff(crossoverHz);
  }

  /** Process a stereo sample pair with width control.
   *  width: 0 = mono, 1 = full stereo, >1 = widened (limited to 1.5) */
  processWidth(inL: number, inR: number, width: number): [number, number] {
    const w = Math.max(0, Math.min(1.5, width * this.widthGain));
    // Mid/Side encoding
    const mid = (inL + inR) * 0.5;
    const side = (inL - inR) * 0.5;
    // Below crossover: force mono (remove side from low frequencies)
    const sideLow = this.sideLp.process(side);   // low-freq side component
    const sideHigh = side - sideLow;              // high-freq side component
    // Apply width only to high-freq side; low-freq side = 0 (mono)
    const processedSide = sideHigh * w;
    // Mid/Side decoding
    const outL = mid + processedSide;
    const outR = mid - processedSide;
    return [outL, outR];
  }

  /** Check mono compatibility — sum to mono and check for cancellation. */
  static checkMonoCompatibility(left: Float32Array, right: Float32Array): {
    monoEnergy: number;
    stereoEnergy: number;
    correlation: number;
    monoSafe: boolean;
  } {
    let monoE = 0, stereoE = 0, sumLR = 0, sumL = 0, sumR = 0, sumL2 = 0, sumR2 = 0;
    const n = Math.min(left.length, right.length);
    for (let i = 0; i < n; i++) {
      const l = left[i], r = right[i];
      monoE += ((l + r) * 0.5) ** 2;
      stereoE += l * l + r * r;
      sumLR += l * r; sumL += l; sumR += r;
      sumL2 += l * l; sumR2 += r * r;
    }
    const ml = sumL / n, mr = sumR / n;
    const cov = sumLR / n - ml * mr;
    const sl = Math.sqrt(Math.max(0, sumL2 / n - ml * ml));
    const sr = Math.sqrt(Math.max(0, sumR2 / n - mr * mr));
    const corr = (sl > 0 && sr > 0) ? cov / (sl * sr) : 0;
    return {
      monoEnergy: monoE / n,
      stereoEnergy: stereoE / n,
      correlation: Math.max(-1, Math.min(1, corr)),
      monoSafe: corr > 0,  // positive correlation = mono safe
    };
  }

  reset() {
    this.midLp.reset();
    this.sideLp.reset();
    this.widthGain = 1;
  }

  setWidthGain(g: number) {
    this.widthGain = Math.max(0, Math.min(1.5, g));
  }
}
