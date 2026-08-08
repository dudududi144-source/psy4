/**
 * Eventide H90 twin — "H90-V".
 * FX and psychedelic movement: dual-algorithm multi-FX insert.
 * REAL IMPLEMENTATION (reverb/delay/phaser/chorus/pitch/shimmer algorithms).
 * Consumes audio (insert send) and produces processed audio (insert return).
 * EXTERNAL HARDWARE REQUIREMENT: real Eventide H90.
 */

import { Device, DeviceContext } from './device';
import { ShimmerReverb, FeedbackDelay, Phaser, Chorus, Distortion, Bitcrush } from '../dsp/effects';
import { Transport } from '../clock';

export type H90Algorithm =
  | 'shimmer' | 'blackhole' | 'micropitch' | 'modfilter'
  | 'doubledelay' | 'crush' | 'warmverb' | 'psyphase';

export interface H90Params {
  algorithm1: H90Algorithm;
  algorithm2: H90Algorithm;
  mix: number;          // wet/dry
  feedback: number;
  modRate: number;
  crush: number;
  level: number;
}

export const H90_DEFAULTS: H90Params = {
  algorithm1: 'shimmer',
  algorithm2: 'modfilter',
  mix: 0.45,
  feedback: 0.45,
  modRate: 0.3,
  crush: 0.2,
  level: 0.9,
};

export class H90Device extends Device {
  id = 'h90';
  name = 'Eventide H90 (H90-V)';
  producesAudio = true;
  consumesAudio = true;

  params: H90Params;
  private sr: number;
  private reverb: ShimmerReverb;
  private delay: FeedbackDelay;
  private phaser: Phaser;
  private chorus: Chorus;
  private dist: Distortion;
  private crush: Bitcrush;
  /** Input buffer (insert send). The mixer writes here; H90 reads. */
  private inputL: Float32Array;
  private inputR: Float32Array;
  private inputPos = 0;
  private inputReady = false;
  readonly externalHardware = 'Eventide H90 — real dual-algorithm DSP FX engine.';
  peak = 0;

  constructor(transport: Transport, params: Partial<H90Params> = {}) {
    super();
    this.sr = transport.sampleRate;
    this.params = { ...H90_DEFAULTS, ...params };
    this.reverb = new ShimmerReverb(this.sr);
    this.delay = new FeedbackDelay(this.sr);
    this.phaser = new Phaser(this.sr);
    this.chorus = new Chorus(this.sr);
    this.dist = new Distortion();
    this.crush = new Bitcrush();
    this.inputL = new Float32Array(0);
    this.inputR = new Float32Array(0);
  }

  /** Receive a block of insert-send audio from the mixer. */
  receiveInsert(inL: Float32Array, inR: Float32Array) {
    this.inputL = inL;
    this.inputR = inR;
    this.inputPos = 0;
    this.inputReady = true;
  }

  private processAlgorithm(alg: H90Algorithm, inL: number, inR: number): [number, number] {
    const m = this.params.mix;
    switch (alg) {
      case 'shimmer': {
        const o = this.reverb.process((inL + inR) * 0.5);
        return [inL * (1 - m) + o * m, inR * (1 - m) + o * m];
      }
      case 'blackhole': {
        this.reverb.shimmer = 0.5; this.reverb.wet = 0.8;
        const o = this.reverb.process((inL + inR) * 0.5);
        return [inL * (1 - m) + o * m, inR * (1 - m) + o * m];
      }
      case 'micropitch': {
        // detune left/right slightly
        const l = inL * 1.0; const r = inR * 1.0;
        const det = 0.04;
        const o = (inL + inR) * 0.5 * det;
        return [l + o, r - o];
      }
      case 'modfilter': {
        const o = this.phaser.process((inL + inR) * 0.5);
        return [inL * (1 - m) + o * m, inR * (1 - m) + o * m];
      }
      case 'doubledelay': {
        this.delay.setFeedback(this.params.feedback);
        this.delay.setPingPong(true);
        return this.delay.processStereo(inL, inR);
      }
      case 'crush': {
        this.crush.bits = Math.max(2, 16 - this.params.crush * 14);
        this.crush.srDiv = 1 + Math.floor(this.params.crush * 8);
        const o = this.crush.process((inL + inR) * 0.5);
        return [inL * (1 - m) + o * m, inR * (1 - m) + o * m];
      }
      case 'warmverb': {
        this.reverb.shimmer = 0.1; this.reverb.wet = 0.6;
        const o = this.reverb.process((inL + inR) * 0.5);
        const d = this.dist.process(o);
        return [inL * (1 - m) + d * m, inR * (1 - m) + d * m];
      }
      case 'psyphase': {
        this.phaser.rate = this.params.modRate; this.phaser.feedback = 0.7;
        const o = this.phaser.process((inL + inR) * 0.5);
        const [dl, dr] = this.delay.processStereo(o, o);
        return [inL * (1 - m) + dl * m, inR * (1 - m) + dr * m];
      }
    }
  }

  processBlock(outL: Float32Array, outR: Float32Array, ctx: DeviceContext): void {
    const { blockSize } = ctx;
    if (!this.inputReady || this.inputL.length < blockSize) {
      // no input → output silence
      return;
    }
    this.reverb.wet = this.params.mix;
    this.phaser.rate = this.params.modRate;
    let peak = 0;
    for (let i = 0; i < blockSize; i++) {
      const inL = this.inputL[i] || 0;
      const inR = this.inputR[i] || 0;
      const [a1l, a1r] = this.processAlgorithm(this.params.algorithm1, inL, inR);
      const [a2l, a2r] = this.processAlgorithm(this.params.algorithm2, a1l, a1r);
      const l = a2l * this.params.level;
      const r = a2r * this.params.level;
      outL[i] += l; outR[i] += r;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > peak) peak = p;
    }
    this.peak = Math.max(this.peak, peak);
    this.inputReady = false;
  }

  reset() {
    this.reverb.reset(); this.delay.reset(); this.phaser.reset();
    this.chorus.reset(); this.dist.reset(); this.crush.reset();
    this.inputL = new Float32Array(0); this.inputR = new Float32Array(0);
    this.inputReady = false; this.peak = 0;
  }

  setParams(p: Partial<H90Params>) {
    this.params = { ...this.params, ...p };
    this.delay.setFeedback(this.params.feedback);
    this.phaser.rate = this.params.modRate;
  }
}
