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
import { BassEngine, BassParams } from '../dsp/bassEngine';

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
  private bassEngine: BassEngine;  // new professional bass engine
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
    // New professional bass engine with sidechain
    this.bassEngine = new BassEngine(this.sr, {
      harmonicShape: this.params.oscAShape,
      subLevel: this.params.subOscLevel,
      harmonicLevel: this.params.oscMix,
      cutoff: this.params.cutoff,
      resonance: this.params.resonance,
      attack: this.params.attack,
      decay: this.params.decay,
      sustain: this.params.sustain,
      release: this.params.release,
      saturation: this.params.multidrive,
      level: this.params.level,
    });
    this.env = new ADSR(this.sr);
    this.filterEnv = new ADSR(this.sr);
  }

  noteOn(note: number, velocity: number, sample: number, duration = 0.15) {
    this.scheduled.push({ note, vel: velocity, sample, duration, fired: false });
  }

  private trigger(note: number, vel: number, duration: number) {
    this.targetNote = note;
    this.currentNote = note;
    // Use the new BassEngine
    this.bassEngine.noteOn(note, vel);
    // schedule note-off
    this.releaseAt = this.params.attack + duration;
    this.elapsedSinceGate = 0;
    this.currentVelocity = vel;
    this.gateOpen = true;
  }
  private currentVelocity = 0.8;

  /** Signal that the kick has fired — for sidechain ducking. */
  kickFired() {
    this.bassEngine.kickFired();
  }

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

    let peak = 0;

    for (let i = 0; i < blockSize; i++) {
      // Check for note-off
      if (this.gateOpen) {
        this.elapsedSinceGate += 1 / this.sr;
        if (this.elapsedSinceGate >= this.releaseAt) {
          this.bassEngine.noteOff();
          this.gateOpen = false;
        }
      }

      // Use the new BassEngine for all audio output
      const sample = this.bassEngine.process();

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
