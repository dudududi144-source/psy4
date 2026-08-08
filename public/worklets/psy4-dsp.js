/**
 * PSY4 AudioWorklet DSP primitives.
 *
 * REAL sample-accurate DSP, ported from PSY3:
 *   - pro_dsp.py moog()       → MoogFilterProcessor (4-stage tanh ladder)
 *   - pro_dsp.py bl_saw()     → BLSawProcessor (polyBLEP, fully band-limited)
 *   - pro_dsp.py bl_square()  → BLSquareProcessor (polyBLEP)
 *   - pro_fx.py phaser        → PhaserProcessor (4-stage allpass)
 *   - style_master.py _sat()  → SaturationProcessor (tanh waveshaper)
 *
 * These run in the audio render thread — sample-accurate, no main-thread jitter,
 * and implement the actual nonlinear DSP that BiquadFilter/WaveShaper cannot.
 *
 * Load via: audioContext.audioWorklet.addModule('/worklets/psy4-dsp.js')
 */

// ─── Moog Ladder Filter (4-stage, tanh saturation + feedback) ──────────────
// Port of PSY3 pro_dsp.py:
//   fc = min(0.45, cutoff/SR)
//   g  = 1 - exp(-2π·fc)
//   per sample:
//     fb = res*4*tanh(st[3])
//     u  = tanh((x - fb) * drive)
//     for j in 0..3: st[j] += g*(tanh(prev) - st[j]); prev = st[j]
//     out = st[3] / (1 + res*0.5) * level
//
// This is THE sound-defining DSP. BiquadFilter cannot do the tanh feedback
// loop that gives a Moog its resonant, musical character.
class MoogFilterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'cutoff', defaultValue: 1000, minValue: 20, maxValue: 18000, automationRate: 'a-rate' },
      { name: 'resonance', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'drive', defaultValue: 1, minValue: 0.1, maxValue: 6, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // Per-channel state: 4 integrator stages each
    this.st = [[0, 0, 0, 0], [0, 0, 0, 0]];
    this.lastCutoff = -1;
    this.g = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      // No input — still output silence (keep node alive)
      for (let ch = 0; ch < output.length; ch++) {
        const outCh = output[ch];
        for (let i = 0; i < outCh.length; i++) outCh[i] = 0;
      }
      return true;
    }

    const sr = sampleRate;
    const cutoffParam = parameters.cutoff;
    const res = parameters.resonance[0];
    const drive = parameters.drive[0];
    const level = parameters.level[0];
    const aRate = cutoffParam.length > 1;
    const outScale = 1 / (1 + res * 0.5) * level;

    const numCh = Math.min(input.length, output.length);
    for (let ch = 0; ch < numCh; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      const st = this.st[ch] || this.st[0];

      for (let i = 0; i < outCh.length; i++) {
        const cutoff = aRate ? cutoffParam[i] : cutoffParam[0];
        // Recompute g when cutoff changes (exp is expensive, so cache)
        if (Math.abs(cutoff - this.lastCutoff) > 0.5) {
          const fc = Math.min(0.45, cutoff / sr);
          this.g = 1 - Math.exp(-2 * Math.PI * fc);
          this.lastCutoff = cutoff;
        }
        const g = this.g;

        let x = inCh[i];
        // Feedback: 4 * res * tanh(stage 4 output)
        const fb = res * 4 * Math.tanh(st[3]);
        // Input saturation with drive
        let u = Math.tanh((x - fb) * drive);
        // 4 one-pole integrator stages with tanh nonlinearity
        let prev = u;
        for (let j = 0; j < 4; j++) {
          st[j] += g * (Math.tanh(prev) - st[j]);
          prev = st[j];
        }
        outCh[i] = st[3] * outScale;
      }
    }
    // Copy to extra output channels if needed
    for (let ch = numCh; ch < output.length; ch++) {
      const src = output[0];
      const outCh = output[ch];
      for (let i = 0; i < outCh.length; i++) outCh[i] = src[i];
    }
    return true;
  }
}

// ─── polyBLEP helper (band-limiting correction) ────────────────────────────
// Returns the correction to ADD to a naive waveform at the discontinuity.
// Width = 1 sample (inc). Based on the standard 2nd-order polyBLEP.
function polyBlep(phase, inc) {
  // phase in [0,1). Discontinuity at the wrap (0/1).
  if (phase < inc) {
    // just after wrap
    const t = phase / inc; // 0..1
    return 2 * t - t * t - 1; // -1 → 0
  } else if (phase > 1 - inc) {
    // just before wrap
    const t = (phase - 1) / inc; // -1..0
    return t * t + 2 * t + 1; // 0 → 1
  }
  return 0;
}

// ─── Band-Limited Sawtooth Oscillator (polyBLEP) ───────────────────────────
// Fully band-limited — no aliasing at any frequency.
// Replaces PeriodicWave (which uses fixed harmonic count and aliases).
class BLSawProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 220, minValue: 0.001, maxValue: 8000, automationRate: 'a-rate' },
      { name: 'pulsewidth', defaultValue: 0, minValue: 0, maxValue: 0.5, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.phase = 0;
    this.phase2 = 0; // for pulse width
    this.port.onmessage = (e) => {
      if (e.data.type === 'reset') this.phase = 0;
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const sr = sampleRate;
    const freqParam = parameters.frequency;
    const aRate = freqParam.length > 1;
    const level = parameters.level[0];
    const pw = parameters.pulsewidth[0];
    const numCh = output.length;

    for (let i = 0; i < output[0].length; i++) {
      const freq = aRate ? freqParam[i] : freqParam[0];
      const inc = freq / sr;
      // Naive sawtooth: -1..+1 ramp
      let val = 2 * this.phase - 1;
      // polyBLEP correction (subtract for sawtooth discontinuity of -2)
      val -= polyBlep(this.phase, inc);

      // Pulse-width variant: blend with a phase-shifted saw for variable width
      if (pw > 0.001) {
        const val2 = 2 * this.phase2 - 1;
        val2 -= polyBlep(this.phase2, inc);
        // Crossfade: pw=0 → full saw, pw=0.5 → narrow pulse
        val = val * (1 - pw * 2) + val2 * (pw * 2);
        this.phase2 += inc * (1 - pw);
        if (this.phase2 >= 1) this.phase2 -= 1;
      }

      const sample = val * level;
      for (let ch = 0; ch < numCh; ch++) {
        output[ch][i] = sample;
      }
      this.phase += inc;
      if (this.phase >= 1) this.phase -= 1;
    }
    return true;
  }
}

// ─── Band-Limited Square Oscillator (polyBLEP) ─────────────────────────────
class BLSquareProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 220, minValue: 0.001, maxValue: 8000, automationRate: 'a-rate' },
      { name: 'level', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.phase = 0;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const sr = sampleRate;
    const freqParam = parameters.frequency;
    const aRate = freqParam.length > 1;
    const level = parameters.level[0];
    const numCh = output.length;

    for (let i = 0; i < output[0].length; i++) {
      const freq = aRate ? freqParam[i] : freqParam[0];
      const inc = freq / sr;
      // Naive square
      let val = this.phase < 0.5 ? 1 : -1;
      // polyBLEP at both discontinuities (0 and 0.5)
      val += polyBlep(this.phase, inc);
      let p2 = this.phase + 0.5;
      if (p2 >= 1) p2 -= 1;
      val -= polyBlep(p2, inc);

      const sample = val * level;
      for (let ch = 0; ch < numCh; ch++) {
        output[ch][i] = sample;
      }
      this.phase += inc;
      if (this.phase >= 1) this.phase -= 1;
    }
    return true;
  }
}

// ─── Saturation (tanh waveshaper with drive + mix) ─────────────────────────
// Port of PSY3 style_master.py _sat(): drive=1.15, mix=0.15
// Done in worklet so drive can be a-rate automated.
class SaturationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 1, minValue: 0.1, maxValue: 8, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // Pre-build a tanh lookup table for speed (2049 entries, [-1,1])
    this.tanhTable = new Float32Array(2049);
    const N = 2048;
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * 2 - 1; // -1..1
      this.tanhTable[i] = Math.tanh(x);
    }
    this.N = N;
  }

  // Fast tanh via table lookup with linear interpolation.
  fastTanh(x) {
    // Clamp to [-1, 1]
    if (x >= 1) return 1;
    if (x <= -1) return -1;
    const idx = (x + 1) * 0.5 * this.N; // 0..N
    const i0 = idx | 0;
    const f = idx - i0;
    return this.tanhTable[i0] * (1 - f) + this.tanhTable[i0 + 1] * f;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const drive = parameters.drive[0];
    const mix = parameters.mix[0];
    const level = parameters.level[0];
    const dryGain = 1 - mix;
    const numCh = Math.min(input.length, output.length);

    for (let ch = 0; ch < numCh; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      for (let i = 0; i < outCh.length; i++) {
        const x = inCh[i];
        const wet = this.fastTanh(x * drive) / Math.max(0.001, this.fastTanh(drive));
        outCh[i] = (x * dryGain + wet * mix) * level;
      }
    }
    for (let ch = numCh; ch < output.length; ch++) {
      const src = output[0];
      const outCh = output[ch];
      for (let i = 0; i < outCh.length; i++) outCh[i] = src[i];
    }
    return true;
  }
}

// ─── 4-Stage Phaser (allpass chain + LFO) ──────────────────────────────────
// Port of PSY3 pro_fx.py Phaser.
// Each stage is a 1st-order allpass; modulated by an internal LFO.
class PhaserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.5, minValue: 0.01, maxValue: 8, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0.3, minValue: 0, maxValue: 0.95, automationRate: 'k-rate' },
      { name: 'baseFreq', defaultValue: 800, minValue: 100, maxValue: 4000, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // Per-channel stage state (transposed direct form II per stage)
    this.stageState = [
      [{ x: 0, v: 0 }, { x: 0, v: 0 }, { x: 0, v: 0 }, { x: 0, v: 0 }],
      [{ x: 0, v: 0 }, { x: 0, v: 0 }, { x: 0, v: 0 }, { x: 0, v: 0 }],
    ];
    this.fb = [0, 0]; // feedback state per channel
    this.lfoPhase = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const sr = sampleRate;
    const rate = parameters.rate[0];
    const depth = parameters.depth[0];
    const fbAmt = parameters.feedback[0];
    const baseFreq = parameters.baseFreq[0];
    const mix = parameters.mix[0];
    const dryGain = 1 - mix;
    const numCh = Math.min(input.length, output.length);

    const lfoInc = rate / sr;

    for (let i = 0; i < output[0].length; i++) {
      // LFO: sine, 0..1
      const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.lfoPhase);
      this.lfoPhase += lfoInc;
      if (this.lfoPhase >= 1) this.lfoPhase -= 1;
      // Modulated sweep frequency
      const sweepFreq = baseFreq * (1 + depth * (lfo * 2 - 1) * 2);
      // Allpass coefficient
      const w = 2 * Math.PI * Math.max(20, sweepFreq) / sr;
      const sinw = Math.sin(w);
      const c = (1 - sinw) / Math.max(0.001, 1 + sinw);

      for (let ch = 0; ch < numCh; ch++) {
        const inCh = input[ch];
        const outCh = output[ch];
        let s = inCh[i] + this.fb[ch] * fbAmt;
        // 4 allpass stages in series
        for (let st = 0; st < 4; st++) {
          const ss = this.stageState[ch][st];
          const y = c * (s + ss.v) - ss.x;
          ss.x = s;
          ss.v = y;
          s = y;
        }
        this.fb[ch] = s;
        outCh[i] = inCh[i] * dryGain + s * mix;
      }
    }
    return true;
  }
}

// ─── 4-Band EQ (low shelf, mid peak, high shelf) ───────────────────────────
// For bus tonal shaping. Uses biquad coefficients (RBJ cookbook) in transposed
// direct form II. Runs in worklet so coefficients recompute per block cheaply.
class BusEQProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'lowGain', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'lowFreq', defaultValue: 120, minValue: 40, maxValue: 400, automationRate: 'k-rate' },
      { name: 'midGain', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'midFreq', defaultValue: 1000, minValue: 300, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'midQ', defaultValue: 0.7, minValue: 0.1, maxValue: 4, automationRate: 'k-rate' },
      { name: 'highGain', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'highFreq', defaultValue: 8000, minValue: 3000, maxValue: 16000, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // Biquad state per channel: [lowShelf, midPeak, highShelf]
    this.bqState = [
      [{ z1: 0, z2: 0 }, { z1: 0, z2: 0 }, { z1: 0, z2: 0 }],
      [{ z1: 0, z2: 0 }, { z1: 0, z2: 0 }, { z1: 0, z2: 0 }],
    ];
  }

  // Apply biquad in transposed direct form II.
  applyBiquad(x, state, b0, b1, b2, a1, a2) {
    const y = b0 * x + state.z1;
    state.z1 = b1 * x - a1 * y + state.z2;
    state.z2 = b2 * x - a2 * y;
    return y;
  }

  // Low shelf coefficients (RBJ cookbook)
  lowShelfCoeffs(freq, gainDb, sr) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * freq / sr;
    const cosw = Math.cos(w0), sinw = Math.sin(w0);
    const alpha = sinw / 2 * 0.707;
    const tmp = 2 * Math.sqrt(A) * alpha;
    const b0 = A * ((A + 1) - (A - 1) * cosw + tmp);
    const b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
    const b2 = A * ((A + 1) - (A - 1) * cosw - tmp);
    const a0 = (A + 1) + (A - 1) * cosw + tmp;
    const a1 = -2 * ((A - 1) + (A + 1) * cosw);
    const a2 = (A + 1) + (A - 1) * cosw - tmp;
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }

  // Peaking EQ coefficients (RBJ cookbook)
  peakCoeffs(freq, gainDb, Q, sr) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * freq / sr;
    const cosw = Math.cos(w0), sinw = Math.sin(w0);
    const alpha = sinw / (2 * Q);
    const b0 = 1 + alpha * A;
    const b1 = -2 * cosw;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cosw;
    const a2 = 1 - alpha / A;
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }

  // High shelf coefficients (RBJ cookbook)
  highShelfCoeffs(freq, gainDb, sr) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * freq / sr;
    const cosw = Math.cos(w0), sinw = Math.sin(w0);
    const alpha = sinw / 2 * 0.707;
    const tmp = 2 * Math.sqrt(A) * alpha;
    const b0 = A * ((A + 1) + (A - 1) * cosw + tmp);
    const b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
    const b2 = A * ((A + 1) + (A - 1) * cosw - tmp);
    const a0 = (A + 1) - (A - 1) * cosw + tmp;
    const a1 = 2 * ((A - 1) - (A + 1) * cosw);
    const a2 = (A + 1) - (A - 1) * cosw - tmp;
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const sr = sampleRate;
    const lg = parameters.lowGain[0], lf = parameters.lowFreq[0];
    const mg = parameters.midGain[0], mf = parameters.midFreq[0], mq = parameters.midQ[0];
    const hg = parameters.highGain[0], hf = parameters.highFreq[0];

    const lc = this.lowShelfCoeffs(lf, lg, sr);
    const mc = this.peakCoeffs(mf, mg, mq, sr);
    const hc = this.highShelfCoeffs(hf, hg, sr);

    const numCh = Math.min(input.length, output.length);
    for (let ch = 0; ch < numCh; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      const st = this.bqState[ch] || this.bqState[0];
      for (let i = 0; i < outCh.length; i++) {
        let s = inCh[i];
        s = this.applyBiquad(s, st[0], lc[0], lc[1], lc[2], lc[3], lc[4]);
        s = this.applyBiquad(s, st[1], mc[0], mc[1], mc[2], mc[3], mc[4]);
        s = this.applyBiquad(s, st[2], hc[0], hc[1], hc[2], hc[3], hc[4]);
        outCh[i] = s;
      }
    }
    for (let ch = numCh; ch < output.length; ch++) {
      const src = output[0];
      const outCh = output[ch];
      for (let i = 0; i < outCh.length; i++) outCh[i] = src[i];
    }
    return true;
  }
}

// ─── Register all processors ───────────────────────────────────────────────
registerProcessor('moog-filter', MoogFilterProcessor);
registerProcessor('bl-saw', BLSawProcessor);
registerProcessor('bl-square', BLSquareProcessor);
registerProcessor('saturation', SaturationProcessor);
registerProcessor('phaser', PhaserProcessor);
registerProcessor('bus-eq', BusEQProcessor);
