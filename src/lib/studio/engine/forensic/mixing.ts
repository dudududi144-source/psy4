/**
 * Forensic Mixing — bus processors, master chain, reverb, delay.
 *
 * Direct port of psy4-engine.js mixing classes. Same DSP, same coefficients.
 */

import { fastTanh } from './dsp';

// ─── Bus Processor (compression + HP + saturation per bus) ─────────────────

export interface BusConfig {
  hpFreq: number;
  compThr: number;
  compRatio: number;
  compAtt: number;
  compRel: number;
  compMakeup: number;
  drive: number;
  gain: number;
}

export class BusProcessor {
  config: BusConfig;
  compEnv = 0;
  hpState = 0;
  drive: number;
  gain: number;

  constructor(config: Partial<BusConfig> = {}) {
    this.config = {
      hpFreq: 0, compThr: 0, compRatio: 2, compAtt: 0.003, compRel: 0.1,
      compMakeup: 1.2, drive: 1.0, gain: 1.0, ...config,
    };
    this.drive = this.config.drive;
    this.gain = this.config.gain;
  }

  process(sample: number, sr: number): number {
    // Guard: prevent NaN/Infinity from corrupting compressor envelope
    if (!isFinite(sample)) return 0;
    const dt = 1 / sr;
    if (this.config.hpFreq > 0) {
      const hpA = (1 / sr) * 2 * Math.PI * this.config.hpFreq;
      this.hpState += hpA * (sample - this.hpState) / (1 + hpA);
      sample = sample - this.hpState;
    }
    if (this.config.compThr > 0) {
      const abs = Math.abs(sample);
      if (abs > this.compEnv) {
        this.compEnv += (abs - this.compEnv) * (dt / this.config.compAtt);
      } else {
        this.compEnv += (abs - this.compEnv) * (dt / this.config.compRel);
      }
      if (this.compEnv > this.config.compThr) {
        const over = this.compEnv - this.config.compThr;
        const reduction = over * (1 - 1 / this.config.compRatio);
        const compGain = (this.compEnv - reduction) / this.compEnv;
        sample *= compGain;
      }
      sample *= this.config.compMakeup;
    }
    if (this.drive > 1.0) {
      sample = fastTanh(sample * this.drive);
    }
    return sample * this.gain;
  }
}

// ─── Master Chain (glue compression + saturation + limiter) ────────────────

export class MasterChain {
  gain = 1.0;
  ceiling = 0.90;       // was 0.98 — leave headroom
  env = 0;
  attack = 0.0003;
  release = 0.06;
  glueEnv = 0;
  glueThr = 0.60;       // was 0.50 — less compression
  glueRatio = 2.5;      // was 3.5 — gentler
  glueAttack = 0.004;
  glueRelease = 0.12;
  makeup = 1.0;         // was 1.5 — was causing over-compression

  process(sample: number, sr: number): number {
    // Guard: prevent NaN/Infinity from propagating
    if (!isFinite(sample)) return 0;
    const dt = 1 / sr;
    const abs = Math.abs(sample);
    if (abs > this.glueEnv) {
      this.glueEnv += (abs - this.glueEnv) * (dt / this.glueAttack);
    } else {
      this.glueEnv += (abs - this.glueEnv) * (dt / this.glueRelease);
    }
    let glueGain = 1;
    if (this.glueEnv > this.glueThr) {
      const over = this.glueEnv - this.glueThr;
      const reduction = over * (1 - 1 / this.glueRatio);
      glueGain = (this.glueEnv - reduction) / this.glueEnv;
    }
    let s = sample * glueGain * this.makeup;
    s = fastTanh(s * 1.2) * 0.7 + s * 0.3;
    const absS = Math.abs(s);
    if (absS > this.env) {
      this.env += (absS - this.env) * (dt / this.attack);
    } else {
      this.env += (absS - this.env) * (dt / this.release);
    }
    let limGain = 1;
    if (this.env > this.ceiling) {
      limGain = this.ceiling / this.env;
    }
    s *= limGain * this.gain;
    return Math.max(-1, Math.min(1, s));
  }
}

// ─── Schroeder Reverb ──────────────────────────────────────────────────────

export class SchroederReverb {
  combDelays = [1687, 1601, 2053, 2251];
  combBuffers: Float32Array[] = [];
  combIdx: number[] = [];
  combFeedback = 0.84;
  combDamping = 0.2;
  combLP: number[] = [];
  allpassDelays = [347, 113];
  allpassBuffers: Float32Array[] = [];
  allpassIdx: number[] = [];
  allpassFeedback = 0.7;
  wet = 0.45;
  inputGain = 0.15;

  constructor() {
    for (let i = 0; i < 4; i++) {
      this.combBuffers.push(new Float32Array(this.combDelays[i]));
      this.combIdx.push(0);
      this.combLP.push(0);
    }
    for (let i = 0; i < 2; i++) {
      this.allpassBuffers.push(new Float32Array(this.allpassDelays[i]));
      this.allpassIdx.push(0);
    }
  }

  setWet(wet: number): void { this.wet = wet; }
  setInputGain(g: number): void { this.inputGain = g; }

  process(input: number, _sr: number): [number, number] {
    // Guard: prevent NaN/Infinity from entering feedback loops
    if (!isFinite(input)) return [0, 0];
    const inSample = input * this.inputGain;
    let combSum = 0;
    for (let i = 0; i < 4; i++) {
      const buf = this.combBuffers[i];
      const idx = this.combIdx[i];
      const delayed = buf[idx];
      this.combLP[i] = delayed + this.combDamping * (this.combLP[i] - delayed);
      const out = inSample + this.combLP[i] * this.combFeedback;
      buf[idx] = out;
      this.combIdx[i] = (idx + 1) % this.combDelays[i];
      combSum += out;
    }
    combSum *= 0.25;
    let ap = combSum;
    for (let i = 0; i < 2; i++) {
      const buf = this.allpassBuffers[i];
      const idx = this.allpassIdx[i];
      const delayed = buf[idx];
      const out = -ap * this.allpassFeedback + delayed;
      buf[idx] = ap + delayed * this.allpassFeedback;
      this.allpassIdx[i] = (idx + 1) % this.allpassDelays[i];
      ap = out;
    }
    return [ap * this.wet, combSum * this.wet * 0.9];
  }

  reset(): void {
    for (const buf of this.combBuffers) buf.fill(0);
    for (const buf of this.allpassBuffers) buf.fill(0);
    this.combLP.fill(0);
  }
}

// ─── Stereo Delay (ping-pong) ──────────────────────────────────────────────

export class StereoDelay {
  bufferSize = 44100 * 2;
  leftBuf: Float32Array;
  rightBuf: Float32Array;
  leftIdx = 0;
  rightIdx = 0;
  leftDelay = 0.375;
  rightDelay = 0.281;
  feedback = 0.35;
  wet = 0.35;
  inputGain = 0.2;
  fbLP = [0, 0];

  constructor() {
    this.leftBuf = new Float32Array(this.bufferSize);
    this.rightBuf = new Float32Array(this.bufferSize);
  }

  setFeedback(fb: number): void { this.feedback = fb; }
  setWet(wet: number): void { this.wet = wet; }
  setInputGain(g: number): void { this.inputGain = g; }

  process(leftIn: number, rightIn: number, sr: number): [number, number] {
    // Guard: prevent NaN/Infinity from entering feedback loops
    if (!isFinite(leftIn)) leftIn = 0;
    if (!isFinite(rightIn)) rightIn = 0;
    const leftDelaySamples = Math.floor(this.leftDelay * sr);
    const rightDelaySamples = Math.floor(this.rightDelay * sr);
    const leftReadIdx = (this.leftIdx - leftDelaySamples + this.bufferSize) % this.bufferSize;
    const rightReadIdx = (this.rightIdx - rightDelaySamples + this.bufferSize) % this.bufferSize;
    const leftDelayed = this.leftBuf[leftReadIdx];
    const rightDelayed = this.rightBuf[rightReadIdx];
    const fbCutoff = 0.3;
    this.fbLP[0] = this.fbLP[0] + fbCutoff * (leftDelayed - this.fbLP[0]);
    this.fbLP[1] = this.fbLP[1] + fbCutoff * (rightDelayed - this.fbLP[1]);
    const leftWrite = leftIn * this.inputGain + this.fbLP[1] * this.feedback;
    const rightWrite = rightIn * this.inputGain + this.fbLP[0] * this.feedback;
    this.leftBuf[this.leftIdx] = leftWrite;
    this.rightBuf[this.rightIdx] = rightWrite;
    this.leftIdx = (this.leftIdx + 1) % this.bufferSize;
    this.rightIdx = (this.rightIdx + 1) % this.bufferSize;
    return [leftDelayed * this.wet, rightDelayed * this.wet];
  }

  reset(): void {
    this.leftBuf.fill(0);
    this.rightBuf.fill(0);
    this.fbLP.fill(0);
  }
}
