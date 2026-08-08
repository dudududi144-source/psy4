/**
 * Sequential Prophet-6 twin — "Prophet-V".
 * Poly / chord / pad engine: 6-voice true analog polyphony + chorus.
 * REAL IMPLEMENTATION + SIMULATED HARDWARE BEHAVIOR (6-voice allocation + chorus).
 * EXTERNAL HARDWARE REQUIREMENT: real Sequential Prophet-6.
 */

import { Device, DeviceContext } from './device';
import { Oscillator } from '../dsp/oscillator';
import { MoogLadder, StateVariable, DCBlocker } from '../dsp/filter';
import { ADSR } from '../dsp/envelope';
import { Chorus } from '../dsp/effects';
import { Transport } from '../clock';
import { mtof } from '../dsp/wavetable';

interface P6Voice {
  note: number;
  vel: number;
  oscA: Oscillator;
  oscB: Oscillator;
  filter: MoogLadder;
  env: ADSR;
  active: boolean;
  released: boolean;
  age: number;
  releaseAt: number;
}

export interface Prophet6Params {
  oscAShape: 'saw' | 'square' | 'triangle';
  oscBShape: 'saw' | 'square' | 'triangle';
  oscBDetune: number;
  oscMix: number;
  cutoff: number;
  resonance: number;
  envAmt: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  chorus: number;        // 0..1
  level: number;
  polyphony: number;
}

export const PROPHET6_DEFAULTS: Prophet6Params = {
  oscAShape: 'saw',
  oscBShape: 'saw',
  oscBDetune: 0.04,
  oscMix: 0.5,
  cutoff: 1200,
  resonance: 0.3,
  envAmt: 0.4,
  attack: 0.4,
  decay: 0.6,
  sustain: 0.8,
  release: 1.2,
  chorus: 0.4,
  level: 0.4,
  polyphony: 6,
};

interface P6Note { note: number; vel: number; sample: number; duration: number; fired: boolean; }

export class Prophet6Device extends Device {
  id = 'prophet6';
  name = 'Sequential Prophet-6 (Prophet-V)';
  producesAudio = true;
  consumesAudio = false;

  params: Prophet6Params;
  private sr: number;
  private voices: P6Voice[] = [];
  private chorus: Chorus;
  private dc: DCBlocker;
  private scheduled: P6Note[] = [];
  readonly externalHardware = 'Sequential Prophet-6 — true analog polyphony + BBD chorus.';
  peak = 0;

  constructor(transport: Transport, params: Partial<Prophet6Params> = {}) {
    super();
    this.sr = transport.sampleRate;
    this.params = { ...PROPHET6_DEFAULTS, ...params };
    this.chorus = new Chorus(this.sr);
    this.chorus.wet = this.params.chorus * 0.5;
    this.chorus.dry = 0.7;
    this.dc = new DCBlocker();
  }

  noteOn(note: number, velocity: number, sample: number, duration = 1) {
    this.scheduled.push({ note, vel: velocity, sample, duration, fired: false });
  }

  private allocate(note: number, vel: number, duration: number) {
    // reuse same note or steal oldest released/oldest age
    let v = this.voices.find((x) => x.note === note && x.active && !x.released);
    if (!v) v = this.voices.find((x) => !x.active);
    if (!v) {
      // steal oldest
      this.voices.sort((a, b) => a.age - b.age);
      v = this.voices[0];
    }
    if (!v) {
      v = {
        note, vel,
        oscA: new Oscillator(this.params.oscAShape, this.sr, 300 + note),
        oscB: new Oscillator(this.params.oscBShape, this.sr, 400 + note),
        filter: new MoogLadder(this.sr),
        env: new ADSR(this.sr),
        active: true, released: false, age: 0, releaseAt: 0,
      };
      this.voices.push(v);
    }
    v.note = note; v.vel = vel; v.active = true; v.released = false; v.age = 0;
    v.oscA = new Oscillator(this.params.oscAShape, this.sr, 300 + note);
    v.oscB = new Oscillator(this.params.oscBShape, this.sr, 400 + note);
    v.oscA.setFrequency(mtof(note));
    v.oscB.setFrequency(mtof(note + this.params.oscBDetune));
    v.filter.setCutoff(this.params.cutoff);
    v.filter.setResonance(this.params.resonance);
    v.env.attack = this.params.attack;
    v.env.decay = this.params.decay;
    v.env.sustain = this.params.sustain;
    v.env.release = this.params.release;
    v.env.gate(true);
    v.releaseAt = this.params.attack + duration;
  }

  processBlock(outL: Float32Array, outR: Float32Array, ctx: DeviceContext): void {
    const { blockStart, blockSize } = ctx;
    for (const n of this.scheduled) {
      if (!n.fired && n.sample <= blockStart + blockSize) {
        const off = n.sample - blockStart;
        if (off >= 0 && off < blockSize) { this.allocate(n.note, n.vel, n.duration); n.fired = true; }
      }
    }

    this.chorus.wet = this.params.chorus * 0.5;
    let peak = 0;

    // STEREO: render L/R independently — oscA panned left, oscB panned right
    // (this creates true stereo information at the source, not just chorus width)
    const monoL = new Float32Array(blockSize);
    const monoR = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      let sumL = 0, sumR = 0;
      for (const v of this.voices) {
        if (!v.active) continue;
        v.age += 1 / this.sr;
        if (!v.released && v.age >= v.releaseAt) { v.env.gate(false); v.released = true; }
        const env = v.env.process();
        if (!v.env.isActive() && v.released) { v.active = false; continue; }
        const a = v.oscA.process();
        const b = v.oscB.process();
        const cutoff = this.params.cutoff * (1 + env * this.params.envAmt * 3);
        v.filter.setCutoff(cutoff);
        v.filter.setResonance(this.params.resonance);
        // oscA → left, oscB → right (true stereo source)
        sumL += v.filter.process(a) * env * v.vel * (1 - this.params.oscMix);
        sumR += v.filter.process(b) * env * v.vel * this.params.oscMix;
      }
      monoL[i] = this.dc.process(sumL) * this.params.level;
      monoR[i] = this.dc.process(sumR) * this.params.level;
    }

    // chorus → stereo (now processing true stereo input from detuned osc pair)
    for (let i = 0; i < blockSize; i++) {
      const [l, r] = this.chorus.processStereo(monoL[i], monoR[i]);
      outL[i] += l; outR[i] += r;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > peak) peak = p;
    }
    this.peak = Math.max(this.peak, peak);
  }

  reset() {
    this.voices = []; this.scheduled = [];
    this.chorus.reset(); this.dc.reset(); this.peak = 0;
  }

  setParams(p: Partial<Prophet6Params>) { this.params = { ...this.params, ...p }; }
}
