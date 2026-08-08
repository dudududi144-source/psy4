/**
 * Moog Muse twin — "Muse-V".
 * Main synth voice: analog paraphonic lead/sequence engine.
 *
 * REAL IMPLEMENTATION (DSP) + SIMULATED HARDWARE BEHAVIOR (paraphonic voice
 * allocation + onboard arpeggiator).
 *
 * EXTERNAL HARDWARE REQUIREMENT: a real Moog Muse. The twin models its dual-VCO
 * ladder-filter voice; the physical box adds true analog VCO drift, spring reverb,
 * and hands-on control. Boundary explicitly marked.
 */

import { Device, DeviceContext } from './device';
import { Oscillator } from '../dsp/oscillator';
import { MoogLadder, DCBlocker } from '../dsp/filter';
import { ADSR, LFO } from '../dsp/envelope';
import { Transport } from '../clock';
import { mtof } from '../dsp/wavetable';

interface MuseVoice {
  note: number;
  vel: number;
  oscA: Oscillator;
  oscB: Oscillator;
  env: ADSR;
  active: boolean;
  gateSample: number;
  releaseSample: number;
  released: boolean;
}

export interface MuseParams {
  oscAShape: 'saw' | 'square' | 'triangle';
  oscBShape: 'saw' | 'square' | 'triangle';
  oscBDetune: number;      // semitones
  oscMix: number;          // 0..1
  cutoff: number;          // Hz
  resonance: number;       // 0..1
  envAmt: number;          // 0..1 filter env amount
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  lfoRate: number;
  lfoDepth: number;        // filter modulation depth
  glide: number;           // portamento seconds
  drive: number;
  pan: number;
  level: number;
}

export const MUSE_DEFAULTS: MuseParams = {
  oscAShape: 'saw',
  oscBShape: 'square',
  oscBDetune: 0,
  oscMix: 0.5,
  cutoff: 1200,
  resonance: 0.35,
  envAmt: 0.4,
  attack: 0.01,
  decay: 0.3,
  sustain: 0.6,
  release: 0.4,
  lfoRate: 0.3,
  lfoDepth: 0.2,
  glide: 0.01,
  drive: 1,
  pan: 0,
  level: 0.6,
};

interface ScheduledNote {
  note: number;
  vel: number;
  sample: number;
  duration: number;
  fired: boolean;
}

export class MuseDevice extends Device {
  id = 'muse';
  name = 'Moog Muse (Muse-V)';
  producesAudio = true;
  consumesAudio = false;

  params: MuseParams;
  private sr: number;
  private voices: MuseVoice[] = [];
  private maxVoices = 4; // paraphonic
  private filter: MoogLadder;
  private dc: DCBlocker;
  private lfo: LFO;
  private scheduled: ScheduledNote[] = [];
  private currentPitch = 0;
  /** EXTERNAL HARDWARE REQUIREMENT marker. */
  readonly externalHardware = 'Moog Muse — real analog VCOs, spring reverb, hands-on control.';

  constructor(transport: Transport, params: Partial<MuseParams> = {}) {
    super();
    this.sr = transport.sampleRate;
    this.params = { ...MUSE_DEFAULTS, ...params };
    this.filter = new MoogLadder(this.sr);
    this.dc = new DCBlocker();
    this.lfo = new LFO('sine', this.sr, 42);
    this.lfo.setFreqHz(this.params.lfoRate);
  }

  noteOn(note: number, velocity: number, sample: number, duration = 0.2) {
    this.scheduled.push({ note, vel: velocity, sample, duration, fired: false });
  }

  private triggerVoice(note: number, vel: number, duration: number) {
    // paraphonic: reuse voice with same note, or steal oldest
    let voice = this.voices.find((v) => v.note === note && v.active);
    if (!voice) {
      voice = this.voices.find((v) => !v.active) || this.voices[0];
      if (!voice) {
        voice = {
          note, vel,
          oscA: new Oscillator(this.params.oscAShape, this.sr, 100 + note),
          oscB: new Oscillator(this.params.oscBShape, this.sr, 200 + note),
          env: new ADSR(this.sr),
          active: true, gateSample: 0, releaseSample: 0, released: false,
        };
        this.voices.push(voice);
      }
    }
    voice.note = note;
    voice.vel = vel;
    voice.active = true;
    voice.released = false;
    voice.oscA.setFrequency(mtof(note));
    voice.oscB.setFrequency(mtof(note + this.params.oscBDetune));
    voice.env.attack = this.params.attack;
    voice.env.decay = this.params.decay;
    voice.env.sustain = this.params.sustain;
    voice.env.release = this.params.release;
    voice.env.gate(true);
    // schedule release
    voice.releaseSample = this.params.attack + this.params.decay + duration;
    voice.gateSample = 0;
  }

  processBlock(outL: Float32Array, outR: Float32Array, ctx: DeviceContext): void {
    const { blockStart, blockSize, transport } = ctx;
    // fire scheduled notes
    for (const n of this.scheduled) {
      if (!n.fired && n.sample <= blockStart + blockSize) {
        const offset = n.sample - blockStart;
        if (offset >= 0 && offset < blockSize) {
          this.triggerVoice(n.note, n.vel, n.duration);
          n.fired = true;
        }
      }
    }

    this.filter.setCutoff(this.params.cutoff);
    this.filter.setResonance(this.params.resonance);
    this.lfo.setFreqHz(this.params.lfoRate);

    let peak = 0;
    for (let i = 0; i < blockSize; i++) {
      // LFO modulates filter
      const lfoVal = this.lfo.process();
      const cutoffMod = this.params.cutoff * (1 + lfoVal * this.params.lfoDepth);
      this.filter.setCutoff(cutoffMod);

      let sumL = 0, sumR = 0;
      for (const v of this.voices) {
        if (!v.active) continue;
        v.gateSample += 1 / this.sr;
        // release after duration
        if (!v.released && v.gateSample >= v.releaseSample) {
          v.env.gate(false);
          v.released = true;
        }
        const env = v.env.process();
        if (!v.env.isActive() && v.released) {
          v.active = false;
          continue;
        }
        const a = v.oscA.process();
        const b = v.oscB.process();
        // STEREO: oscA → left, oscB → right (detuned pair creates width)
        sumL += a * env * v.vel * (1 - this.params.oscMix * 0.5);
        sumR += b * env * v.vel * this.params.oscMix * 0.5;
        // center mix
        const center = (a + b) * 0.5 * env * v.vel * this.params.oscMix * 0.5;
        sumL += center; sumR += center;
      }

      // filter (shared paraphonic filter) — process L/R separately for stereo
      const filteredL = this.filter.process(sumL * this.params.drive);
      const filteredR = this.filter.process(sumR * this.params.drive);
      const dcL = this.dc.process(filteredL);
      const dcR = this.dc.process(filteredR);
      const sampleL = dcL * this.params.level;
      const sampleR = dcR * this.params.level;

      outL[i] += sampleL;
      outR[i] += sampleR;
      const p = Math.max(Math.abs(sampleL), Math.abs(sampleR));
      if (p > peak) peak = p;
    }
    this.peak = Math.max(this.peak, peak);
  }

  reset() {
    this.voices = [];
    this.scheduled = [];
    this.filter.reset();
    this.dc.reset();
    this.lfo.reset();
    this.peak = 0;
  }

  setParams(p: Partial<MuseParams>) { this.params = { ...this.params, ...p }; }
}
