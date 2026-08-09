/**
 * Forensic Voices — isomorphic TypeScript port of psy4-engine.js voice classes.
 *
 * Every voice matches the worklet DSP exactly. The ONLY difference is that
 * PinkNoise takes a deterministic Rng instead of using an internal LFSR.
 *
 * Voice IDs match the worklet's VOICE constants.
 */

import { Rng } from './prng';
import {
  fastTanh, MoogLadder, BLSaw, BLSquare, PinkNoise, OnePoleLP,
} from './dsp';

// Voice IDs (match engineWorklet.ts VOICE constants)
export const V_KICK = 0;
export const V_BASS = 1;
export const V_LEAD = 2;
export const V_ACID = 3;
export const V_PAD = 4;
export const V_HAT = 5;
export const V_HAT_OPEN = 6;
export const V_CLAP = 7;
export const V_PERC = 8;
export const V_SHAKER = 9;
export const V_TEXTURE = 10;
export const V_RISER = 11;
export const V_IMPACT = 12;
export const V_SWEEP = 13;
export const V_ZAP = 14;
export const V_BLIP = 15;
export const V_DOWNLIFTER = 16;

export interface BassParams {
  cutoffStart: number;
  cutoffEnd: number;
  resonance: number;
}

export interface LeadParams {
  cutoff: number;
  detune: number;
  resonance: number;
  lfoRate: number;
  lfoDepth: number;
}

export interface PadParams {
  cutoff: number;
  attack: number;
  detune: number;
  evolveRate: number;
}

// ─── Kick Voice ────────────────────────────────────────────────────────────

export class KickVoice {
  active = false;
  t = 0;
  amp = 1;
  fund = 50;
  decay = 0.2;
  phase = 0;
  prevNoise = 0;
  noise: PinkNoise;

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng);
  }

  trigger(_time: number, amp: number, fund: number, decay: number, _sr: number): void {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.fund = fund;
    this.decay = decay;
    this.phase = 0;
    this.prevNoise = 0;
    this.noise.reset();
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    this.t += 1 / 44100;
    if (this.t > this.decay + 0.05) { this.active = false; return [0, true]; }
    const t = this.t;
    const f0 = this.fund;
    const f = (f0 * 2.4 - f0) * Math.exp(-t / 0.04) + f0;
    this.phase += 2 * Math.PI * f / 44100;
    const subEnv = Math.exp(-t / (this.decay * 0.9));
    const sub = Math.sin(this.phase) * subEnv * 0.8;
    const triPhase = (t * f0) % 1;
    const tri = 2 * Math.abs(2 * triPhase - 1) - 1;
    const midEnv = Math.exp(-t / 0.05) * 0.5;
    const mid = fastTanh(tri * 1.5) * midEnv;
    const n = this.noise.next();
    const click = (n - this.prevNoise) * Math.exp(-t / 0.002) * 0.35;
    this.prevNoise = n;
    const sample = (sub + mid + click) * 0.8 * this.amp;
    return [sample, false];
  }
}

// ─── Bass Voice ────────────────────────────────────────────────────────────

export class BassVoice {
  active = false;
  t = 0;
  freq = 80;
  amp = 0.5;
  dur = 0.2;
  acid = false;
  square = new BLSquare();
  saw = new BLSaw();
  filter = new MoogLadder();
  phase = 0;
  cutoffStart = 800;
  cutoffEnd = 200;
  res = 0.1;
  bassDecay = 0.12;
  hpState = 0;

  trigger(_time: number, freq: number, dur: number, amp: number, acid: boolean, _sr: number, params?: BassParams): void {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.dur = dur;
    this.amp = amp;
    this.acid = acid;
    this.phase = 0;
    this.hpState = 0;
    this.square.reset();
    this.square.setFreq(freq);
    this.saw.reset();
    this.saw.setFreq(freq);
    this.filter.reset();
    if (acid) {
      this.cutoffStart = 2500;
      this.cutoffEnd = 100;
      this.res = 0.85;
      this.bassDecay = 0.15;
    } else {
      this.cutoffStart = params?.cutoffStart ?? 800;
      this.cutoffEnd = params?.cutoffEnd ?? 200;
      this.res = Math.min(0.3, (params?.resonance ?? 3) / 20);
      this.bassDecay = 0.12;
    }
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    const sr = 44100;
    this.t += 1 / sr;
    if (this.t > this.bassDecay) { this.active = false; return [0, true]; }
    const inc = this.freq / sr;
    const osc = this.acid ? this.saw.process(inc) : this.square.process(inc);
    const cutoffEnv = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / 0.04) + this.cutoffEnd;
    const drive = this.acid ? 2.5 : 1.3;
    const filtered = this.filter.process(osc, cutoffEnv, this.res, drive, sr);
    this.phase += 2 * Math.PI * this.freq / sr;
    const sub = Math.sin(this.phase) * 0.45;
    let mixed = filtered * 0.55 + sub * 0.45;
    mixed = fastTanh(mixed * 1.8);
    const hpCutoff = 30;
    const hpA = (1 / sr) * 2 * Math.PI * hpCutoff;
    this.hpState += hpA * (mixed - this.hpState) / (1 + hpA);
    mixed = mixed - this.hpState * 0.7;
    const attackEnv = Math.min(1, this.t / 0.001);
    const decayEnv = Math.exp(-this.t / (this.bassDecay * 0.5));
    const ampEnv = attackEnv * decayEnv;
    return [mixed * ampEnv * this.amp, false];
  }
}

// ─── Lead Voice ────────────────────────────────────────────────────────────

export class LeadVoice {
  active = false;
  t = 0;
  dur = 0.3;
  amp = 0.5;
  freq = 440;
  saws: BLSaw[];
  octaveSaws: BLSaw[];
  filter = new MoogLadder();
  cutoff = 1800;
  res = 0.15;
  lfoPhase = 0;
  lfoRate = 0.8;
  lfoDepth = 0.3;
  detune = 10;
  noise: PinkNoise;

  constructor(rng: Rng) {
    this.saws = [new BLSaw(), new BLSaw(), new BLSaw(), new BLSaw(), new BLSaw()];
    this.octaveSaws = [new BLSaw(), new BLSaw(), new BLSaw()];
    this.noise = new PinkNoise(rng);
  }

  trigger(_time: number, freq: number, dur: number, amp: number, _sr: number, params?: LeadParams): void {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.amp = amp;
    this.freq = freq;
    this.detune = params?.detune ?? 10;
    this.cutoff = params?.cutoff ?? 1800;
    this.res = Math.min(1, (params?.resonance ?? 2) / 20);
    this.lfoRate = params?.lfoRate ?? 0.8;
    this.lfoDepth = params?.lfoDepth ?? 0.3;
    this.lfoPhase = 0;
    for (const s of this.saws) s.reset();
    const n = this.saws.length;
    for (let i = 0; i < n; i++) {
      const cents = (i - (n - 1) / 2) * this.detune;
      const mult = Math.pow(2, cents / 1200);
      this.saws[i].setFreq(freq * mult);
    }
    for (let i = 0; i < this.octaveSaws.length; i++) {
      this.octaveSaws[i].reset();
      const cents = (i - 1) * this.detune * 0.6;
      this.octaveSaws[i].setFreq(freq * 2 * Math.pow(2, cents / 1200));
    }
    this.filter.reset();
    this.noise.reset();
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    const sr = 44100;
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.05) { this.active = false; return [0, true]; }
    // Use each saw's OWN frequency (set via setFreq in trigger) — NOT the base freq.
    // BUG FIX: Previously used `const inc = this.freq / sr` for all saws, which
    // ignored the detune and made all saws play the same frequency.
    let fundamental = 0;
    for (const s of this.saws) fundamental += s.process(s.freq / sr);
    fundamental /= this.saws.length;
    let octaveLayer = 0;
    for (const s of this.octaveSaws) octaveLayer += s.process(s.freq / sr);
    octaveLayer /= this.octaveSaws.length;
    const noiseSample = this.noise.process();
    const air = (noiseSample - 0) * 0.08;
    let mix = fundamental * 0.7 + octaveLayer * 0.3 + air * 0.08;
    this.lfoPhase += this.lfoRate * dt;
    const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.lfoPhase);
    const modCutoff = this.cutoff * (1 + this.lfoDepth * (lfo * 2 - 1) * 0.5);
    const fEnv = this.cutoff * 2 * Math.exp(-this.t / (this.dur * 0.5)) + this.cutoff;
    const cutoff = Math.min(18000, Math.max(100, fEnv * 0.5 + modCutoff * 0.5));
    const filtered = this.filter.process(mix, cutoff, this.res, 1.5, sr);
    const saturated = fastTanh(filtered * 1.6);
    const ampEnv = Math.min(1, this.t / 0.006) * Math.exp(-this.t / this.dur);
    return [saturated * ampEnv * this.amp, false];
  }
}

// ─── Acid Voice ────────────────────────────────────────────────────────────

export class AcidVoice {
  active = false;
  t = 0;
  freq = 110;
  dur = 0.2;
  amp = 0.3;
  square = new BLSquare();
  filter = new MoogLadder();
  lfoPhase = 0;
  cutoffStart = 3200;
  cutoffEnd = 100;

  trigger(_time: number, freq: number, dur: number, amp: number, _sr: number): void {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.dur = dur;
    this.amp = amp;
    this.square.reset();
    this.square.setFreq(freq);
    this.filter.reset();
    this.cutoffStart = 3200;
    this.cutoffEnd = 100;
    this.lfoPhase = 0;
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    const sr = 44100;
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.05) { this.active = false; return [0, true]; }
    const inc = this.freq / sr;
    const sq = this.square.process(inc);
    const envCutoff = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / (this.dur * 0.4)) + this.cutoffEnd;
    this.lfoPhase += 4.0 * dt;
    const lfo = Math.sin(2 * Math.PI * this.lfoPhase);
    const cutoff = Math.max(80, envCutoff * (1 + lfo * 0.3));
    const filtered = this.filter.process(sq, cutoff, 0.95, 3.0, sr);
    const distorted = fastTanh(filtered * 4);
    const ampEnv = Math.min(1, this.t / 0.003) * Math.exp(-this.t / this.dur);
    return [distorted * ampEnv * this.amp, false];
  }
}

// ─── Pad Voice ─────────────────────────────────────────────────────────────

export class PadVoice {
  active = false;
  t = 0;
  dur = 0.3;
  amp = 0.3;
  freq = 220;
  saws = [new BLSaw(), new BLSaw(), new BLSaw()];
  filter = new MoogLadder();
  lfoPhase = 0;
  filterSweepPhase = 0;
  cutoffBase = 1200;
  res = 0.08;
  attack = 0.5;
  detune = 7;
  evolveRate = 0.1;

  trigger(_time: number, freq: number, dur: number, amp: number, _sr: number, params?: PadParams): void {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.amp = amp;
    this.freq = freq;
    this.cutoffBase = params?.cutoff ?? 1200;
    this.res = 0.08;
    this.attack = params?.attack ?? 0.5;
    this.detune = params?.detune ?? 7;
    this.evolveRate = params?.evolveRate ?? 0.1;
    this.lfoPhase = 0;
    this.filterSweepPhase = 0;
    for (const s of this.saws) s.reset();
    this.saws[0].setFreq(freq * Math.pow(2, -this.detune / 1200));
    this.saws[1].setFreq(freq);
    this.saws[2].setFreq(freq * Math.pow(2, this.detune / 1200));
    this.filter.reset();
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    const sr = 44100;
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.1) { this.active = false; return [0, true]; }
    const inc = this.freq / sr;
    this.lfoPhase += this.evolveRate * dt;
    const lfo = Math.sin(2 * Math.PI * this.lfoPhase);
    const detuneMod = 1 + 0.003 * lfo;
    this.saws[0].setFreq(this.freq * Math.pow(2, -this.detune / 1200) * detuneMod);
    this.saws[1].setFreq(this.freq * detuneMod);
    this.saws[2].setFreq(this.freq * Math.pow(2, this.detune / 1200) * detuneMod);
    let mix = 0;
    // BUG FIX: use each saw's own frequency, not the shared base inc
    for (const s of this.saws) mix += s.process(s.freq / sr);
    mix /= this.saws.length;
    this.filterSweepPhase += 0.15 * dt;
    const sweep = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.filterSweepPhase);
    const cutoff = this.cutoffBase * (0.6 + sweep * 0.8);
    const filtered = this.filter.process(mix, cutoff, this.res, 1.2, sr);
    const attackEnv = Math.min(1, this.t / this.attack);
    const releaseEnv = Math.min(1, (this.dur - this.t) / 0.4);
    const ampEnv = Math.max(0, Math.min(1, Math.min(attackEnv, releaseEnv)));
    return [filtered * ampEnv * this.amp, false];
  }
}

// ─── Hat Voice ─────────────────────────────────────────────────────────────

export class HatVoice {
  active = false;
  t = 0;
  open = false;
  amp = 1;
  decay = 0.03;
  prevNoise = 0;
  noise: PinkNoise;

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng);
  }

  trigger(_time: number, open: boolean, amp: number, _sr: number): void {
    this.active = true;
    this.t = 0;
    this.open = open;
    this.amp = amp;
    this.decay = open ? 0.22 : 0.03;
    this.prevNoise = 0;
    this.noise.reset();
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    this.t += 1 / 44100;
    if (this.t > this.decay * 1.5) { this.active = false; return [0, true]; }
    const n = this.noise.process();
    const hp = n - this.prevNoise;
    this.prevNoise = n;
    const env = Math.exp(-this.t / this.decay);
    const sample = hp * env * 0.5 * this.amp / 0.12;
    return [sample, false];
  }
}

// ─── Clap Voice ────────────────────────────────────────────────────────────

export class ClapVoice {
  active = false;
  t = 0;
  amp = 1;
  bursts = [0, 0.012, 0.024, 0.036];
  decays = [0.02, 0.02, 0.02, 0.09];
  noise: PinkNoise;

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng);
  }

  trigger(_time: number, amp: number, _sr: number): void {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.noise.reset();
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    this.t += 1 / 44100;
    if (this.t > 0.3) { this.active = false; return [0, true]; }
    const n = this.noise.next();
    let g = 0;
    for (let k = 0; k < 4; k++) {
      if (this.t >= this.bursts[k]) {
        g += Math.exp(-(this.t - this.bursts[k]) / this.decays[k]);
      }
    }
    const sample = n * g * 0.6 * this.amp / 0.4;
    return [sample, false];
  }
}

// ─── Perc Voice ────────────────────────────────────────────────────────────

export class PercVoice {
  active = false;
  t = 0;
  freq = 400;
  amp = 1;
  phase = 0;
  filter = new MoogLadder();

  trigger(_time: number, freq: number, amp: number, _sr: number): void {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.amp = amp;
    this.phase = 0;
    this.filter.reset();
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    const sr = 44100;
    this.t += 1 / sr;
    if (this.t > 0.1) { this.active = false; return [0, true]; }
    const pitchEnv = 1.5 * Math.exp(-this.t / 0.01) + 0.5;
    this.phase += 2 * Math.PI * this.freq * pitchEnv / sr;
    const osc = Math.sin(this.phase);
    const filtered = this.filter.process(osc, 800, 0.2, 1.5, sr);
    const saturated = fastTanh(filtered * 1.8);
    const env = Math.exp(-this.t / 0.05);
    return [saturated * env * this.amp, false];
  }
}

// ─── Shaker Voice ──────────────────────────────────────────────────────────

export class ShakerVoice {
  active = false;
  t = 0;
  amp = 1;
  prevNoise = 0;
  noise: PinkNoise;
  filter = new MoogLadder();

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng);
  }

  trigger(_time: number, amp: number, _sr: number): void {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.noise.reset();
    this.prevNoise = 0;
    this.filter.reset();
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    const sr = 44100;
    this.t += 1 / sr;
    if (this.t > 0.08) { this.active = false; return [0, true]; }
    const n = this.noise.process();
    const hp = n - this.prevNoise;
    this.prevNoise = n;
    const shaped = this.filter.process(hp, 6000, 0.1, 1.0, sr);
    const saturated = fastTanh(shaped * 2.5);
    const env = Math.exp(-this.t / 0.03);
    return [saturated * env * 2 * this.amp, false];
  }
}

// ─── Texture Voice ─────────────────────────────────────────────────────────

export class TextureVoice {
  active = false;
  t = 0;
  dur = 2;
  amp = 0.2;
  type = 'fm';
  saw1 = new BLSaw();
  saw2 = new BLSaw();
  filter = new MoogLadder();
  noiseFilter = new MoogLadder();
  noise: PinkNoise;
  morphPhase = 0;
  baseFreq = 220;

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng);
  }

  trigger(_time: number, dur: number, amp: number, type: string, _sr: number): void {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.amp = amp;
    this.type = type || 'fm';
    this.morphPhase = 0;
    this.saw1.reset();
    this.saw2.reset();
    this.filter.reset();
    this.noiseFilter.reset();
    this.noise.reset();
    // Use a deterministic frequency derived from a seeded value
    // (in the worklet this was Math.random — we make it deterministic)
    this.baseFreq = 110 + (0.5) * 220; // fixed center — deterministic
    this.saw1.setFreq(this.baseFreq);
    this.saw2.setFreq(this.baseFreq * 1.01);
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    const sr = 44100;
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.1) { this.active = false; return [0, true]; }
    const env = Math.min(1, this.t / 0.5) * Math.min(1, (this.dur - this.t) / 0.5);
    if (env <= 0) return [0, false];
    const inc = this.baseFreq / sr;
    const oscBed = (this.saw1.process(inc) + this.saw2.process(inc)) * 0.3;
    const noiseSamp = this.noise.process();
    const noiseFiltered = this.noiseFilter.process(noiseSamp, 2000, 0.3, 1.0, sr) * 0.4;
    this.morphPhase += 0.3 * dt;
    const morph = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.morphPhase);
    const morphCutoff = 300 + morph * 2000;
    let mix = oscBed + noiseFiltered;
    mix = this.filter.process(mix, morphCutoff, 0.15, 1.2, sr);
    mix = fastTanh(mix * 1.3);
    return [mix * env * this.amp, false];
  }
}

// ─── FX Voice ──────────────────────────────────────────────────────────────

export class FXVoice {
  active = false;
  t = 0;
  type = V_RISER;
  dur = 0.3;
  amp = 0.2;
  phase = 0;
  noise: PinkNoise;
  filter = new MoogLadder();

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng);
  }

  trigger(type: number, _time: number, dur: number, amp: number, _sr: number): void {
    this.active = true;
    this.type = type;
    this.t = 0;
    this.dur = dur || 0.3;
    this.amp = amp || 0.2;
    this.phase = 0;
    this.noise.reset();
    this.filter.reset();
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true];
    const sr = 44100;
    const dt = 1 / sr;
    this.t += dt;
    if (this.t > this.dur + 0.2) { this.active = false; return [0, true]; }
    let sample = 0;
    const t = this.t;
    switch (this.type) {
      case V_RISER: {
        const n = this.noise.process();
        const cutoff = 200 + (t / this.dur) * 7800;
        const filtered = this.filter.process(n, cutoff, 0.2, 1.5, sr);
        const env = Math.pow(t / this.dur, 2) * 0.35;
        sample = fastTanh(filtered * env * 3);
        break;
      }
      case V_IMPACT: {
        const f = 120 * Math.exp(-t / 0.15) + 35;
        this.phase += 2 * Math.PI * f * dt;
        const subEnv = Math.exp(-t / 0.2);
        const sub = Math.sin(this.phase) * subEnv * 0.7;
        const n = this.noise.process();
        const noiseEnv = Math.exp(-t / 0.02);
        const crack = n * noiseEnv * 0.3;
        sample = fastTanh((sub + crack) * 1.5);
        break;
      }
      case V_SWEEP: {
        const n = this.noise.process();
        const sweepPos = t / this.dur;
        const cutoff = 200 + Math.sin(Math.PI * sweepPos) * 4000 + 2000;
        const filtered = this.filter.process(n, cutoff, 0.3, 1.3, sr);
        const env = Math.sin(Math.PI * sweepPos) * 0.2;
        sample = filtered * env;
        break;
      }
      case V_ZAP: {
        const car = 880, mod = 1760;
        const idx = 3 * Math.exp(-t / 0.03);
        this.phase += 2 * Math.PI * (car + idx * Math.sin(2 * Math.PI * mod * t)) * dt;
        const env = Math.exp(-t / 0.04);
        sample = fastTanh(Math.sin(this.phase) * env * 2);
        break;
      }
      case V_BLIP: {
        const f = 1200 * Math.exp(-t / 0.01) + 400;
        this.phase += 2 * Math.PI * f * dt;
        const env = Math.exp(-t / 0.02);
        sample = Math.sin(this.phase) * env;
        break;
      }
      case V_DOWNLIFTER: {
        const f = 800 * Math.exp(-t / 0.15) + 100;
        this.phase += 2 * Math.PI * f * dt;
        const saw = 2 * ((this.phase / (2 * Math.PI)) % 1) - 1;
        const cutoff = 3000 * Math.exp(-t / 0.2) + 200;
        const filtered = this.filter.process(saw, cutoff, 0.1, 1.0, sr);
        const env = Math.exp(-t / 0.2);
        sample = filtered * env * 0.4;
        break;
      }
    }
    return [sample * this.amp, false];
  }
}
