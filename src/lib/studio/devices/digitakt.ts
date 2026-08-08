/**
 * Elektron Digitakt II twin — "Digitakt-V".
 * Sampling / sequencing / resampling engine: stereo sampler + sequencer.
 * REAL IMPLEMENTATION (sample playback + resample buffer + warp) +
 * SIMULATED HARDWARE BEHAVIOR (Elektron sequencing + resample host).
 * EXTERNAL HARDWARE REQUIREMENT: real Elektron Digitakt II.
 */

import { Device, DeviceContext } from './device';
import { OnePole, DCBlocker } from '../dsp/filter';
import { Transport } from '../clock';
import { panStereo } from '../dsp/effects';

export interface Sample {
  name: string;
  dataL: Float32Array;
  dataR: Float32Array;
  sampleRate: number;
  rootNote: number;
}

export interface SampleTrigger {
  sampleName: string;
  sample: number;       // absolute sample position
  velocity: number;
  pitch: number;        // semitone offset
  pan: number;
  start: number;        // 0..1 start position in sample
  length: number;       // samples to play (0 = full)
  retrig?: number;
  retrigRate?: number;
}

export class DigitaktDevice extends Device {
  id = 'digitakt';
  name = 'Elektron Digitakt (Digitakt-V)';
  producesAudio = true;
  consumesAudio = true;

  private sr: number;
  private samples: Map<string, Sample> = new Map();
  private scheduled: SampleTrigger[] = [];
  private activeVoices: {
    sample: Sample; pos: number; pitchRatio: number; vel: number; pan: number;
    length: number; played: number; lp: OnePole;
  }[] = [];
  private dc: DCBlocker;
  /** Resample buffer — captures audio fed into the resampling bus. */
  private resampleBuffer: Float32Array;
  private resamplePos = 0;
  private resampling = false;
  private resampleRecordGain = 1;
  readonly externalHardware = 'Elektron Digitakt II — real stereo sampler + sequencer.';
  peak = 0;
  level = 0.8;

  constructor(transport: Transport) {
    super();
    this.sr = transport.sampleRate;
    this.dc = new DCBlocker();
    this.resampleBuffer = new Float32Array(this.sr * 8); // 8 sec buffer
  }

  loadSample(s: Sample) { this.samples.set(s.name, s); }

  /** Feed audio into the resampling bus (from Apollo OUT3). */
  feedResampleBus(inL: Float32Array, inR: Float32Array, gain: number) {
    if (!this.resampling) return;
    const n = Math.min(inL.length, inR.length);
    for (let i = 0; i < n; i++) {
      this.resampleBuffer[this.resamplePos] = (inL[i] + inR[i]) * 0.5 * gain * this.resampleRecordGain;
      this.resamplePos = (this.resamplePos + 1) % this.resampleBuffer.length;
    }
  }

  startResampling(gain = 1) { this.resampling = true; this.resampleRecordGain = gain; }
  stopResampling() { this.resampling = false; }

  /** Snapshot the current resample buffer as a playable sample. */
  captureResample(name: string, lengthSamples: number): Sample | null {
    if (lengthSamples <= 0) return null;
    const len = Math.min(lengthSamples, this.resampleBuffer.length);
    const dataL = new Float32Array(len);
    const dataR = new Float32Array(len);
    const start = (this.resamplePos - len + this.resampleBuffer.length) % this.resampleBuffer.length;
    for (let i = 0; i < len; i++) {
      const v = this.resampleBuffer[(start + i) % this.resampleBuffer.length];
      dataL[i] = v; dataR[i] = v;
    }
    const s: Sample = { name, dataL, dataR, sampleRate: this.sr, rootNote: 60 };
    this.samples.set(name, s);
    return s;
  }

  trigger(t: SampleTrigger) { this.scheduled.push(t); }

  processBlock(outL: Float32Array, outR: Float32Array, ctx: DeviceContext): void {
    const { blockStart, blockSize } = ctx;
    // fire triggers
    for (const t of this.scheduled) {
      if (t.sample >= blockStart && t.sample < blockStart + blockSize) {
        const s = this.samples.get(t.sampleName);
        if (!s) continue;
        const count = t.retrig ?? 1;
        for (let r = 0; r < count; r++) {
          const trigSample = t.sample + r * (t.retrigRate ?? blockSize);
          if (trigSample >= blockStart && trigSample < blockStart + blockSize) {
            const pitchRatio = Math.pow(2, t.pitch / 12) * (s.sampleRate / this.sr);
            const startIdx = Math.floor(t.start * s.dataL.length);
            const len = t.length > 0 ? t.length : s.dataL.length - startIdx;
            this.activeVoices.push({
              sample: s, pos: startIdx, pitchRatio, vel: t.velocity * (1 - r * 0.1),
              pan: t.pan, length: len, played: 0,
              lp: new OnePole(this.sr, 'lp'),
            });
            this.activeVoices[this.activeVoices.length - 1].lp.setCutoff(8000);
          }
        }
      }
    }

    let peak = 0;
    for (let i = 0; i < blockSize; i++) {
      let sumL = 0, sumR = 0;
      this.activeVoices = this.activeVoices.filter((v) => {
        if (v.played >= v.length) return false;
        const idx = Math.floor(v.pos);
        const next = Math.min(idx + 1, v.sample.dataL.length - 1);
        const frac = v.pos - idx;
        const l = v.sample.dataL[idx] * (1 - frac) + v.sample.dataL[next] * frac;
        const r = v.sample.dataR[idx] * (1 - frac) + v.sample.dataR[next] * frac;
        const fl = v.lp.process(l) * v.vel;
        const [pl, pr] = panStereo(fl, v.pan);
        sumL += pl; sumR += pr * (r / (l || 1)); // crude stereo preservation
        v.pos += v.pitchRatio;
        v.played += 1;
        return v.pos < v.sample.dataL.length;
      });
      const sl = this.dc.process(sumL) * this.level;
      const sr = this.dc.process(sumR) * this.level;
      outL[i] += sl; outR[i] += sr;
      const p = Math.max(Math.abs(sl), Math.abs(sr));
      if (p > peak) peak = p;
    }
    this.peak = Math.max(this.peak, peak);
  }

  reset() {
    this.scheduled = []; this.activeVoices = []; this.dc.reset();
    this.resampleBuffer.fill(0); this.resamplePos = 0; this.resampling = false; this.peak = 0;
  }

  hasSample(name: string): boolean { return this.samples.has(name); }
  listSamples(): string[] { return Array.from(this.samples.keys()); }
}
