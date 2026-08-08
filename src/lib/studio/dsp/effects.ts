/**
 * DSP PRIMITIVES — Effects.
 * REAL IMPLEMENTATION. All process real sample streams.
 *
 * These model the H90 algorithm families used in the rig:
 * - ShimmerReverb  → pitch-shifted reverb tail (shimmer)
 * - FeedbackDelay  → tempo-synced delay with feedback cap (psychedelic motion)
 * - Chorus         → modulated short delays ( Prophet-style )
 * - Phaser         → allpass cascade (psy modfilter)
 * - Distortion     → soft/hard clip (Rytm analog drive)
 * - Bitcrush       → sample-rate + bit reduction (destroy algorithms)
 * - Limiter        → brick-wall master protection
 */

import { OnePole } from './filter';

/** Tempo-synced feedback delay with feedback cap (feedback-safe). */
export class FeedbackDelay {
  private sr: number;
  private buffer: Float32Array;
  private writePos = 0;
  private delaySamples = 0;
  feedback = 0.4;       // capped at 0.95
  wet = 0.35;
  dry = 1;
  private lp: OnePole;
  private pingPong = false;
  private panL = 0;
  private panR = 0;

  constructor(sampleRate: number, maxSeconds = 5) {
    this.sr = sampleRate;
    this.buffer = new Float32Array(Math.ceil(maxSeconds * sampleRate));
    this.lp = new OnePole(sampleRate, 'lp');
    this.lp.setCutoff(8000);
  }

  setDelaySeconds(s: number) {
    this.delaySamples = Math.max(1, Math.min(this.buffer.length - 2, Math.floor(s * this.sr)));
  }
  setDelaySync(bpm: number, div: number) {
    // div = 1 = quarter, 0.5 = eighth, etc.
    const sec = (60 / bpm) * div;
    this.setDelaySeconds(sec);
  }
  setFeedback(f: number) { this.feedback = Math.max(0, Math.min(0.95, f)); }
  setPingPong(on: boolean) { this.pingPong = on; }

  processStereo(inL: number, inR: number): [number, number] {
    const buf = this.buffer;
    const n = buf.length;
    const readPos = (this.writePos - this.delaySamples + n) % n;
    const delayed = buf[readPos];
    // tone control on feedback
    const toned = this.lp.process(delayed);
    const fb = toned * this.feedback;
    buf[this.writePos] = inL + fb;
    this.writePos = (this.writePos + 1) % n;

    if (this.pingPong) {
      // simple ping-pong: alternate channels across buffer halves
      const readPos2 = (this.writePos - Math.floor(this.delaySamples * 0.5) + n) % n;
      const delayed2 = buf[readPos2];
      return [
        inL * this.dry + delayed * this.wet,
        inR * this.dry + delayed2 * this.wet,
      ];
    }
    return [
      inL * this.dry + delayed * this.wet,
      inR * this.dry + delayed * this.wet,
    ];
  }

  reset() { this.buffer.fill(0); this.writePos = 0; this.lp.reset(); }
}

/** Schroeder-ish reverb with a pitch-shimmer layer (shimmer). */
export class ShimmerReverb {
  private sr: number;
  private combs: { buffer: Float32Array; pos: number; feedback: number; damp: OnePole }[] = [];
  private allpasses: { buffer: Float32Array; pos: number; feedback: number }[] = [];
  wet = 0.4;
  dry = 0.8;
  shimmer = 0.25;     // 0..1 amount of pitch-shifted tail
  preDelay = 0.02;
  private preBuf: Float32Array;
  private prePos = 0;
  private pitchPhase = 0;
  private pitchRatio = 1.5; // up a fifth for shimmer
  private pitchBuf: Float32Array;
  private pitchPos = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    // 4 comb filters (prime-tuned lengths)
    const combLens = [1116, 1188, 1277, 1356].map((l) => Math.floor(l * sampleRate / 44100));
    const combFbs = [0.74, 0.72, 0.70, 0.68];
    for (let i = 0; i < 4; i++) {
      this.combs.push({
        buffer: new Float32Array(combLens[i]),
        pos: 0,
        feedback: combFbs[i],
        damp: new OnePole(sampleRate, 'lp'),
      });
      this.combs[i].damp.setCutoff(4500);
    }
    const apLens = [556, 441, 341, 225].map((l) => Math.floor(l * sampleRate / 44100));
    const apFbs = [0.5, 0.5, 0.5, 0.5];
    for (let i = 0; i < 4; i++) {
      this.allpasses.push({ buffer: new Float32Array(apLens[i]), pos: 0, feedback: apFbs[i] });
    }
    this.preBuf = new Float32Array(Math.ceil(this.preDelay * sampleRate));
    this.pitchBuf = new Float32Array(Math.ceil(0.08 * sampleRate)); // 80ms pitch buffer
  }

  private readInterp(buf: Float32Array, pos: number): number {
    const i0 = Math.floor(pos);
    const i1 = (i0 + 1) % buf.length;
    const f = pos - i0;
    return buf[i0] * (1 - f) + buf[i1] * f;
  }

  process(input: number): number {
    // pre-delay
    const preOut = this.preBuf[this.prePos];
    this.preBuf[this.prePos] = input;
    this.prePos = (this.prePos + 1) % this.preBuf.length;

    // pitch-shifted version (granular-ish: read at ratio, wrap)
    this.pitchBuf[this.pitchPos] = preOut;
    this.pitchPos = (this.pitchPos + 1) % this.pitchBuf.length;
    this.pitchPhase += this.pitchRatio;
    if (this.pitchPhase >= this.pitchBuf.length) this.pitchPhase -= this.pitchBuf.length;
    const pitched = this.readInterp(this.pitchBuf, this.pitchPhase);

    const wetIn = preOut + pitched * this.shimmer;

    // combs
    let combSum = 0;
    for (const c of this.combs) {
      const out = c.buffer[c.pos];
      const filtered = c.damp.process(out);
      c.buffer[c.pos] = wetIn + filtered * c.feedback;
      c.pos = (c.pos + 1) % c.buffer.length;
      combSum += out;
    }
    // allpasses
    let ap = combSum / 4;
    for (const a of this.allpasses) {
      const bufOut = a.buffer[a.pos];
      const v = -ap + bufOut;
      a.buffer[a.pos] = ap + bufOut * a.feedback;
      a.pos = (a.pos + 1) % a.buffer.length;
      ap = v;
    }
    return input * this.dry + ap * this.wet;
  }

  reset() {
    for (const c of this.combs) { c.buffer.fill(0); c.pos = 0; c.damp.reset(); }
    for (const a of this.allpasses) { a.buffer.fill(0); a.pos = 0; }
    this.preBuf.fill(0); this.prePos = 0;
    this.pitchBuf.fill(0); this.pitchPos = 0; this.pitchPhase = 0;
  }
}

/** Chorus — modulated short delays, stereo spread. */
export class Chorus {
  private sr: number;
  private buf: Float32Array;
  private pos = 0;
  private lfoPhase = 0;
  rate = 0.5;       // Hz
  depth = 0.003;    // seconds
  baseDelay = 0.015;
  wet = 0.45;
  dry = 0.7;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.buf = new Float32Array(Math.ceil(0.05 * sampleRate));
  }

  processStereo(inL: number, inR: number): [number, number] {
    this.buf[this.pos] = (inL + inR) * 0.5;
    const lfo = Math.sin(2 * Math.PI * this.lfoPhase);
    const lfo2 = Math.sin(2 * Math.PI * this.lfoPhase + Math.PI / 2);
    const d1 = (this.baseDelay + this.depth * lfo) * this.sr;
    const d2 = (this.baseDelay + this.depth * lfo2) * this.sr;
    const n = this.buf.length;
    const r1 = (this.pos - d1 + n) % n;
    const r2 = (this.pos - d2 + n) % n;
    const o1 = this.read(r1);
    const o2 = this.read(r2);
    this.pos = (this.pos + 1) % n;
    this.lfoPhase += this.rate / this.sr;
    if (this.lfoPhase >= 1) this.lfoPhase -= 1;
    return [
      inL * this.dry + o1 * this.wet,
      inR * this.dry + o2 * this.wet,
    ];
  }

  private read(pos: number): number {
    const i0 = Math.floor(pos);
    const i1 = (i0 + 1) % this.buf.length;
    const f = pos - i0;
    return this.buf[i0] * (1 - f) + this.buf[i1] * f;
  }

  reset() { this.buf.fill(0); this.pos = 0; this.lfoPhase = 0; }
}

/** Phaser — allpass cascade modulated by LFO. */
export class Phaser {
  private sr: number;
  private stages = 6;
  private allpass: { a1: number; z1: number }[] = [];
  private lfoPhase = 0;
  rate = 0.2;
  depth = 0.6;
  baseFreq = 800;
  feedback = 0.3;
  private fbState = 0;
  wet = 0.6;
  dry = 0.5;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    for (let i = 0; i < this.stages; i++) this.allpass.push({ a1: 0, z1: 0 });
  }

  process(input: number): number {
    const lfo = (Math.sin(2 * Math.PI * this.lfoPhase) + 1) * 0.5; // 0..1
    const freq = this.baseFreq * (1 + this.depth * lfo * 4);
    const tan = Math.tan(Math.PI * freq / this.sr);
    const a1 = (1 - tan) / (1 + tan);
    let sig = input + this.fbState * this.feedback;
    for (const ap of this.allpass) {
      ap.a1 = a1;
      const out = ap.z1 + sig * ap.a1;
      ap.z1 = sig - out * ap.a1;
      sig = out;
    }
    this.fbState = sig;
    this.lfoPhase += this.rate / this.sr;
    if (this.lfoPhase >= 1) this.lfoPhase -= 1;
    return input * this.dry + sig * this.wet;
  }

  reset() { for (const ap of this.allpass) ap.z1 = 0; this.fbState = 0; this.lfoPhase = 0; }
}

/** Distortion — soft clip with drive. */
export class Distortion {
  drive = 1;
  mix = 1;
  private dc = 0;
  process(input: number): number {
    const d = input * this.drive;
    // tanh soft clip
    const shaped = Math.tanh(d);
    return shaped * this.mix + input * (1 - this.mix);
  }
  reset() {}
}

/** Bitcrusher — sample rate + bit reduction. */
export class Bitcrush {
  bits = 16;
  srDiv = 1; // downsample factor
  private held = 0;
  private counter = 0;
  process(input: number): number {
    this.counter += 1;
    if (this.counter >= this.srDiv) {
      this.counter = 0;
      const levels = Math.pow(2, this.bits) - 1;
      this.held = Math.round(input * levels / 2) / (levels / 2);
    }
    return this.held;
  }
  reset() { this.held = 0; this.counter = 0; }
}

/** Stereo limiter — brick-wall, lookahead-free, for master safety. */
export class Limiter {
  private sr: number;
  ceiling = 0.97;
  release = 0.05;
  private gain = 1;
  private env = 0;

  constructor(sampleRate: number) { this.sr = sampleRate; }

  processStereo(inL: number, inR: number): [number, number] {
    const peak = Math.max(Math.abs(inL), Math.abs(inR));
    const targetGain = peak > this.ceiling ? this.ceiling / peak : 1;
    // envelope follower for release
    if (targetGain < this.gain) {
      this.gain = targetGain; // instant attack
    } else {
      this.gain += (1 - this.gain) * Math.min(1, 1 / (this.release * this.sr));
    }
    return [inL * this.gain, inR * this.gain];
  }
  reset() { this.gain = 1; this.env = 0; }
}

/** Stereo panner. */
export function panStereo(sample: number, pan: number): [number, number] {
  // constant-power pan
  const p = (pan + 1) * 0.5; // 0..1
  const l = Math.cos(p * Math.PI * 0.5);
  const r = Math.sin(p * Math.PI * 0.5);
  return [sample * l, sample * r];
}
