/**
 * SHARED SPACE ENGINE — reverb send/return architecture.
 *
 * Instead of independent reverbs on every instrument, shared spaces create
 * cohesive depth. Each instrument sends to one or more spaces.
 *
 * Spaces:
 *   ROOM   — short, tight, for rhythm section presence
 *   PLATE  — medium, for musical elements
 *   HALL   — long, for textures and atmosphere
 *   PSY    — psychedelic space (shimmer + modulation), for FX
 *
 * REAL IMPLEMENTATION.
 */

import { ShimmerReverb } from './effects';
import { OnePole, DCBlocker } from './filter';
import { Oscillator } from './oscillator';
import { LFO } from './envelope';

export type SpaceType = 'room' | 'plate' | 'hall' | 'psy';

export interface SpaceParams {
  decay: number;       // seconds
  preDelay: number;    // seconds
  damping: number;     // Hz (LP cutoff on reverb tail)
  modulation: number;  // 0..1 (for psy space)
  level: number;       // 0..1 return level
}

export const SPACE_PRESETS: Record<SpaceType, SpaceParams> = {
  room:  { decay: 0.4,  preDelay: 0.005, damping: 6000, modulation: 0,    level: 0.4 },
  plate: { decay: 1.2,  preDelay: 0.01,  damping: 4500, modulation: 0,    level: 0.35 },
  hall:  { decay: 3.0,  preDelay: 0.02,  damping: 3000, modulation: 0,    level: 0.3 },
  psy:   { decay: 4.0,  preDelay: 0.03,  damping: 3500, modulation: 0.5,  level: 0.3 },
};

/** A single shared reverb space with send/return. */
export class SharedSpace {
  type: SpaceType;
  params: SpaceParams;
  private sr: number;
  private reverb: ShimmerReverb;
  private dampingFilter: OnePole;
  private modLFO: LFO;
  private dc: DCBlocker;
  private sendBuffer: Float32Array;
  private accumulatedSend = 0;

  constructor(type: SpaceType, sr: number) {
    this.type = type;
    this.sr = sr;
    this.params = { ...SPACE_PRESETS[type] };
    this.reverb = new ShimmerReverb(sr);
    this.reverb.wet = 1;  // wet only (this is a send return)
    this.reverb.dry = 0;
    this.dampingFilter = new OnePole(sr, 'lp');
    this.dampingFilter.setCutoff(this.params.damping);
    this.modLFO = new LFO('sine', sr, 7777);
    this.modLFO.setFreqHz(0.3 + this.params.modulation * 2);
    this.dc = new DCBlocker();
    this.sendBuffer = new Float32Array(0);
  }

  /** Receive a send signal (mono summed from all sources sending to this space). */
  receiveSend(sendL: Float32Array, sendR: Float32Array) {
    // sum to mono for reverb input (reverb is mono-in, stereo-out)
    const n = Math.min(sendL.length, sendR.length);
    if (this.sendBuffer.length !== n) this.sendBuffer = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.sendBuffer[i] = (sendL[i] + sendR[i]) * 0.5;
    }
  }

  /** Process and return stereo reverb output. */
  processReturn(): { l: Float32Array; r: Float32Array } {
    const n = this.sendBuffer.length;
    if (n === 0) return { l: new Float32Array(0), r: new Float32Array(0) };
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // reverb process (mono in → stereo out)
      const reverbOut = this.reverb.process(this.sendBuffer[i]);
      // apply damping
      const damped = this.dampingFilter.process(reverbOut);
      // apply modulation for psy space
      let modulated = damped;
      if (this.params.modulation > 0) {
        const lfo = this.modLFO.process() * this.params.modulation * 0.3;
        modulated = damped * (1 + lfo);
      }
      // DC block + level
      const out = this.dc.process(modulated) * this.params.level;
      // simple stereo spread (slight delay between L/R for width)
      outL[i] = out;
      outR[i] = out * 0.97; // tiny level difference for stereo
    }
    return { l: outL, r: outR };
  }

  reset() {
    this.reverb.reset();
    this.dampingFilter.reset();
    this.modLFO.reset();
    this.dc.reset();
    this.sendBuffer = new Float32Array(0);
  }

  setParams(p: Partial<SpaceParams>) {
    this.params = { ...this.params, ...p };
    this.dampingFilter.setCutoff(this.params.damping);
    this.modLFO.setFreqHz(0.3 + this.params.modulation * 2);
  }
}

/** Complete space engine with all 4 shared spaces. */
export class SpaceEngine {
  private sr: number;
  spaces: Record<SpaceType, SharedSpace>;
  /** Send buffers per space (accumulated from all channels). */
  private sendBuffers: Record<SpaceType, { l: Float32Array; r: Float32Array }>;

  constructor(sr: number) {
    this.sr = sr;
    this.spaces = {
      room: new SharedSpace('room', sr),
      plate: new SharedSpace('plate', sr),
      hall: new SharedSpace('hall', sr),
      psy: new SharedSpace('psy', sr),
    };
    this.sendBuffers = {
      room: { l: new Float32Array(0), r: new Float32Array(0) },
      plate: { l: new Float32Array(0), r: new Float32Array(0) },
      hall: { l: new Float32Array(0), r: new Float32Array(0) },
      psy: { l: new Float32Array(0), r: new Float32Array(0) },
    };
  }

  /** Accumulate a send from a channel into a space. */
  sendTo(space: SpaceType, inL: Float32Array, inR: Float32Array, amount: number) {
    const buf = this.sendBuffers[space];
    const n = Math.min(inL.length, inR.length);
    if (buf.l.length !== n) { buf.l = new Float32Array(n); buf.r = new Float32Array(n); }
    for (let i = 0; i < n; i++) {
      buf.l[i] += inL[i] * amount;
      buf.r[i] += inR[i] * amount;
    }
  }

  /** Process all spaces and return summed stereo return. */
  processReturns(blockSize: number): { l: Float32Array; r: Float32Array } {
    const outL = new Float32Array(blockSize);
    const outR = new Float32Array(blockSize);
    for (const spaceType of ['room', 'plate', 'hall', 'psy'] as SpaceType[]) {
      const space = this.spaces[spaceType];
      const send = this.sendBuffers[spaceType];
      if (send.l.length > 0) {
        space.receiveSend(send.l, send.r);
        const ret = space.processReturn();
        for (let i = 0; i < blockSize && i < ret.l.length; i++) {
          outL[i] += ret.l[i];
          outR[i] += ret.r[i];
        }
        // clear send buffer
        send.l.fill(0);
        send.r.fill(0);
      }
    }
    return { l: outL, r: outR };
  }

  reset() {
    for (const s of ['room', 'plate', 'hall', 'psy'] as SpaceType[]) {
      this.spaces[s].reset();
      this.sendBuffers[s].l = new Float32Array(0);
      this.sendBuffers[s].r = new Float32Array(0);
    }
  }
}
