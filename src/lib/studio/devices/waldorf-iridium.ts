/**
 * Waldorf Iridium twin — "Iridium-V".
 * Digital / wavetable / evolving texture engine.
 * REAL IMPLEMENTATION (wavetable scan + FM + granular-ish + filter + FX).
 * EXTERNAL HARDWARE REQUIREMENT: real Waldorf Iridium Desktop MK2.
 */

import { Device, DeviceContext } from './device';
import { Oscillator, buildWavetable, morphWavetables } from '../dsp/oscillator';
import { StateVariable, DCBlocker } from '../dsp/filter';
import { ADSR, LFO } from '../dsp/envelope';
import { ShimmerReverb, FeedbackDelay, panStereo } from '../dsp/effects';
import { Transport } from '../clock';
import { mtof, WAVETABLE_BANK } from '../dsp/wavetable';
import { Rng } from '../rng';

export interface IridiumParams {
  wtIndexA: number;
  wtIndexB: number;
  wtMorph: number;        // 0..1 morph between A/B over time
  morphRate: number;      // Hz
  fmAmount: number;       // 0..1 (self-FM index)
  cutoff: number;
  resonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  reverb: number;
  delay: number;
  delayFb: number;
  level: number;
  granular: number;       // 0..1 grain cloud density
}

export const IRIDIUM_DEFAULTS: IridiumParams = {
  wtIndexA: 2,
  wtIndexB: 5,
  wtMorph: 0,
  morphRate: 0.08,
  fmAmount: 0.3,
  cutoff: 2400,
  resonance: 0.4,
  attack: 1.5,
  decay: 2.0,
  sustain: 0.8,
  release: 3.0,
  reverb: 0.5,
  delay: 0.3,
  delayFb: 0.4,
  level: 0.35,
  granular: 0.4,
};

interface TextureNote { note: number; vel: number; sample: number; duration: number; fired: boolean; }

export class IridiumDevice extends Device {
  id = 'iridium';
  name = 'Waldorf Iridium (Iridium-V)';
  producesAudio = true;
  consumesAudio = false;

  params: IridiumParams;
  private sr: number;
  private osc: Oscillator;
  private fmOsc: Oscillator;
  private filter: StateVariable;
  private env: ADSR;
  private morphLFO: LFO;
  private reverb: ShimmerReverb;
  private delay: FeedbackDelay;
  private dc: DCBlocker;
  private scheduled: TextureNote[] = [];
  private gateOpen = false;
  private releaseAt = 0;
  private elapsed = 0;
  private vel = 0;
  private rng: Rng;
  private rngSeed: number;
  private granularBuffer: Float32Array;
  private granularPos = 0;
  readonly externalHardware = 'Waldorf Iridium MK2 — real wavetable/granular engine + hardware mod matrix.';
  peak = 0;

  constructor(transport: Transport, params: Partial<IridiumParams> = {}, seed = 777) {
    super();
    this.sr = transport.sampleRate;
    this.params = { ...IRIDIUM_DEFAULTS, ...params };
    this.osc = new Oscillator('wavetable', this.sr, seed);
    this.osc.setWavetable(WAVETABLE_BANK[this.params.wtIndexA].table);
    this.fmOsc = new Oscillator('sine', this.sr, seed + 1);
    this.filter = new StateVariable(this.sr);
    this.env = new ADSR(this.sr);
    this.morphLFO = new LFO('sine', this.sr, seed + 2);
    this.morphLFO.setFreqHz(this.params.morphRate);
    this.reverb = new ShimmerReverb(this.sr);
    this.reverb.wet = this.params.reverb;
    this.delay = new FeedbackDelay(this.sr);
    this.dc = new DCBlocker();
    this.rng = new Rng(seed);
    this.rngSeed = seed;
    this.granularBuffer = new Float32Array(this.sr * 2);
  }

  noteOn(note: number, velocity: number, sample: number, duration = 4) {
    this.scheduled.push({ note, vel: velocity, sample, duration, fired: false });
  }

  private trigger(note: number, vel: number, duration: number) {
    this.osc.setFrequency(mtof(note));
    this.fmOsc.setFrequency(mtof(note) * 2.01);
    this.env.attack = this.params.attack;
    this.env.decay = this.params.decay;
    this.env.sustain = this.params.sustain;
    this.env.release = this.params.release;
    this.env.gate(true);
    this.gateOpen = true;
    this.releaseAt = this.params.attack + duration;
    this.elapsed = 0;
    this.vel = vel;
  }

  processBlock(outL: Float32Array, outR: Float32Array, ctx: DeviceContext): void {
    const { blockStart, blockSize } = ctx;
    for (const n of this.scheduled) {
      if (!n.fired && n.sample <= blockStart + blockSize) {
        const off = n.sample - blockStart;
        if (off >= 0 && off < blockSize) { this.trigger(n.note, n.vel, n.duration); n.fired = true; }
      }
    }

    this.filter.setCutoff(this.params.cutoff);
    this.filter.setQ(0.5 + this.params.resonance * 8);
    this.morphLFO.setFreqHz(this.params.morphRate);
    this.reverb.wet = this.params.reverb;
    this.delay.setFeedback(this.params.delayFb);

    let peak = 0;
    for (let i = 0; i < blockSize; i++) {
      // morph wavetable
      const morphPos = (this.morphLFO.process() + 1) * 0.5 * (0.3 + this.params.granular * 0.7);
      const wtA = WAVETABLE_BANK[this.params.wtIndexA % WAVETABLE_BANK.length].table;
      const wtB = WAVETABLE_BANK[this.params.wtIndexB % WAVETABLE_BANK.length].table;
      this.osc.setWavetable(morphWavetables(wtA, wtB, morphPos));

      if (this.gateOpen) {
        this.elapsed += 1 / this.sr;
        if (this.elapsed >= this.releaseAt) { this.env.gate(false); this.gateOpen = false; }
      }

      const amp = this.env.process();
      if (!this.env.isActive()) continue;

      // FM: fmOsc modulates osc phase
      const fmSig = this.fmOsc.process() * this.params.fmAmount * mtof(60) * 0.5;
      const osc = this.osc.process(fmSig);
      const { low, band } = this.filter.process(osc);
      let sig = low + band * 0.3;

      // granular cloud: randomly grab from granular buffer
      if (this.params.granular > 0 && this.rng.chance(this.params.granular * 0.1)) {
        const g = this.granularBuffer[(this.granularPos - this.rng.int(100, 2000) + this.granularBuffer.length) % this.granularBuffer.length];
        sig += g * 0.3;
      }
      this.granularBuffer[this.granularPos] = sig;
      this.granularPos = (this.granularPos + 1) % this.granularBuffer.length;

      const dc = this.dc.process(sig) * amp * this.vel * this.params.level;
      const rev = this.reverb.process(dc);
      const [dl, dr] = this.delay.processStereo(rev, rev);
      outL[i] += dl; outR[i] += dr;
      const p = Math.max(Math.abs(dl), Math.abs(dr));
      if (p > peak) peak = p;
    }
    this.peak = Math.max(this.peak, peak);
  }

  reset() {
    this.osc.reset(); this.fmOsc.reset(); this.filter.reset(); this.env.reset();
    this.morphLFO.reset(); this.reverb.reset(); this.delay.reset(); this.dc.reset();
    this.scheduled = []; this.gateOpen = false; this.peak = 0;
    this.granularBuffer.fill(0); this.granularPos = 0;
    // Reset RNG to seed so renders are reproducible across reset() calls.
    this.rng = new Rng(this.rngSeed);
  }

  setParams(p: Partial<IridiumParams>) { this.params = { ...this.params, ...p }; }
}
