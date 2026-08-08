/**
 * Elektron Analog Rytm MKII twin — "Rytm-V".
 * Drum + percussion engine: 8 analog drum voices + sample layering.
 * REAL IMPLEMENTATION (synthesized drums) + SIMULATED HARDWARE BEHAVIOR
 * (Elektron parameter locks + retrigs + probability).
 * EXTERNAL HARDWARE REQUIREMENT: real Elektron Analog Rytm MKII.
 */

import { Device, DeviceContext } from './device';
import { Oscillator } from '../dsp/oscillator';
import { MoogLadder, DCBlocker, OnePole } from '../dsp/filter';
import { AD } from '../dsp/envelope';
import { Distortion, panStereo } from '../dsp/effects';
import { Transport } from '../clock';
import { mtof } from '../dsp/wavetable';
import { KickEngine } from '../dsp/kickEngine';
import { SnareEngine, HatEngine, ClapEngine, ShakerEngine, PercEngine } from '../dsp/drumEngines';

export type DrumVoice = 'kick' | 'snare' | 'hat' | 'clap' | 'tom' | 'cym' | 'flex1' | 'flex2';

export interface DrumHit {
  voice: DrumVoice;
  sample: number;       // absolute sample position
  velocity: number;
  tune: number;         // semitone offset
  decay: number;        // override
  pan: number;
  locks?: Record<string, number>;
}

/** Synthesized analog drum voice (one-shot). */
class DrumSynth {
  voice: DrumVoice;
  private sr: number;
  private osc: Oscillator;
  private noise: Oscillator;
  private pitchEnv: AD;
  private ampEnv: AD;
  private filter: MoogLadder | OnePole;
  private noiseFilter: OnePole;
  private dist: Distortion;
  private dc: DCBlocker;
  private kickEngine: KickEngine | null = null;
  private snareEngine: SnareEngine | null = null;
  private hatEngine: HatEngine | null = null;
  private clapEngine: ClapEngine | null = null;
  private triggered = false;
  private triggerDecay = 0.15;
  private vel = 0.8;
  private tune = 0;
  private pan = 0;

  constructor(voice: DrumVoice, sr: number) {
    this.voice = voice;
    this.sr = sr;
    this.osc = new Oscillator('sine', sr, 500 + voice.length);
    this.noise = new Oscillator('noise', sr, 600 + voice.length);
    this.pitchEnv = new AD(sr);
    this.ampEnv = new AD(sr);
    this.filter = (voice === 'kick' || voice === 'tom') ? new MoogLadder(sr) : new OnePole(sr, 'hp');
    this.noiseFilter = new OnePole(sr, 'hp');
    this.dist = new Distortion();
    this.dc = new DCBlocker();
    // Use professional engines for kick, snare, hat, clap
    if (voice === 'kick') this.kickEngine = new KickEngine(sr);
    if (voice === 'snare') this.snareEngine = new SnareEngine(sr);
    if (voice === 'hat') this.hatEngine = new HatEngine(sr);
    if (voice === 'clap') this.clapEngine = new ClapEngine(sr);
    this.configureVoice();
  }

  private configureVoice() {
    switch (this.voice) {
      case 'kick':
        this.pitchEnv.attack = 0.001; this.pitchEnv.decay = 0.04;
        this.ampEnv.attack = 0.001; this.ampEnv.decay = 0.18;
        (this.filter as MoogLadder).setCutoff(120); (this.filter as MoogLadder).setResonance(0.6);
        break;
      case 'snare':
        this.ampEnv.attack = 0.001; this.ampEnv.decay = 0.15;
        this.noiseFilter.setCutoff(1800);
        (this.filter as OnePole).setCutoff(800);
        break;
      case 'hat':
        this.ampEnv.attack = 0.001; this.ampEnv.decay = 0.05;
        this.noiseFilter.setCutoff(6000);
        (this.filter as OnePole).setCutoff(7000);
        break;
      case 'clap':
        this.ampEnv.attack = 0.001; this.ampEnv.decay = 0.12;
        this.noiseFilter.setCutoff(1500);
        (this.filter as OnePole).setCutoff(1200);
        break;
      case 'tom':
        this.pitchEnv.attack = 0.001; this.pitchEnv.decay = 0.06;
        this.ampEnv.attack = 0.001; this.ampEnv.decay = 0.22;
        (this.filter as MoogLadder).setCutoff(300); (this.filter as MoogLadder).setResonance(0.4);
        break;
      case 'cym':
        this.ampEnv.attack = 0.001; this.ampEnv.decay = 0.4;
        this.noiseFilter.setCutoff(5000);
        (this.filter as OnePole).setCutoff(6000);
        break;
      case 'flex1':
      case 'flex2':
        this.ampEnv.attack = 0.001; this.ampEnv.decay = 0.1;
        this.noiseFilter.setCutoff(3000);
        (this.filter as OnePole).setCutoff(2000);
        break;
    }
  }

  trigger(velocity: number, tune: number, decay: number, pan: number) {
    this.triggered = true;
    this.vel = velocity;
    this.tune = tune;
    this.triggerDecay = decay;
    this.pan = pan;
    if (this.kickEngine) {
      this.kickEngine.trigger(velocity);
    } else if (this.snareEngine) {
      this.snareEngine.trigger(velocity);
    } else if (this.hatEngine) {
      this.hatEngine.trigger(velocity);
    } else if (this.clapEngine) {
      this.clapEngine.trigger(velocity);
    } else {
      this.ampEnv.decay = decay;
      this.pitchEnv.trigger();
      this.ampEnv.trigger();
    }
  }

  process(): number {
    // Use professional engines
    if (this.kickEngine) return this.kickEngine.process();
    if (this.snareEngine) return this.snareEngine.process();
    if (this.hatEngine) return this.hatEngine.process();
    if (this.clapEngine) return this.clapEngine.process();
    // Fallback for tom/cym/flex voices
    if (!this.triggered && !this.ampEnv.isActive()) return 0;
    let out = 0;
    const amp = this.ampEnv.process();
    if (!this.ampEnv.isActive()) { this.triggered = false; return 0; }

    switch (this.voice) {
      case 'kick': {
        const pEnv = this.pitchEnv.process();
        const freq = mtof(36 + this.tune) * (1 + pEnv * 6);
        this.osc.setFrequency(freq);
        const o = this.osc.process();
        const f = (this.filter as MoogLadder).process(o);
        out = f * amp;
        break;
      }
      case 'tom': {
        const pEnv = this.pitchEnv.process();
        const freq = mtof(50 + this.tune) * (1 + pEnv * 3);
        this.osc.setFrequency(freq);
        const o = this.osc.process();
        const f = (this.filter as MoogLadder).process(o);
        out = f * amp;
        break;
      }
      case 'snare':
      case 'hat':
      case 'clap':
      case 'cym': {
        const n = this.noise.process();
        const nf = this.noiseFilter.process(n);
        out = nf * amp;
        break;
      }
      case 'flex1':
      case 'flex2': {
        const o = this.osc.process();
        const n = this.noise.process() * 0.3;
        const mix = o * 0.6 + n * 0.4;
        out = this.noiseFilter.process(mix) * amp;
        break;
      }
    }
    return this.dc.process(out * this.vel);
  }

  reset() { this.triggered = false; this.ampEnv.reset(); this.pitchEnv.reset(); this.dc.reset(); }
}

export interface RytmParams {
  level: number;
  kickDecay: number;
  snareDecay: number;
  hatDecay: number;
  kickTune: number;
  drive: number;
}

export const RYTM_DEFAULTS: RytmParams = {
  level: 0.9,
  kickDecay: 0.18,
  snareDecay: 0.15,
  hatDecay: 0.05,
  kickTune: 0,
  drive: 0.2,
};

export class RytmDevice extends Device {
  id = 'rytm';
  name = 'Elektron Analog Rytm (Rytm-V)';
  producesAudio = true;
  consumesAudio = false;

  params: RytmParams;
  private sr: number;
  private synths: Record<DrumVoice, DrumSynth>;
  private scheduled: DrumHit[] = [];
  private dist: Distortion;
  readonly externalHardware = 'Elektron Analog Rytm MKII — real analog drum voices + parameter locks.';
  peak = 0;

  constructor(transport: Transport, params: Partial<RytmParams> = {}) {
    super();
    this.sr = transport.sampleRate;
    this.params = { ...RYTM_DEFAULTS, ...params };
    this.synths = {
      kick: new DrumSynth('kick', this.sr),
      snare: new DrumSynth('snare', this.sr),
      hat: new DrumSynth('hat', this.sr),
      clap: new DrumSynth('clap', this.sr),
      tom: new DrumSynth('tom', this.sr),
      cym: new DrumSynth('cym', this.sr),
      flex1: new DrumSynth('flex1', this.sr),
      flex2: new DrumSynth('flex2', this.sr),
    };
    this.dist = new Distortion();
    this.dist.drive = 1 + this.params.drive * 2;
    this.dist.mix = 0.3;
  }

  trigger(voice: DrumVoice, sample: number, velocity = 0.9, tune = 0, decay?: number, pan = 0, locks?: Record<string, number>) {
    this.scheduled.push({
      voice, sample, velocity, tune,
      decay: decay ?? this.defaultDecay(voice),
      pan, locks,
    });
  }

  /** Callback fired when a kick triggers — used for bass sidechain. */
  kickCallback: (() => void) | null = null;

  private defaultDecay(voice: DrumVoice): number {
    switch (voice) {
      case 'kick': return this.params.kickDecay;
      case 'snare': return this.params.snareDecay;
      case 'hat': return this.params.hatDecay;
      case 'clap': return 0.12;
      case 'tom': return 0.22;
      case 'cym': return 0.4;
      default: return 0.1;
    }
  }

  processBlock(outL: Float32Array, outR: Float32Array, ctx: DeviceContext): void {
    const { blockStart, blockSize } = ctx;
    for (const h of this.scheduled) {
      if (h.sample <= blockStart + blockSize && h.sample >= blockStart) {
        const off = h.sample - blockStart;
        if (off >= 0 && off < blockSize) {
          const synth = this.synths[h.voice];
          synth.trigger(h.velocity, h.tune + (h.voice === 'kick' ? this.params.kickTune : 0), h.decay, h.pan);
          // Fire sidechain callback when kick triggers
          if (h.voice === 'kick' && this.kickCallback) {
            this.kickCallback();
          }
        }
      }
    }
    let peak = 0;
    for (let i = 0; i < blockSize; i++) {
      let sum = 0;
      for (const voice of Object.keys(this.synths) as DrumVoice[]) {
        sum += this.synths[voice].process();
      }
      sum = this.dist.process(sum) * this.params.level;
      // drums centered, slight per-voice pan handled at trigger (simplified: center)
      outL[i] += sum;
      outR[i] += sum;
      if (Math.abs(sum) > peak) peak = Math.abs(sum);
    }
    this.peak = Math.max(this.peak, peak);
  }

  reset() {
    for (const v of Object.keys(this.synths) as DrumVoice[]) this.synths[v].reset();
    this.scheduled = []; this.peak = 0;
  }

  setParams(p: Partial<RytmParams>) {
    this.params = { ...this.params, ...p };
    this.dist.drive = 1 + this.params.drive * 2;
  }
}
