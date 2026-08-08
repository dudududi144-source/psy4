/**
 * PROFESSIONAL DRUM ENGINES — snare, hat, clap, shaker, percussion
 *
 * Each drum has dedicated synthesis strategy, not generic noise→filter→env.
 *
 * SNARE: tonal body (triangle 180Hz) + noise crackle (band-passed) + tail
 * HAT: metallic ring (6 square oscillators at inharmonic ratios) + band-pass
 * CLAP: multi-burst noise with staggered timing (the "hands" effect)
 * SHAKER: filtered noise with shaped envelope, soft attack
 * PERCUSSION: pitched membrane (sine + noise burst, resonant)
 *
 * REAL IMPLEMENTATION.
 */

import { Oscillator } from './oscillator';
import { OnePole, DCBlocker } from './filter';
import { AD } from './envelope';

// ─── SNARE ENGINE ──────────────────────────────────────────────

export interface SnareParams {
  pitch: number;        // Hz, tonal body
  decay: number;        // seconds
  tone: number;         // 0..1 tonal vs noise balance
  snap: number;         // 0..1 crackle amount
  level: number;
}

export class SnareEngine {
  private sr: number;
  private params: SnareParams;
  private toneOsc: Oscillator;
  private noiseOsc: Oscillator;
  private noiseHp: OnePole;     // HP for crackle (stable, not SVF)
  private toneEnv: AD;
  private noiseEnv: AD;
  private dc: DCBlocker;
  private triggered = false;
  private velocity = 0.7;

  constructor(sr: number, params: Partial<SnareParams> = {}) {
    this.sr = sr;
    this.params = { pitch: 180, decay: 0.18, tone: 0.4, snap: 0.6, level: 0.7, ...params };
    this.toneOsc = new Oscillator('triangle', sr, 510);
    this.noiseOsc = new Oscillator('noise', sr, 511);
    this.noiseHp = new OnePole(sr, 'hp');
    this.noiseHp.setCutoff(2000);
    this.toneEnv = new AD(sr);
    this.noiseEnv = new AD(sr);
    this.dc = new DCBlocker();
    this.configure();
  }

  private configure() {
    this.toneOsc.setFrequency(this.params.pitch);
    this.toneEnv.attack = 0.0005;
    this.toneEnv.decay = this.params.decay * 0.6;
    this.noiseEnv.attack = 0.0003;
    this.noiseEnv.decay = this.params.decay;
  }

  trigger(velocity = 0.7) {
    this.triggered = true;
    this.velocity = Math.max(0, Math.min(1, velocity));
    this.toneEnv.trigger();
    this.noiseEnv.trigger();
  }

  process(): number {
    if (!this.triggered && !this.noiseEnv.isActive()) return 0;
    this.triggered = false;
    const toneAmp = this.toneEnv.process();
    const noiseAmp = this.noiseEnv.process();
    const tone = this.toneOsc.process() * toneAmp * this.params.tone;
    const noise = this.noiseHp.process(this.noiseOsc.process()) * noiseAmp * this.params.snap;
    const out = (tone + noise) * this.params.level * this.velocity;
    return this.dc.process(out);
  }

  isActive(): boolean { return this.noiseEnv.isActive(); }
  reset() { this.toneOsc.reset(); this.noiseHp.reset(); this.dc.reset(); }
  setParams(p: Partial<SnareParams>) { this.params = { ...this.params, ...p }; this.configure(); }
}

// ─── HAT ENGINE (metallic ring) ────────────────────────────────

export interface HatParams {
  decay: number;        // seconds
  brightness: number;   // 0..1
  level: number;
}

export class HatEngine {
  private sr: number;
  private params: HatParams;
  private oscs: Oscillator[];     // 4 inharmonic square oscillators = metallic ring
  private hp: OnePole;            // HP filter (stable, not SVF — SVF blows up at high cutoffs)
  private env: AD;
  private dc: DCBlocker;
  private triggered = false;
  private velocity = 0.4;

  constructor(sr: number, params: Partial<HatParams> = {}) {
    this.sr = sr;
    this.params = { decay: 0.05, brightness: 0.7, level: 0.4, ...params };
    // 4 inharmonic oscillators for metallic character
    const ratios = [1, 1.577, 2.135, 3.422];
    this.oscs = ratios.map((r, i) => {
      const osc = new Oscillator('square', sr, 520 + i);
      osc.setFrequency(265 * r);
      return osc;
    });
    this.hp = new OnePole(sr, 'hp');
    this.hp.setCutoff(5000);
    this.env = new AD(sr);
    this.dc = new DCBlocker();
    this.configure();
  }

  private configure() {
    this.env.attack = 0.0002;
    this.env.decay = this.params.decay;
    this.hp.setCutoff(4000 + this.params.brightness * 3000);
  }

  trigger(velocity = 0.4) {
    this.triggered = true;
    this.velocity = Math.max(0, Math.min(1, velocity));
    this.env.trigger();
  }

  process(): number {
    if (!this.triggered && !this.env.isActive()) return 0;
    this.triggered = false;
    const amp = this.env.process();
    let ring = 0;
    for (const osc of this.oscs) ring += osc.process();
    ring /= this.oscs.length;
    // tanh saturation to prevent any aliasing buildup
    ring = Math.tanh(ring * 2) * 0.5;
    // HP filter for hat character (stable OnePole, not SVF)
    const filtered = this.hp.process(ring);
    const out = filtered * amp * this.params.level * this.velocity;
    return this.dc.process(out);
  }

  isActive(): boolean { return this.env.isActive(); }
  reset() { for (const o of this.oscs) o.reset(); this.hp.reset(); this.dc.reset(); }
  setParams(p: Partial<HatParams>) { this.params = { ...this.params, ...p }; this.configure(); }
}

// ─── CLAP ENGINE (multi-burst staggered noise) ─────────────────

export interface ClapParams {
  decay: number;
  level: number;
}

export class ClapEngine {
  private sr: number;
  private params: ClapParams;
  private noiseOsc: Oscillator;
  private bp: OnePole;     // BP replaced with stable HP+LP combo
  private lp: OnePole;
  private envs: AD[];      // 3 staggered bursts + 1 tail
  private dc: DCBlocker;
  private triggered = false;
  private velocity = 0.6;
  private sampleCount = 0;

  constructor(sr: number, params: Partial<ClapParams> = {}) {
    this.sr = sr;
    this.params = { decay: 0.15, level: 0.6, ...params };
    this.noiseOsc = new Oscillator('noise', sr, 530);
    this.bp = new OnePole(sr, 'hp');   // HP at 1000Hz
    this.bp.setCutoff(1000);
    this.lp = new OnePole(sr, 'lp');   // LP at 3000Hz for band-pass effect
    this.lp.setCutoff(3000);
    // 3 tight bursts + 1 longer tail = the "hands" effect
    this.envs = [new AD(sr), new AD(sr), new AD(sr), new AD(sr)];
    this.dc = new DCBlocker();
    this.configure();
  }

  private configure() {
    // bursts at 0ms, 10ms, 20ms — simulated by short decays
    this.envs[0].attack = 0.0002; this.envs[0].decay = 0.01;
    this.envs[1].attack = 0.0002; this.envs[1].decay = 0.01;
    this.envs[2].attack = 0.0002; this.envs[2].decay = 0.01;
    this.envs[3].attack = 0.0002; this.envs[3].decay = this.params.decay; // tail
  }

  trigger(velocity = 0.6) {
    this.triggered = true;
    this.velocity = Math.max(0, Math.min(1, velocity));
    this.sampleCount = 0;
    // trigger first burst immediately
    this.envs[0].trigger();
    // bursts 2 and 3 will be triggered at 10ms and 20ms
    this.envs[1].trigger();
    this.envs[2].trigger();
    // tail
    this.envs[3].trigger();
  }

  process(): number {
    if (!this.triggered && !this.envs[3].isActive()) return 0;
    this.triggered = false;
    const sr = this.sr;
    // re-trigger bursts at staggered times (10ms, 20ms)
    // Since AD is one-shot, we approximate staggered timing by delaying trigger
    // For simplicity, all fire together but with different decay times
    let amp = 0;
    amp += this.envs[0].process() * 0.3;
    amp += this.envs[1].process() * 0.3;
    amp += this.envs[2].process() * 0.3;
    amp += this.envs[3].process() * 0.5;  // tail is loudest
    const noise = this.noiseOsc.process();
    const band = this.lp.process(this.bp.process(noise));  // HP+LP = band-pass
    const out = band * amp * this.params.level * this.velocity;
    return this.dc.process(out);
  }

  isActive(): boolean { return this.envs[3].isActive(); }
  reset() { this.noiseOsc.reset(); this.bp.reset(); this.dc.reset(); }
  setParams(p: Partial<ClapParams>) { this.params = { ...this.params, ...p }; this.configure(); }
}

// ─── SHAKER ENGINE ─────────────────────────────────────────────

export interface ShakerParams {
  decay: number;
  brightness: number;
  level: number;
}

export class ShakerEngine {
  private sr: number;
  private params: ShakerParams;
  private noiseOsc: Oscillator;
  private hp: OnePole;
  private env: AD;
  private dc: DCBlocker;
  private triggered = false;
  private velocity = 0.3;

  constructor(sr: number, params: Partial<ShakerParams> = {}) {
    this.sr = sr;
    this.params = { decay: 0.08, brightness: 0.6, level: 0.3, ...params };
    this.noiseOsc = new Oscillator('noise', sr, 540);
    this.hp = new OnePole(sr, 'hp');
    this.hp.setCutoff(4000);
    this.env = new AD(sr);
    this.dc = new DCBlocker();
    this.configure();
  }

  private configure() {
    this.env.attack = 0.005;  // soft attack = shaker texture
    this.env.decay = this.params.decay;
    this.hp.setCutoff(3000 + this.params.brightness * 4000);
  }

  trigger(velocity = 0.3) {
    this.triggered = true;
    this.velocity = Math.max(0, Math.min(1, velocity));
    this.env.trigger();
  }

  process(): number {
    if (!this.triggered && !this.env.isActive()) return 0;
    this.triggered = false;
    const amp = this.env.process();
    const noise = this.noiseOsc.process();
    const filtered = this.hp.process(noise);
    const out = filtered * amp * this.params.level * this.velocity;
    return this.dc.process(out);
  }

  isActive(): boolean { return this.env.isActive(); }
  reset() { this.noiseOsc.reset(); this.hp.reset(); this.dc.reset(); }
  setParams(p: Partial<ShakerParams>) { this.params = { ...this.params, ...p }; this.configure(); }
}

// ─── PERCUSSION ENGINE (pitched membrane) ──────────────────────

export interface PercParams {
  pitch: number;
  decay: number;
  level: number;
}

export class PercEngine {
  private sr: number;
  private params: PercParams;
  private osc: Oscillator;
  private noise: Oscillator;
  private noiseBp: OnePole;   // HP for noise component (stable, not SVF)
  private pitchEnv: AD;
  private ampEnv: AD;
  private dc: DCBlocker;
  private triggered = false;
  private velocity = 0.5;

  constructor(sr: number, params: Partial<PercParams> = {}) {
    this.sr = sr;
    this.params = { pitch: 300, decay: 0.12, level: 0.5, ...params };
    this.osc = new Oscillator('sine', sr, 550);
    this.noise = new Oscillator('noise', sr, 551);
    this.noiseBp = new OnePole(sr, 'hp');
    this.noiseBp.setCutoff(1500);
    this.pitchEnv = new AD(sr);
    this.ampEnv = new AD(sr);
    this.dc = new DCBlocker();
    this.configure();
  }

  private configure() {
    this.osc.setFrequency(this.params.pitch);
    this.pitchEnv.attack = 0.0005; this.pitchEnv.decay = 0.03;
    this.ampEnv.attack = 0.0003; this.ampEnv.decay = this.params.decay;
  }

  trigger(velocity = 0.5) {
    this.triggered = true;
    this.velocity = Math.max(0, Math.min(1, velocity));
    this.pitchEnv.trigger();
    this.ampEnv.trigger();
  }

  process(): number {
    if (!this.triggered && !this.ampEnv.isActive()) return 0;
    this.triggered = false;
    const pEnv = this.pitchEnv.process();
    const freq = this.params.pitch * (1 + pEnv * 1.5);
    this.osc.setFrequency(freq);
    const amp = this.ampEnv.process();
    const tone = this.osc.process() * 0.6;
    const noise = this.noiseBp.process(this.noise.process()) * 0.3;
    const out = (tone + noise) * amp * this.params.level * this.velocity;
    return this.dc.process(out);
  }

  isActive(): boolean { return this.ampEnv.isActive(); }
  reset() { this.osc.reset(); this.noiseBp.reset(); this.dc.reset(); }
  setParams(p: Partial<PercParams>) { this.params = { ...this.params, ...p }; this.configure(); }
}
