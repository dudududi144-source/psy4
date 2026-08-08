/**
 * Moog Subsequent 37 twin — "SubBass-V".
 * Bass engine: monophonic analog bass + sub design.
 * REAL IMPLEMENTATION (DSP) + SIMULATED HARDWARE BEHAVIOR (mono voice, multidrive ladder).
 * EXTERNAL HARDWARE REQUIREMENT: real Moog Subsequent 37.
 */

import { Device, DeviceContext } from './device';
import { Oscillator } from '../dsp/oscillator';
import { MoogLadder, DCBlocker } from '../dsp/filter';
import { ADSR } from '../dsp/envelope';
import { Transport } from '../clock';
import { mtof } from '../dsp/wavetable';
import { panStereo } from '../dsp/effects';

export interface Sub37Params {
  oscAShape: 'saw' | 'square' | 'triangle';
  oscBShape: 'saw' | 'square' | 'triangle';
  oscBDetune: number;
  subOscLevel: number;     // sub oscillator (1 octave down, square)
  oscMix: number;
  cutoff: number;
  resonance: number;
  multidrive: number;      // 0..1 ladder saturation
  envAmt: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  glide: number;
  pan: number;
  level: number;
}

export const SUB37_DEFAULTS: Sub37Params = {
  oscAShape: 'saw',
  oscBShape: 'square',
  oscBDetune: -0.05,
  subOscLevel: 0.6,
  oscMix: 0.5,
  cutoff: 600,
  resonance: 0.65,
  multidrive: 0.4,
  envAmt: 0.7,
  attack: 0.002,
  decay: 0.12,
  sustain: 0.85,
  release: 0.08,
  glide: 0.005,
  pan: 0,
  level: 0.8,
};

interface BassNote { note: number; vel: number; sample: number; duration: number; fired: boolean; }

export class Sub37Device extends Device {
  id = 'sub37';
  name = 'Moog Subsequent 37 (SubBass-V)';
  producesAudio = true;
  consumesAudio = false;

  params: Sub37Params;
  private sr: number;
  private oscA: Oscillator;
  private oscB: Oscillator;
  private subOsc: Oscillator;
  private filter: MoogLadder;
  private env: ADSR;
  private filterEnv: ADSR;
  private dc: DCBlocker;
  private scheduled: BassNote[] = [];
  private currentNote = 45;
  private targetNote = 45;
  private gateOpen = false;
  private releaseAt = 0;
  private elapsedSinceGate = 0;
  readonly externalHardware = 'Moog Subsequent 37 — real analog multidrive ladder.';
  peak = 0;

  constructor(transport: Transport, params: Partial<Sub37Params> = {}) {
    super();
    this.sr = transport.sampleRate;
    this.params = { ...SUB37_DEFAULTS, ...params };
    this.oscA = new Oscillator(this.params.oscAShape, this.sr, 11);
    this.oscB = new Oscillator(this.params.oscBShape, this.sr, 12);
    this.subOsc = new Oscillator('square', this.sr, 13);
    this.filter = new MoogLadder(this.sr);
    this.dc = new DCBlocker();
    this.env = new ADSR(this.sr);
    this.filterEnv = new ADSR(this.sr);
  }

  noteOn(note: number, velocity: number, sample: number, duration = 0.15) {
    this.scheduled.push({ note, vel: velocity, sample, duration, fired: false });
  }

  private trigger(note: number, vel: number, duration: number) {
    this.targetNote = note;
    this.currentNote = note; // mono: jump (glide handled below if >0)
    this.oscA.setFrequency(mtof(note));
    this.oscB.setFrequency(mtof(note + this.params.oscBDetune));
    this.subOsc.setFrequency(mtof(note - 12));
    this.env.attack = this.params.attack;
    this.env.decay = this.params.decay;
    this.env.sustain = this.params.sustain;
    this.env.release = this.params.release;
    this.env.gate(true);
    this.filterEnv.attack = Math.max(0.001, this.params.attack);
    this.filterEnv.decay = this.params.decay * 1.5;
    this.filterEnv.sustain = this.params.sustain * 0.4;
    this.filterEnv.release = this.params.release;
    this.filterEnv.gate(true);
    this.gateOpen = true;
    this.releaseAt = this.params.attack + duration;
    this.elapsedSinceGate = 0;
    this.currentVelocity = vel;
  }
  private currentVelocity = 0.8;

  processBlock(outL: Float32Array, outR: Float32Array, ctx: DeviceContext): void {
    const { blockStart, blockSize } = ctx;
    for (const n of this.scheduled) {
      if (!n.fired && n.sample <= blockStart + blockSize) {
        const offset = n.sample - blockStart;
        if (offset >= 0 && offset < blockSize) {
          this.trigger(n.note, n.vel, n.duration);
          n.fired = true;
        }
      }
    }

    this.filter.setResonance(this.params.resonance);
    let peak = 0;

    for (let i = 0; i < blockSize; i++) {
      // glide
      if (this.params.glide > 0 && Math.abs(this.currentNote - this.targetNote) > 0.001) {
        const glideRate = 1 / (this.params.glide * this.sr);
        this.currentNote += (this.targetNote - this.currentNote) * Math.min(1, glideRate);
        this.oscA.setFrequency(mtof(this.currentNote));
        this.oscB.setFrequency(mtof(this.currentNote + this.params.oscBDetune));
        this.subOsc.setFrequency(mtof(this.currentNote - 12));
      }

      if (this.gateOpen) {
        this.elapsedSinceGate += 1 / this.sr;
        if (this.elapsedSinceGate >= this.releaseAt) {
          this.env.gate(false);
          this.filterEnv.gate(false);
          this.gateOpen = false;
        }
      }

      const amp = this.env.process();
      const fEnv = this.filterEnv.process();
      if (!this.env.isActive()) {
        // silence
        continue;
      }

      const a = this.oscA.process();
      const b = this.oscB.process();
      const sub = this.subOsc.process();
      let osc = a * (1 - this.params.oscMix) + b * this.params.oscMix;
      osc = osc * 0.7 + sub * this.params.subOscLevel * 0.5;

      const cutoffMod = this.params.cutoff * (1 + fEnv * this.params.envAmt * 4);
      this.filter.setCutoff(cutoffMod);
      // multidrive: pre-filter saturation
      const driven = osc * (1 + this.params.multidrive * 4);
      const filtered = this.filter.process(driven);
      const dc = this.dc.process(filtered);
      const sample = dc * amp * this.currentVelocity * this.params.level;

      const [l, r] = panStereo(sample, this.params.pan);
      outL[i] += l;
      outR[i] += r;
      if (Math.abs(sample) > peak) peak = Math.abs(sample);
    }
    this.peak = Math.max(this.peak, peak);
  }

  reset() {
    this.oscA.reset(); this.oscB.reset(); this.subOsc.reset();
    this.filter.reset(); this.env.reset(); this.filterEnv.reset(); this.dc.reset();
    this.scheduled = []; this.peak = 0; this.gateOpen = false;
  }

  setParams(p: Partial<Sub37Params>) { this.params = { ...this.params, ...p }; }
}
