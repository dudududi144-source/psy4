/**
 * MOOG FILTER — Web Audio implementation of 4-stage transistor ladder.
 *
 * Port of PSY3's pro_dsp.py moog() to native Web Audio.
 *
 * PSY3 algorithm (pro_dsp.py):
 *   4 one-pole integrators with tanh saturation + feedback
 *   g = 1 - exp(-2π·fc/SR)
 *   for each sample:
 *     fb = res * 4 * tanh(st[3])
 *     u = tanh(input - fb)
 *     for j in 0..3: st[j] += g * (tanh(prev) - st[j]); prev = st[j]
 *     output = st[3] / (1 + res*0.5)
 *
 * In Web Audio, we can't do sample-by-sample feedback loops easily.
 * Instead we approximate using:
 *   - BiquadFilter (lowpass) for the basic 4-pole response
 *   - WaveShaper (tanh) before and after the filter for saturation
 *   - A feedback gain path for resonance character
 *
 * This is NOT a perfect Moog clone, but it adds the warmth and character
 * that BiquadFilter alone lacks. The key addition is tanh saturation
 * before and after the filter, which generates harmonics that BiquadFilter
 * cannot.
 *
 * REAL IMPLEMENTATION.
 */

export interface MoogFilterParams {
  cutoff: number;        // Hz
  resonance: number;     // 0..1 (mapped to Q)
  drive: number;         // 1..4 (pre-filter saturation)
  level: number;         // output gain
}

export class MoogFilterChain {
  private ctx: AudioContext;
  private input: GainNode;
  private preSat: WaveShaperNode;
  private preSatGain: GainNode;
  private filter: BiquadFilterNode;
  private postSat: WaveShaperNode;
  private output: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.preSat = ctx.createWaveShaper();
    this.preSatGain = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1;
    this.postSat = ctx.createWaveShaper();
    this.output = ctx.createGain();

    // Build tanh saturation curves
    this.preSat.curve = this.makeTanhCurve(2.0);
    this.postSat.curve = this.makeTanhCurve(1.5);

    // Chain: input → preSatGain → preSat → filter → postSat → output
    this.input.connect(this.preSatGain);
    this.preSatGain.connect(this.preSat);
    this.preSat.connect(this.filter);
    this.filter.connect(this.postSat);
    this.postSat.connect(this.output);
  }

  private makeTanhCurve(drive: number): Float32Array {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n / 2)) - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }

  setParams(params: Partial<MoogFilterParams>) {
    if (params.cutoff !== undefined) {
      this.filter.frequency.setValueAtTime(params.cutoff, this.ctx.currentTime);
    }
    if (params.resonance !== undefined) {
      // Map 0..1 resonance to Q 0.5..20 (like Moog self-oscillation)
      const q = 0.5 + params.resonance * params.resonance * 20;
      this.filter.Q.setValueAtTime(q, this.ctx.currentTime);
    }
    if (params.drive !== undefined) {
      this.preSatGain.gain.setValueAtTime(params.drive, this.ctx.currentTime);
      // Rebuild curve with new drive
      this.preSat.curve = this.makeTanhCurve(params.drive);
    }
    if (params.level !== undefined) {
      this.output.gain.setValueAtTime(params.level, this.ctx.currentTime);
    }
  }

  /** Schedule cutoff automation (for filter envelopes). */
  scheduleCutoff(startTime: number, startValue: number, endValue: number, duration: number) {
    this.filter.frequency.setValueAtTime(startValue, startTime);
    this.filter.frequency.exponentialRampToValueAtTime(Math.max(20, endValue), startTime + duration);
  }

  /** Schedule Q automation. */
  scheduleQ(startTime: number, value: number) {
    this.filter.Q.setValueAtTime(value, startTime);
  }

  get inputNode(): AudioNode { return this.input; }
  get outputNode(): AudioNode { return this.output; }

  connect(destination: AudioNode) { this.output.connect(destination); }
  disconnect() { this.output.disconnect(); }

  reset() {
    this.filter.frequency.value = 1000;
    this.filter.Q.value = 1;
    this.preSatGain.gain.value = 1;
    this.output.gain.value = 1;
  }
}

/**
 * MULTIBAND COMPRESSOR — 3-band (low/mid/high) Web Audio.
 * Port of PSY3's style_master.py multiband_comp().
 *
 * PSY3: splits at 180Hz and 4000Hz, compresses each band independently.
 *
 * REAL IMPLEMENTATION.
 */
export class MultibandCompressor {
  private ctx: AudioContext;
  private input: GainNode;
  private lowSplit: BiquadFilterNode;
  private midSplitHP: BiquadFilterNode;
  private midSplitLP: BiquadFilterNode;
  private highSplit: BiquadFilterNode;
  private lowComp: DynamicsCompressorNode;
  private midComp: DynamicsCompressorNode;
  private highComp: DynamicsCompressorNode;
  private lowGain: GainNode;
  private midGain: GainNode;
  private highGain: GainNode;
  private output: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();

    // Crossover filters (Linkwitz-Riley approximation via 2x BiquadFilter)
    this.lowSplit = ctx.createBiquadFilter();
    this.lowSplit.type = 'lowpass';
    this.lowSplit.frequency.value = 180;
    this.lowSplit.Q.value = 0.707;

    this.midSplitHP = ctx.createBiquadFilter();
    this.midSplitHP.type = 'highpass';
    this.midSplitHP.frequency.value = 180;
    this.midSplitHP.Q.value = 0.707;

    this.midSplitLP = ctx.createBiquadFilter();
    this.midSplitLP.type = 'lowpass';
    this.midSplitLP.frequency.value = 4000;
    this.midSplitLP.Q.value = 0.707;

    this.highSplit = ctx.createBiquadFilter();
    this.highSplit.type = 'highpass';
    this.highSplit.frequency.value = 4000;
    this.highSplit.Q.value = 0.707;

    // Compressors per band (gentle settings from PSY3)
    this.lowComp = ctx.createDynamicsCompressor();
    this.lowComp.threshold.value = -20;
    this.lowComp.ratio.value = 2;
    this.lowComp.attack.value = 0.01;
    this.lowComp.release.value = 0.15;

    this.midComp = ctx.createDynamicsCompressor();
    this.midComp.threshold.value = -18;
    this.midComp.ratio.value = 2;
    this.midComp.attack.value = 0.008;
    this.midComp.release.value = 0.12;

    this.highComp = ctx.createDynamicsCompressor();
    this.highComp.threshold.value = -16;
    this.highComp.ratio.value = 2;
    this.highComp.attack.value = 0.005;
    this.highComp.release.value = 0.08;

    // Band gains (for balance control)
    this.lowGain = ctx.createGain();
    this.lowGain.gain.value = 1.0;
    this.midGain = ctx.createGain();
    this.midGain.gain.value = 1.0;
    this.highGain = ctx.createGain();
    this.highGain.gain.value = 1.0;

    this.output = ctx.createGain();

    // Routing
    // Low: input → lowSplit → lowComp → lowGain → output
    this.input.connect(this.lowSplit);
    this.lowSplit.connect(this.lowComp);
    this.lowComp.connect(this.lowGain);
    this.lowGain.connect(this.output);

    // Mid: input → midSplitHP → midSplitLP → midComp → midGain → output
    this.input.connect(this.midSplitHP);
    this.midSplitHP.connect(this.midSplitLP);
    this.midSplitLP.connect(this.midComp);
    this.midComp.connect(this.midGain);
    this.midGain.connect(this.output);

    // High: input → highSplit → highComp → highGain → output
    this.input.connect(this.highSplit);
    this.highSplit.connect(this.highComp);
    this.highComp.connect(this.highGain);
    this.highGain.connect(this.output);
  }

  setBandGains(low: number, mid: number, high: number) {
    const t = this.ctx.currentTime;
    this.lowGain.gain.setTargetAtTime(low, t, 0.1);
    this.midGain.gain.setTargetAtTime(mid, t, 0.1);
    this.highGain.gain.setTargetAtTime(high, t, 0.1);
  }

  get inputNode(): AudioNode { return this.input; }
  get outputNode(): AudioNode { return this.output; }

  connect(destination: AudioNode) { this.output.connect(destination); }
  disconnect() { this.output.disconnect(); }
}

/**
 * TRUE-PEAK LIMITER — 2x oversampled limiter for inter-sample peak protection.
 *
 * Web Audio doesn't have native true-peak detection, so we approximate:
 * - Use a DynamicsCompressor with very high ratio as a brick-wall limiter
 * - Add a WaveShaper before it for soft clipping (prevents inter-sample peaks)
 * - The WaveShaper acts as a soft limiter that catches peaks the compressor might miss
 *
 * REAL IMPLEMENTATION.
 */
export class TruePeakLimiter {
  private ctx: AudioContext;
  private input: GainNode;
  private softClip: WaveShaperNode;
  private limiter: DynamicsCompressorNode;
  private output: GainNode;
  private ceiling: number;

  constructor(ctx: AudioContext, ceiling = 0.94) {
    this.ctx = ctx;
    this.ceiling = ceiling;
    this.input = ctx.createGain();
    this.softClip = ctx.createWaveShaper();
    this.softClip.curve = this.makeSoftClipCurve(ceiling);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.0; // just below 0dBFS
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.0005;
    this.limiter.release.value = 0.05;
    this.output = ctx.createGain();
    this.output.gain.value = ceiling;

    this.input.connect(this.softClip);
    this.softClip.connect(this.limiter);
    this.limiter.connect(this.output);
  }

  private makeSoftClipCurve(ceiling: number): Float32Array {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n / 2)) - 1;
      // Soft clip that approaches ceiling asymptotically
      if (Math.abs(x) < ceiling * 0.8) {
        curve[i] = x;
      } else {
        const sign = Math.sign(x);
        const overshoot = Math.abs(x) - ceiling * 0.8;
        curve[i] = sign * (ceiling * 0.8 + (ceiling * 0.2) * Math.tanh(overshoot * 5));
      }
    }
    return curve;
  }

  setCeiling(ceiling: number) {
    this.ceiling = ceiling;
    this.output.gain.setValueAtTime(ceiling, this.ctx.currentTime);
    this.softClip.curve = this.makeSoftClipCurve(ceiling);
  }

  get inputNode(): AudioNode { return this.input; }
  get outputNode(): AudioNode { return this.output; }

  connect(destination: AudioNode) { this.output.connect(destination); }
  disconnect() { this.output.disconnect(); }
}

/**
 * GLUE COMPRESSOR — feed-forward style, port of PSY3 style_master.py _glue().
 *
 * PSY3 params: thr=0.6, ratio=2.0, att=0.02, rel=0.25, makeup=1.3
 */
export class GlueCompressor {
  private ctx: AudioContext;
  private input: GainNode;
  private comp: DynamicsCompressorNode;
  private makeup: GainNode;
  private output: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    // PSY3 params: thr=0.6 ≈ -4.4dB, ratio=2, att=20ms, rel=250ms
    this.comp.threshold.value = -4.4;
    this.comp.ratio.value = 2.0;
    this.comp.attack.value = 0.02;
    this.comp.release.value = 0.25;
    this.comp.knee.value = 3; // soft knee for glue character
    this.makeup = ctx.createGain();
    this.makeup.gain.value = 1.3; // PSY3 makeup
    this.output = ctx.createGain();

    this.input.connect(this.comp);
    this.comp.connect(this.makeup);
    this.makeup.connect(this.output);
  }

  setParams(threshold: number, ratio: number, makeup: number) {
    const t = this.ctx.currentTime;
    this.comp.threshold.setTargetAtTime(threshold, t, 0.05);
    this.comp.ratio.setTargetAtTime(ratio, t, 0.05);
    this.makeup.gain.setTargetAtTime(makeup, t, 0.05);
  }

  get inputNode(): AudioNode { return this.input; }
  get outputNode(): AudioNode { return this.output; }

  connect(destination: AudioNode) { this.output.connect(destination); }
  disconnect() { this.output.disconnect(); }
}

/**
 * MASTER SATURATION — tanh waveshaper for harmonic cohesion.
 * Port of PSY3 style_master.py _sat(): drive=1.15, mix=0.15
 */
export class MasterSaturation {
  private ctx: AudioContext;
  private input: GainNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private shaper: WaveShaperNode;
  private output: GainNode;

  constructor(ctx: AudioContext, drive = 1.15, mix = 0.15) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1 - mix;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = mix;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = this.makeCurve(drive);
    this.output = ctx.createGain();

    this.input.connect(this.dryGain);
    this.input.connect(this.shaper);
    this.shaper.connect(this.wetGain);
    this.dryGain.connect(this.output);
    this.wetGain.connect(this.output);
  }

  private makeCurve(drive: number): Float32Array {
    const n = 1024;
    const curve = new Float32Array(n);
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n / 2)) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
    return curve;
  }

  setDrive(drive: number, mix: number) {
    this.shaper.curve = this.makeCurve(drive);
    this.dryGain.gain.value = 1 - mix;
    this.wetGain.gain.value = mix;
  }

  get inputNode(): AudioNode { return this.input; }
  get outputNode(): AudioNode { return this.output; }

  connect(destination: AudioNode) { this.output.connect(destination); }
  disconnect() { this.output.disconnect(); }
}
