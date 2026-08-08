/**
 * PROFESSIONAL PSYTRANCE KICK ENGINE
 *
 * A proper psytrance kick has:
 *   - SUB BODY (50-80Hz fundamental, the power)
 *   - MID PUNCH (100-200Hz, the chest)
 *   - CLICK/ATTACK (2-5kHz transient, the definition)
 *   - CONTROLLED DECAY (150-250ms, tight not boomy)
 *
 * Previous kick: sine osc + pitch env (6x sweep = too high) + LP filter at 120Hz (killed body)
 * → peak only 0.266, high=0.994 (all click, no sub)
 *
 * New kick: three-layer synthesis
 *   1. Sub layer: sine with pitch drop from 120→50Hz, the body
 *   2. Mid layer: triangle + soft saturation, the punch
 *   3. Click layer: filtered noise burst (2ms), the attack definition
 *
 * REAL IMPLEMENTATION. Sample-accurate.
 */

import { Oscillator } from '../dsp/oscillator';
import { OnePole, DCBlocker } from '../dsp/filter';
import { AD } from '../dsp/envelope';

export interface KickParams {
  /** Fundamental pitch in Hz (after pitch sweep settles). Typical: 45-55. */
  fundamental: number;
  /** Starting pitch multiplier (pitch drops from fundamental*startMult → fundamental). */
  startMult: number;
  /** Pitch sweep duration in seconds. Typical: 0.03-0.06. */
  pitchDecay: number;
  /** Total kick decay in seconds. Typical: 0.15-0.25. */
  decay: number;
  /** Sub level (0..1). */
  subLevel: number;
  /** Mid punch level (0..1). */
  midLevel: number;
  /** Click level (0..1). */
  clickLevel: number;
  /** Mid saturation (0..1). */
  saturation: number;
  /** Overall level. */
  level: number;
}

export const KICK_DEFAULTS: KickParams = {
  fundamental: 50,
  startMult: 2.4,
  pitchDecay: 0.04,
  decay: 0.2,
  subLevel: 1.0,
  midLevel: 0.5,
  clickLevel: 0.35,
  saturation: 0.4,
  level: 0.95,
};

export class KickEngine {
  private sr: number;
  private params: KickParams;
  private subOsc: Oscillator;
  private midOsc: Oscillator;
  private clickOsc: Oscillator;
  private clickFilter: OnePole;
  private pitchEnv: AD;
  private subEnv: AD;
  private midEnv: AD;
  private clickEnv: AD;
  private dc: DCBlocker;
  private triggered = false;
  private velocity = 0.9;

  constructor(sr: number, params: Partial<KickParams> = {}) {
    this.sr = sr;
    this.params = { ...KICK_DEFAULTS, ...params };
    this.subOsc = new Oscillator('sine', sr, 500);
    this.midOsc = new Oscillator('triangle', sr, 501);
    this.clickOsc = new Oscillator('noise', sr, 502);
    this.clickFilter = new OnePole(sr, 'hp');
    this.clickFilter.setCutoff(2000);
    this.pitchEnv = new AD(sr);
    this.subEnv = new AD(sr);
    this.midEnv = new AD(sr);
    this.clickEnv = new AD(sr);
    this.dc = new DCBlocker();
    this.configure();
  }

  private configure() {
    this.pitchEnv.attack = 0.0005;
    this.pitchEnv.decay = this.params.pitchDecay;
    this.subEnv.attack = 0.001;
    this.subEnv.decay = this.params.decay;
    this.midEnv.attack = 0.001;
    this.midEnv.decay = this.params.decay * 0.5; // mid decays faster
    this.clickEnv.attack = 0.0002;
    this.clickEnv.decay = 0.003; // 3ms click
  }

  trigger(velocity = 0.9) {
    this.triggered = true;
    this.velocity = Math.max(0, Math.min(1, velocity));
    this.pitchEnv.trigger();
    this.subEnv.trigger();
    this.midEnv.trigger();
    this.clickEnv.trigger();
  }

  process(): number {
    if (!this.triggered && !this.subEnv.isActive()) return 0;
    this.triggered = false; // one-shot

    // Pitch envelope: exponential drop from fundamental*startMult → fundamental
    const pEnv = this.pitchEnv.process();
    const pitch = this.params.fundamental * (1 + (this.params.startMult - 1) * pEnv);
    this.subOsc.setFrequency(pitch);
    this.midOsc.setFrequency(pitch * 2); // mid is one octave up for punch

    // Sub layer
    const subAmp = this.subEnv.process();
    const sub = this.subOsc.process() * subAmp * this.params.subLevel;

    // Mid layer (with saturation)
    const midAmp = this.midEnv.process();
    const midRaw = this.midOsc.process() * midAmp * this.params.midLevel;
    const midSat = midRaw * (1 + this.params.saturation * 3);
    const mid = Math.tanh(midSat) * 0.7; // soft clip for controlled harmonics

    // Click layer (filtered noise burst)
    const clickAmp = this.clickEnv.process();
    const clickNoise = this.clickOsc.process();
    const click = this.clickFilter.process(clickNoise) * clickAmp * this.params.clickLevel;

    // Mix + DC block
    const mixed = sub + mid + click;
    const out = this.dc.process(mixed) * this.params.level * this.velocity;

    return out;
  }

  isActive(): boolean {
    return this.subEnv.isActive();
  }

  reset() {
    this.triggered = false;
    this.subOsc.reset();
    this.midOsc.reset();
    this.dc.reset();
  }

  setParams(p: Partial<KickParams>) {
    this.params = { ...this.params, ...p };
    this.configure();
  }
}
