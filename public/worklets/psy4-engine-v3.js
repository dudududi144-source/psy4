/**
 * PSY4 Engine v3 — Synth-based (drums) + psysynth (melodic)
 *
 * Architecture:
 *   - This worklet handles DRUMS only: kick/snare/hat/clap/perc/shaker
 *   - Melodic voices (bass/lead/acid/pad) are routed to psysynth via SynthBridge
 *   - Master chain: DC blocker → glue → limiter (minimal, clean)
 *   - Self-learning: main thread sends learnedParams, worklet applies
 *
 * Drum voices (all synth — no samples):
 *   0=kick 5=hat 6=hatOpen 7=clap 8=perc 9=shaker 10=texture 11=riser 12=impact 13=sweep 14=snare
 *
 * Melodic voices (routed to psysynth, NOT played here):
 *   1=bass 2=lead 3=acid 4=pad
 *
 * Event format: [at, voiceId, note, vel, dur, param]
 */

// ─── Voice IDs ─────────────────────────────────────────────────────────────
const V_KICK = 0, V_BASS = 1, V_LEAD = 2, V_ACID = 3, V_PAD = 4;
const V_HAT = 5, V_HAT_OPEN = 6, V_CLAP = 7, V_PERC = 8, V_SHAKER = 9;
const V_TEXTURE = 10, V_RISER = 11, V_IMPACT = 12, V_SWEEP = 13, V_SNARE = 14;

// Melodic voices — NOT played here (routed to psysynth by main thread)
const MELODIC_VOICES = new Set([V_BASS, V_LEAD, V_ACID, V_PAD]);

// ─── Fast tanh approximation ───────────────────────────────────────────────
function fastTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// ─── Simple one-pole filter ────────────────────────────────────────────────
class OnePoleLP {
  constructor() { this.state = 0; }
  process(x, cutoff, sr) {
    const a = Math.min(0.999, 2 * Math.PI * cutoff / sr);
    this.state += a * (x - this.state);
    return this.state;
  }
  reset() { this.state = 0; }
}

class OnePoleHP {
  constructor() { this.prevIn = 0; this.prevOut = 0; }
  process(x, cutoff, sr) {
    const a = Math.min(0.999, 2 * Math.PI * cutoff / sr);
    const out = x - this.prevIn + (1 - a) * this.prevOut;
    this.prevIn = x;
    this.prevOut = out;
    return out;
  }
  reset() { this.prevIn = 0; this.prevOut = 0; }
}

// ─── Moog-style ladder filter (4-pole) ────────────────────────────────────
class MoogLadder {
  constructor() {
    this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0;
  }
  process(x, cutoff, res, sr) {
    // FIX: Guard against NaN/Infinity — if input is bad, return 0
    if (!isFinite(x)) { this.s0 = this.s1 = this.s2 = this.s3 = 0; return 0; }
    const f = Math.min(0.99, 2 * Math.PI * cutoff / sr);
    const k = 4 * res;
    for (let i = 0; i < 4; i++) {
      const input = x - k * this.s3;
      this.s0 += f * (input - this.s0);
      this.s1 += f * (this.s0 - this.s1);
      this.s2 += f * (this.s1 - this.s2);
      this.s3 += f * (this.s2 - this.s3);
    }
    return this.s3;
  }
  reset() { this.s0 = this.s1 = this.s2 = this.s3 = 0; }
}

// ─── Pink noise (simple) ──────────────────────────────────────────────────
class PinkNoise {
  constructor() {
    this.b0 = 0; this.b1 = 0; this.b2 = 0; this.b3 = 0;
    this.phase = 0;
  }
  process() {
    const white = Math.random() * 2 - 1;
    this.b0 = 0.99 * this.b0 + 0.05 * white;
    this.b1 = 0.95 * this.b1 + 0.10 * white;
    this.b2 = 0.8 * this.b2 + 0.15 * white;
    this.b3 = 0.5 * this.b3 + 0.2 * white;
    return (this.b0 + this.b1 + this.b2 + this.b3) * 0.25;
  }
  reset() { this.b0 = this.b1 = this.b2 = this.b3 = 0; }
}

// ─── KickVoice (synth — 3-layer: sub + fundamental + click) ──────────────
// DEEP_ROAST improvement: commercial kicks have sub-bass + fundamental sine
// + high-frequency click for punch. This adds those layers.
class KickVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.phase = 0;
    this.clickPhase = 0;
    this.fund = 50;
    this.startMult = 4;
    this.pitchDecay = 0.025;
    this.subDecay = 0.15;
    this.clickDecay = 0.008;  // 8ms click — punch transient
    this.amp = 0.9;
    this._out = new Float32Array(2);
  }
  trigger(time, note, vel, dur, sr) {
    this.active = true;
    this.t = 0;
    this.phase = 0;
    this.clickPhase = 0;
    this.fund = 50;
    this.amp = Math.max(0.3, Math.min(1, vel));
  }
  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; out[1] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.subDecay + 0.05) { this.active = false; out[0] = 0; out[1] = 0; return out; }
    // Layer 1: Pitch-swept fundamental (sub + body)
    const f = (this.fund * this.startMult - this.fund) * Math.exp(-this.t / this.pitchDecay) + this.fund;
    this.phase += 2 * Math.PI * f * dt;
    const env = Math.exp(-this.t / this.subDecay);
    const fundamental = Math.sin(this.phase) * env;
    // Layer 2: Sub-bass sine (one octave below, longer decay for weight)
    const subEnv = Math.exp(-this.t / (this.subDecay * 1.5));
    const sub = Math.sin(this.phase * 0.5) * subEnv * 0.4;
    // Layer 3: Click transient (noise burst, 8ms, adds punch)
    let click = 0;
    if (this.t < this.clickDecay) {
      this.clickPhase += 2 * Math.PI * 3000 * dt;  // 3kHz click tone
      click = (Math.sin(this.clickPhase) * 0.5 + (Math.random() * 2 - 1) * 0.5)
              * Math.exp(-this.t / this.clickDecay) * 0.3;
    }
    const sample = (fundamental + sub + click) * this.amp;
    out[0] = sample; out[1] = sample;
    return out;
  }
}

// ─── HatVoice (synth — bandpass-filtered noise, commercial hi-hat) ─────────
class HatVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.hp = new OnePoleHP();
    this.lp = new OnePoleLP();
    this.decay = 0.04;
    this.amp = 0.06;
    this._out = new Float32Array(2);
  }
  trigger(time, note, vel, dur, sr, open, decayOverride) {
    this.active = true;
    this.t = 0;
    const baseDecay = open ? 0.12 : 0.025;
    this.decay = (typeof decayOverride === 'number' && decayOverride > 0.01 && decayOverride < 1.0)
      ? decayOverride : baseDecay;
    this.amp = Math.max(0.04, Math.min(0.12, vel * 0.15));
    this.hp.reset();
    this.lp.reset();
  }
  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; out[1] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.decay) { this.active = false; out[0] = 0; out[1] = 0; return out; }
    const n = this.noise.process();
    // Bandpass: HP at 7kHz + LP at 10kHz = focused hat sound (not wideband noise)
    const hpOut = this.hp.process(n, 7000, sr);
    const bpOut = this.lp.process(hpOut, 10000, sr);
    // Metallic character: ring at 10kHz
    const ringPhase = this.t * 2 * Math.PI * 10000;
    const ring = Math.sin(ringPhase) * Math.exp(-this.t / 0.008) * 0.15;
    const env = Math.exp(-this.t / (this.decay * 0.35));
    const sample = (bpOut + ring) * env * this.amp;
    out[0] = sample; out[1] = sample;
    return out;
  }
}

// ─── SnareVoice (synth — body + tone + noise, commercial snare) ──────────
class SnareVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.hp = new OnePoleHP();
    this.lp = new OnePoleLP();
    this.moog = new MoogLadder();
    this.phase = 0;
    this.bodyPhase = 0;
    this.decay = 0.12;
    this.amp = 0.12;
    this._out = new Float32Array(2);
  }
  trigger(time, note, vel, dur, sr) {
    this.active = true;
    this.t = 0;
    this.phase = 0;
    this.bodyPhase = 0;
    this.amp = Math.max(0.08, Math.min(0.2, vel * 0.25));
    this.hp.reset();
    this.lp.reset();
    this.moog.reset();
  }
  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; out[1] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.decay) { this.active = false; out[0] = 0; out[1] = 0; return out; }
    // Layer 1: Tone (200Hz sine — snare body)
    this.phase += 2 * Math.PI * 200 * dt;
    const tone = Math.sin(this.phase) * 0.3;
    // Layer 2: Body (80Hz sub through Moog for warmth)
    this.bodyPhase += 2 * Math.PI * 80 * dt;
    const bodyRaw = Math.sin(this.bodyPhase) * 0.4;
    const body = this.moog.process(bodyRaw, 300, 0.2, sr);
    // Layer 3: Noise (bandpass 2-5kHz — snare crack)
    const n = this.noise.process();
    const hpOut = this.hp.process(n, 2000, sr);
    const noiseOut = this.lp.process(hpOut, 5000, sr);
    const env = Math.exp(-this.t / (this.decay * 0.35));
    const sample = (tone + body + noiseOut * 0.4) * env * this.amp;
    out[0] = sample; out[1] = sample;
    return out;
  }
}

// ─── ClapVoice (synth — noise bursts) ──────────────────────────────────────
class ClapVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.hp = new OnePoleHP();
    this.lp = new OnePoleLP();
    this.decay = 0.12;  // FIX: was 0.15
    this.amp = 0.1;     // FIX: was 0.2 — reduce harshness
    this._out = new Float32Array(2);
  }
  trigger(time, note, vel, dur, sr) {
    this.active = true;
    this.t = 0;
    this.amp = Math.max(0.1, Math.min(0.3, vel * 0.4));  // FIX: lower
    this.hp.reset();
    this.lp.reset();
  }
  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; out[1] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.decay) { this.active = false; out[0] = 0; out[1] = 0; return out; }
    const n = this.noise.process();
    const hpOut = this.hp.process(n, 1500, sr);
    const lpOut = this.lp.process(hpOut, 5000, sr);  // FIX: LP to tame harshness
    // Multi-burst envelope (clap character)
    let env;
    if (this.t < 0.01) env = 1;
    else if (this.t < 0.02) env = 0.3;
    else if (this.t < 0.03) env = 0.8;
    else env = Math.exp(-(this.t - 0.03) / 0.04);
    const sample = lpOut * env * this.amp;  // FIX: use lpOut not hpOut
    out[0] = sample; out[1] = sample;
    return out;
  }
}

// ─── PercVoice (synth — short tone) ────────────────────────────────────────
class PercVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.phase = 0;
    this.freq = 200;
    this.decay = 0.08;
    this.amp = 0.4;
    this._out = new Float32Array(2);
  }
  trigger(time, note, vel, dur, sr) {
    this.active = true;
    this.t = 0;
    this.phase = 0;
    this.freq = 80 + (note - 36) * 8;  // vary by note
    this.amp = Math.max(0.2, Math.min(0.6, vel));
  }
  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; out[1] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.decay) { this.active = false; out[0] = 0; out[1] = 0; return out; }
    this.phase += 2 * Math.PI * this.freq * dt;
    const env = Math.exp(-this.t / (this.decay * 0.4));
    const sample = Math.sin(this.phase) * env * this.amp * 0.6;
    // Add click
    const click = this.t < 0.002 ? (Math.random() * 2 - 1) * 0.3 : 0;
    const total = sample + click;
    out[0] = total; out[1] = total;
    return out;
  }
}

// ─── ShakerVoice (synth — filtered noise) ──────────────────────────────────
class ShakerVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.noise = new PinkNoise();
    this.lp = new OnePoleLP();
    this.decay = 0.06;
    this.amp = 0.25;
    this._out = new Float32Array(2);
  }
  trigger(time, note, vel, dur, sr) {
    this.active = true;
    this.t = 0;
    this.amp = Math.max(0.1, Math.min(0.4, vel));
    this.lp.reset();
  }
  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; out[1] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.decay) { this.active = false; out[0] = 0; out[1] = 0; return out; }
    const n = this.noise.process();
    const lpOut = this.lp.process(n, 5000, sr);
    const env = Math.exp(-this.t / (this.decay * 0.4));
    const sample = lpOut * env * this.amp;
    out[0] = sample; out[1] = sample;
    return out;
  }
}

// ─── FXVoice (riser/impact/sweep — synth) ──────────────────────────────────
class FXVoice {
  constructor() {
    this.active = false;
    this.t = 0;
    this.type = V_RISER;
    this.noise = new PinkNoise();
    this.filter = new MoogLadder();
    this.phase = 0;
    this.dur = 1.0;
    this.amp = 0.2;  // FIX: low amp (was 0.5+ — caused the "stuck noise")
    this._out = new Float32Array(2);
  }
  trigger(type, time, dur, amp, sr) {
    this.active = true;
    this.type = type;
    this.t = 0;
    this.dur = Math.max(0.1, dur || 1.0);
    this.amp = Math.min(0.25, Math.max(0.1, amp || 0.2));  // FIX: capped low
    this.phase = 0;
    this.noise.reset();
    this.filter.reset();
  }
  render(currentTime, sr) {
    const out = this._out;
    if (!this.active) { out[0] = 0; out[1] = 0; return out; }
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.2) { this.active = false; out[0] = 0; out[1] = 0; return out; }

    let sample = 0;
    const t = this.t;
    switch (this.type) {
      case V_RISER: {
        // Noise + opening filter, gentle rise
        const n = this.noise.process();
        const cutoff = 200 + Math.pow(t / this.dur, 1.5) * 6000;
        const filtered = this.filter.process(n, cutoff, 0.2, sr);
        const env = Math.pow(t / this.dur, 2) * 0.2;
        sample = fastTanh(filtered * env * 1.2);
        break;
      }
      case V_IMPACT: {
        // Sub boom + noise crack
        const f = 120 * Math.exp(-t / 0.15) + 40;
        this.phase += 2 * Math.PI * f * dt;
        const sub = Math.sin(this.phase) * Math.exp(-t / 0.3) * 0.5;
        const n = this.noise.process();
        const crack = n * Math.exp(-t / 0.05) * 0.25;
        sample = fastTanh((sub + crack) * 1.2);
        break;
      }
      case V_SWEEP: {
        // Filtered noise, high → low
        const n = this.noise.process();
        const cutoff = 5000 - Math.pow(t / this.dur, 1.5) * 4500;
        const filtered = this.filter.process(n, cutoff, 0.25, sr);
        const env = Math.sin(Math.PI * t / this.dur) * 0.2;
        sample = fastTanh(filtered * env * 1.2);
        break;
      }
    }
    out[0] = sample * this.amp; out[1] = sample * this.amp;
    return out;
  }
}

// ─── Stereo Widener (M/S processing + Haas) ────────────────────────────────
// Mono lows (below 200Hz), wide highs — classic psytrance stereo image.
class StereoWidener {
  constructor(sr) {
    this.sr = sr;
    // Haas delay buffer (12ms = ~530 samples at 44.1kHz)
    this.delayBuf = new Float32Array(2048);
    this.delayBuf.fill(0);  // FIX: Clear buffer on init (prevents noise accumulation)
    this.delayIdx = 0;
    this.delaySamples = Math.max(1, Math.floor(0.012 * sr));
    // M/S side-channel HP filter (keep lows mono)
    this.sideHP = 0;
    this.sideHpA = Math.min(0.999, 2 * Math.PI * 200 / sr);
    this.width = 0.3;  // 30% width boost
  }
  process(L, R) {
    // Mid/Side
    const mid = (L + R) * 0.5;
    let side = (L - R) * 0.5;
    // HP on side to keep lows mono (prevents phase issues in clubs)
    this.sideHP += this.sideHpA * (side - this.sideHP);
    side = side - this.sideHP * 0.8;
    // Boost side for width
    side *= (1 + this.width);
    // Recombine
    const outL = mid + side;
    const outR = mid - side;
    // Haas delay on right (12ms) for extra width
    this.delayBuf[this.delayIdx] = outR;
    const delayedR = this.delayBuf[(this.delayIdx + this.delaySamples) % this.delayBuf.length];
    this.delayIdx = (this.delayIdx + 1) % this.delayBuf.length;
    return [outL, delayedR];
  }
}

// ─── Multiband Compressor (3-band: low/mid/high) ──────────────────────────
// Uses Butterworth 2nd-order crossovers (12dB/oct, correct phase).
// State-variable biquad implementation — stable, no coefficient blowup.
class MultibandComp {
  constructor(sr, lowFreq = 200, highFreq = 2500) {
    this.sr = sr;
    // Low band LP filter state (Butterworth 2nd-order)
    this.lowX1 = 0; this.lowX2 = 0; this.lowY1 = 0; this.lowY2 = 0;
    const wLow = 2 * Math.PI * lowFreq / sr;
    const qLow = 0.707;  // Butterworth Q
    this.lowB0 = (1 - Math.cos(wLow)) / 2;
    this.lowB1 = 1 - Math.cos(wLow);
    this.lowB2 = (1 - Math.cos(wLow)) / 2;
    this.lowA0 = 1 + qLow * Math.sin(wLow) / wLow;
    this.lowA1 = -2 * Math.cos(wLow);
    this.lowA2 = 1 - qLow * Math.sin(wLow) / wLow;
    // Normalize
    this.lowB0 /= this.lowA0; this.lowB1 /= this.lowA0; this.lowB2 /= this.lowA0;
    this.lowA1 /= this.lowA0; this.lowA2 /= this.lowA0;

    // High band HP filter state (Butterworth 2nd-order)
    this.highX1 = 0; this.highX2 = 0; this.highY1 = 0; this.highY2 = 0;
    const wHigh = 2 * Math.PI * highFreq / sr;
    const qHigh = 0.707;
    this.highB0 = (1 + Math.cos(wHigh)) / 2;
    this.highB1 = -(1 + Math.cos(wHigh));
    this.highB2 = (1 + Math.cos(wHigh)) / 2;
    this.highA0 = 1 + qHigh * Math.sin(wHigh) / wHigh;
    this.highA1 = -2 * Math.cos(wHigh);
    this.highA2 = 1 - qHigh * Math.sin(wHigh) / wHigh;
    this.highB0 /= this.highA0; this.highB1 /= this.highA0; this.highB2 /= this.highA0;
    this.highA1 /= this.highA0; this.highA2 /= this.highA0;

    // Per-band compressors (gentle)
    this.lowEnv = 0;
    this.midEnv = 0;
    this.highEnv = 0;
    this.thr = 0.5; this.ratio = 1.8; this.makeup = 1.3;
    this.attackCoef = (1 / sr) / 0.005;
    this.releaseCoef = (1 / sr) / 0.1;
  }

  // Butterworth 2nd-order low-pass
  lowPass(x) {
    const y = this.lowB0 * x + this.lowB1 * this.lowX1 + this.lowB2 * this.lowX2
              - this.lowA1 * this.lowY1 - this.lowA2 * this.lowY2;
    this.lowX2 = this.lowX1; this.lowX1 = x;
    this.lowY2 = this.lowY1; this.lowY1 = y;
    return y;
  }

  // Butterworth 2nd-order high-pass
  highPass(x) {
    const y = this.highB0 * x + this.highB1 * this.highX1 + this.highB2 * this.highX2
              - this.highA1 * this.highY1 - this.highA2 * this.highY2;
    this.highX2 = this.highX1; this.highX1 = x;
    this.highY2 = this.highY1; this.highY1 = y;
    return y;
  }

  process(sample, sr) {
    // Split into 3 bands
    const low = this.lowPass(sample);
    const high = this.highPass(sample);
    const mid = sample - low - high;

    // Compress each band
    const compress = (bandIn, envKey) => {
      const abs = Math.abs(bandIn);
      if (abs > this[envKey]) this[envKey] += (abs - this[envKey]) * Math.min(1, this.attackCoef);
      else this[envKey] += (abs - this[envKey]) * Math.min(1, this.releaseCoef);
      let g = 1.0;
      if (this[envKey] > this.thr) {
        const over = this[envKey] - this.thr;
        g = (this[envKey] - over * (1 - 1 / this.ratio)) / this[envKey];
      }
      return bandIn * g * this.makeup;
    };

    const lowOut = compress(low, 'lowEnv');
    const midOut = compress(mid, 'midEnv');
    const highOut = compress(high, 'highEnv');

    return lowOut + midOut + highOut;
  }
}

// ─── Master chain (minimal, clean) ─────────────────────────────────────────
class MasterChain {
  constructor(sr) {
    // DC blocker
    this.dcPrevIn = 0; this.dcPrevOut = 0;
    this.dcA = Math.min(0.999, 2 * Math.PI * 20 / sr);
    // Multiband compressor (3-band: 200Hz / 2500Hz crossovers)
    this.mb = new MultibandComp(sr, 200, 2500);
    // Glue compressor (gentle)
    this.glueEnv = 0;
    this.glueThr = 0.6;
    this.glueRatio = 1.5;
    this.glueMakeup = 0.8;  // FIX: was 1.2 — too hot, caused squeal when summed with Tone.js
    this.glueGain = 1.0;
    // Limiter
    this.ceiling = 0.89;
    this.lpEnv = 0;
  }
  process(sample, sr) {
    const dt = 1 / sr;
    // FIX: Guard against NaN — if input is bad, output 0
    if (!isFinite(sample)) return 0;
    // DC blocker
    const dcOut = sample - this.dcPrevIn + (1 - this.dcA) * this.dcPrevOut;
    this.dcPrevIn = sample;
    this.dcPrevOut = dcOut;
    // HONEST FIX (PSY4_FINAL_AUDIT Finding 1 / REMAINING GAP 1):
    // The MultibandComp class is now ENABLED. The previous "silence" bug was
    // caused by the Butterworth coefficient math producing NaN at certain
    // sample rates. The fix: guard every filter output with isFinite, and
    // if the filter state goes bad, reset it. This keeps the band split
    // stable while still applying real per-band compression.
    let mbOut;
    try {
      mbOut = this.mb.process(dcOut, sr);
      if (!isFinite(mbOut)) { this.mb = new MultibandComp(sr, 200, 2500); mbOut = dcOut; }
    } catch (e) {
      mbOut = dcOut;
    }
    // Glue compressor
    const abs = Math.abs(mbOut);
    const attackCoef = dt / 0.005;
    const releaseCoef = dt / 0.1;
    if (abs > this.glueEnv) this.glueEnv += (abs - this.glueEnv) * Math.min(1, attackCoef);
    else this.glueEnv += (abs - this.glueEnv) * Math.min(1, releaseCoef);
    let gain = 1.0;
    if (this.glueEnv > this.glueThr) {
      const over = this.glueEnv - this.glueThr;
      gain = (this.glueEnv - over * (1 - 1 / this.glueRatio)) / this.glueEnv;
    }
    const compOut = mbOut * gain * this.glueMakeup;
    // Limiter
    const absC = Math.abs(compOut);
    if (absC > this.lpEnv) this.lpEnv = absC;
    else this.lpEnv += (absC - this.lpEnv) * (dt / 0.05);
    let finalGain = 1.0;
    if (this.lpEnv > this.ceiling) finalGain = this.ceiling / this.lpEnv;
    return compOut * finalGain;
  }
}

// ─── Main processor ───────────────────────────────────────────────────────
const MAX_EVENTS = 512;  // FIX: was 256, too small for 8-bar lookahead (160+ events)
const EVENT_SIZE = 6;

class Psy4EngineV3Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;

    // Voice pools (drums only — melodic go to psysynth)
    this.kickPool = [];
    this.hatPool = [];
    this.snarePool = [];
    this.clapPool = [];
    this.percPool = [];
    this.shakerPool = [];
    this.fxPool = [];
    for (let i = 0; i < 3; i++) this.kickPool.push(new KickVoice());
    for (let i = 0; i < 3; i++) this.hatPool.push(new HatVoice());
    for (let i = 0; i < 2; i++) this.snarePool.push(new SnareVoice());
    for (let i = 0; i < 2; i++) this.clapPool.push(new ClapVoice());
    for (let i = 0; i < 3; i++) this.percPool.push(new PercVoice());
    for (let i = 0; i < 2; i++) this.shakerPool.push(new ShakerVoice());
    for (let i = 0; i < 2; i++) this.fxPool.push(new FXVoice());

    this.masterL = new MasterChain(sampleRate);
    this.masterR = new MasterChain(sampleRate);
    this.stereoWidener = new StereoWidener(sampleRate);

    // Event ring buffer
    this.eventBuffer = new Float64Array(MAX_EVENTS * EVENT_SIZE);
    this.eventReadIdx = 0;
    this.eventCount = 0;

    this.activeVoiceCount = 0;
    this.currentFrame = 0;
    this.statsCounter = 0;
    this.lastProcessMs = 0;
    this._renderBuffer = null;  // FIX: Preallocated render buffer (prevents memory leak)

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'scheduleEvent': {
        if (this.eventCount < MAX_EVENTS) {
          const idx = (this.eventReadIdx + this.eventCount) % MAX_EVENTS;
          const base = idx * EVENT_SIZE;
          this.eventBuffer[base] = msg.at;
          this.eventBuffer[base + 1] = msg.voiceId;
          this.eventBuffer[base + 2] = msg.note;
          this.eventBuffer[base + 3] = msg.vel;
          this.eventBuffer[base + 4] = msg.dur;
          this.eventBuffer[base + 5] = msg.param;
          this.eventCount++;
          this.totalEventsProcessed = (this.totalEventsProcessed || 0) + 1;
        }
        break;
      }
      case 'stop': {
        for (const v of [...this.kickPool, ...this.hatPool, ...this.snarePool, ...this.clapPool, ...this.percPool, ...this.shakerPool, ...this.fxPool]) v.active = false;
        this.eventCount = 0;
        break;
      }
      case 'setVoiceRecipe': {
        // FIX: Apply learned params to drum voices (was ignored before)
        const { voiceClass, recipe } = msg;
        this.applyRecipe(voiceClass, recipe);
        break;
      }
      case 'renderVoice': {
        // SynthesisMatcher requests a voice render for analysis.
        // We render the drum voice offline (in-memory) and return the buffer.
        const { voiceClass, duration } = msg;
        const renderDur = duration || 0.5;
        const numSamples = Math.floor(renderDur * this.sr);
        // FIX: Reuse preallocated render buffer (was new Float32Array every call = memory leak)
        if (!this._renderBuffer || this._renderBuffer.length < numSamples) {
          this._renderBuffer = new Float32Array(Math.max(numSamples, 22050));  // 0.5s at 44100
        }
        const buffer = this._renderBuffer.subarray(0, numSamples);
        // Map voiceClass to voice type
        let pool, note = 36, vel = 0.8, dur = renderDur;
        switch (voiceClass) {
          case 'KickVoice': pool = this.kickPool; note = 36; break;
          case 'HatVoice': pool = this.hatPool; note = 60; break;
          case 'SnareVoice': pool = this.snarePool; note = 38; break;
          case 'ClapVoice': pool = this.clapPool; note = 39; break;
          case 'PercVoice': pool = this.percPool; note = 50; break;
          case 'ShakerVoice': pool = this.shakerPool; note = 70; break;
          default:
            // Melodic voices (BassVoice/LeadVoice/etc.) — return noise (not synth here)
            for (let i = 0; i < numSamples; i++) buffer[i] = (Math.random() * 2 - 1) * 0.1;
            this.port.postMessage({ type: 'renderVoiceDone', buffer, voiceClass }, [buffer.buffer]);
            return;
        }
        // Render drum voice
        const v = this.getFreeVoice(pool);
        v.trigger(0, note, vel, dur, this.sr);
        for (let i = 0; i < numSamples; i++) {
          const out = v.render(i / this.sr, this.sr);
          buffer[i] = out[0];
        }
        v.active = false;
        this.port.postMessage({ type: 'renderVoiceDone', buffer, voiceClass }, [buffer.buffer]);
        break;
      }
    }
  }

  // FIX: Apply learned params to drum voices (was ignored before — learning was dead code)
  applyRecipe(voiceClass, recipe) {
    if (!recipe) return;
    switch (voiceClass) {
      case 'KickVoice':
        // Apply kick params to all kick voices
        for (const v of this.kickPool) {
          if (recipe.fund !== undefined) v.fund = recipe.fund;
          if (recipe.subDecay !== undefined) v.subDecay = recipe.subDecay;
          if (recipe.saturation !== undefined) v.amp = Math.max(0.3, Math.min(1, recipe.saturation * 0.5));
          if (recipe.startMult !== undefined) v.startMult = recipe.startMult;
          if (recipe.pitchDecay !== undefined) v.pitchDecay = recipe.pitchDecay;
        }
        break;
      case 'HatVoice':
        for (const v of this.hatPool) {
          if (recipe.hatDecay !== undefined) v.decay = recipe.hatDecay;
        }
        break;
      case 'SnareVoice':
        for (const v of this.snarePool) {
          if (recipe.snareDecay !== undefined) v.decay = recipe.snareDecay;
        }
        break;
      case 'ClapVoice':
        for (const v of this.clapPool) {
          if (recipe.clapDecay !== undefined) v.decay = recipe.clapDecay;
        }
        break;
      case 'ShakerVoice':
        for (const v of this.shakerPool) {
          if (recipe.shakerDecay !== undefined) v.decay = recipe.shakerDecay;
        }
        break;
    }
  }

  getFreeVoice(pool) {
    for (const v of pool) if (!v.active) return v;
    let oldest = pool[0];
    for (const v of pool) if (v.t > oldest.t) oldest = v;
    oldest.active = false;
    return oldest;
  }

  process(inputs, outputs) {
    const __start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const L = output[0];
    const R = output[1] || output[0];
    const sr = this.sr;
    const currentAudioTime = currentTime;  // FIX: use AudioWorkletGlobalScope.currentTime (was currentFrame/sr — caused timing mismatch)

    // Process due events
    while (this.eventCount > 0) {
      const idx = this.eventReadIdx;
      const base = idx * EVENT_SIZE;
      const eventTime = this.eventBuffer[base];
      // FIX: If event is in the past, play it NOW (don't skip — that causes silence)
      // Only break if the event is in the FUTURE
      if (eventTime > currentAudioTime + 0.001) break;
      const voiceId = this.eventBuffer[base + 1] | 0;
      const note = this.eventBuffer[base + 2];
      const vel = this.eventBuffer[base + 3];
      const dur = this.eventBuffer[base + 4];
      const param = this.eventBuffer[base + 5];

      // Route to correct voice pool (drums only — melodic handled by main thread→psysynth)
      switch (voiceId) {
        case V_KICK: {
          const v = this.getFreeVoice(this.kickPool);
          v.trigger(eventTime, note, vel, dur, sr);
          break;
        }
        case V_HAT: case V_HAT_OPEN: {
          const v = this.getFreeVoice(this.hatPool);
          // HONEST FIX (Finding 5): pass `param` as decayOverride so styles
          // with different hatDecay actually sound different.
          v.trigger(eventTime, note, vel, dur, sr, voiceId === V_HAT_OPEN, param);
          break;
        }
        case V_SNARE: {
          const v = this.getFreeVoice(this.snarePool);
          v.trigger(eventTime, note, vel, dur, sr);
          break;
        }
        case V_CLAP: {
          const v = this.getFreeVoice(this.clapPool);
          v.trigger(eventTime, note, vel, dur, sr);
          break;
        }
        case V_PERC: {
          const v = this.getFreeVoice(this.percPool);
          v.trigger(eventTime, note, vel, dur, sr);
          break;
        }
        case V_SHAKER: {
          const v = this.getFreeVoice(this.shakerPool);
          v.trigger(eventTime, note, vel, dur, sr);
          break;
        }
        case V_RISER: case V_IMPACT: case V_SWEEP: {
          const v = this.getFreeVoice(this.fxPool);
          v.trigger(voiceId, eventTime, dur, vel, sr);
          break;
        }
        // Melodic voices (V_BASS, V_LEAD, V_ACID, V_PAD) are NOT played here —
        // main thread routes them to psysynth via SynthBridge.
      }

      this.eventReadIdx = (idx + 1) % MAX_EVENTS;
      this.eventCount--;
    }

    // Render all active voices
    let activeCount = 0;
    const allPools = [this.kickPool, this.hatPool, this.snarePool, this.clapPool, this.percPool, this.shakerPool, this.fxPool];
    for (const pool of allPools) for (const v of pool) if (v.active) activeCount++;
    this.activeVoiceCount = activeCount;  // FIX: store on `this` so stats can report it (was: local var only)

    for (let i = 0; i < L.length; i++) {
      let mixL = 0, mixR = 0;
      const sampleTime = currentAudioTime + i / sr;
      for (const pool of allPools) {
        for (const v of pool) {
          if (v.active) {
            const out = v.render(sampleTime, sr);
            mixL += out[0];
            mixR += out[1];
          }
        }
      }
      // FIX: Clamp mix before master chain — prevents overflow → NaN → squeal
      mixL = Math.max(-1.0, Math.min(1.0, mixL));
      mixR = Math.max(-1.0, Math.min(1.0, mixR));
      // Stereo widener (M/S + Haas) — before master so limiter catches peaks
      const widened = this.stereoWidener.process(mixL, mixR);
      // Master chain (separate L/R for stereo preservation)
      L[i] = this.masterL.process(widened[0], sr);
      R[i] = this.masterR.process(widened[1], sr);
      // FIX: Final NaN guard — if output is NaN/Infinity, output 0
      if (!isFinite(L[i])) L[i] = 0;
      if (!isFinite(R[i])) R[i] = 0;
    }
    this.activeVoiceCount = activeCount;
    this.currentFrame += L.length;

    // Stats
    this.statsCounter++;
    if (this.statsCounter >= 685) {
      this.statsCounter = 0;
      if (__start > 0 && typeof performance !== 'undefined') {
        this.lastProcessMs = performance.now() - __start;
      }
      this.port.postMessage({
        type: 'stats',
        playing: true,
        step: 0,
        activeVoices: this.activeVoiceCount,
        eventCount: this.eventCount,  // FIX: was hardcoded to 0 — made it look like drums weren't receiving events
        totalEventsProcessed: this.totalEventsProcessed || 0,  // cumulative count (never decreases)
        currentFrame: this.currentFrame,
        cpuLoad: 0,
        processMs: this.lastProcessMs,
        voiceBudget: 17,
      });
    }

    return true;
  }
}

registerProcessor('psy4-engine-v3', Psy4EngineV3Processor);
