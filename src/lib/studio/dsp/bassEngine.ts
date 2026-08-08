/**
 * PROFESSIONAL PSYCHEDELIC BASS ENGINE
 *
 * A proper psytrance bass:
 *   - Short notes (off-beat 16ths, ~100-150ms each)
 *   - Clean sub (40-80Hz) + controlled harmonics
 *   - Consistent phase (retriggered each note)
 *   - Locks with kick via sidechain ducking
 *   - Tight envelope (no clicks, no mud)
 *
 * Previous bass: saw + square + sub osc → Moog ladder at 600Hz
 * → low=0.222 (weak low end!), zcr=4877Hz (too bright)
 *
 * New bass: sub sine + filtered saw (harmonics) + sidechain input from kick
 *   1. Sub: sine at fundamental, the power
 *   2. Harmonics: saw through LP filter at 300-500Hz, the character
 *   3. Sidechain: ducks when kick fires (sidechain input)
 *
 * REAL IMPLEMENTATION.
 */

import { Oscillator } from '../dsp/oscillator';
import { MoogLadder, DCBlocker } from '../dsp/filter';
import { ADSR } from '../dsp/envelope';

export interface BassParams {
  /** Oscillator shape for harmonics layer. */
  harmonicShape: 'saw' | 'square' | 'triangle';
  /** Sub oscillator level (0..1). */
  subLevel: number;
  /** Harmonics level (0..1). */
  harmonicLevel: number;
  /** Filter cutoff for harmonics (Hz). */
  cutoff: number;
  /** Filter resonance (0..1). */
  resonance: number;
  /** Envelope attack (seconds). */
  attack: number;
  /** Envelope decay (seconds). */
  decay: number;
  /** Envelope sustain (0..1). */
  sustain: number;
  /** Envelope release (seconds). */
  release: number;
  /** Sidechain depth (0..1) — how much kick ducks the bass. */
  sidechainDepth: number;
  /** Sidechain release time (seconds). */
  sidechainRelease: number;
  /** Saturation (0..1). */
  saturation: number;
  /** Overall level. */
  level: number;
}

export const BASS_DEFAULTS: BassParams = {
  harmonicShape: 'saw',
  subLevel: 0.8,
  harmonicLevel: 0.5,
  cutoff: 350,
  resonance: 0.3,
  attack: 0.003,
  decay: 0.08,
  sustain: 0.7,
  release: 0.04,
  sidechainDepth: 0.5,
  sidechainRelease: 0.08,
  saturation: 0.3,
  level: 0.8,
};

export class BassEngine {
  private sr: number;
  private params: BassParams;
  private subOsc: Oscillator;
  private harmOsc: Oscillator;
  private filter: MoogLadder;
  private env: ADSR;
  private dc: DCBlocker;
  private sidechainEnv = 1;        // current sidechain gain (1 = no duck, 0 = full duck)
  private sidechainActive = false;
  private currentNote = 33;        // MIDI note
  private currentVelocity = 0.8;
  private gateOpen = false;

  constructor(sr: number, params: Partial<BassParams> = {}) {
    this.sr = sr;
    this.params = { ...BASS_DEFAULTS, ...params };
    this.subOsc = new Oscillator('sine', sr, 700);
    this.harmOsc = new Oscillator(this.params.harmonicShape, sr, 701);
    this.filter = new MoogLadder(sr);
    this.filter.setCutoff(this.params.cutoff);
    this.filter.setResonance(this.params.resonance);
    this.env = new ADSR(sr);
    this.dc = new DCBlocker();
  }

  /** Trigger a bass note. */
  noteOn(note: number, velocity = 0.8) {
    this.currentNote = note;
    this.currentVelocity = velocity;
    // retrigger oscillators for phase consistency
    this.subOsc.reset(0);
    this.harmOsc.reset(0);
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    this.subOsc.setFrequency(freq);
    this.harmOsc.setFrequency(freq);
    this.env.attack = this.params.attack;
    this.env.decay = this.params.decay;
    this.env.sustain = this.params.sustain;
    this.env.release = this.params.release;
    this.env.gate(true);
    this.gateOpen = true;
  }

  /** Release the bass note. */
  noteOff() {
    this.env.gate(false);
    this.gateOpen = false;
  }

  /** Signal that the kick has fired — triggers sidechain ducking. */
  kickFired() {
    this.sidechainActive = true;
    this.sidechainEnv = 1 - this.params.sidechainDepth; // immediate duck
  }

  process(): number {
    // update sidechain envelope
    if (this.sidechainActive) {
      // exponential recovery toward 1
      const rate = 1 / Math.max(0.001, this.params.sidechainRelease * this.sr);
      this.sidechainEnv += (1 - this.sidechainEnv) * Math.min(1, rate);
      if (this.sidechainEnv > 0.995) { this.sidechainEnv = 1; this.sidechainActive = false; }
    }

    const ampEnv = this.env.process();
    if (!this.env.isActive()) return 0;

    // Sub layer: clean sine at fundamental
    const sub = this.subOsc.process() * this.params.subLevel;

    // Harmonic layer: saw/square through filter for character
    const harmRaw = this.harmOsc.process();
    const harmFiltered = this.filter.process(harmRaw);
    const harm = harmFiltered * this.params.harmonicLevel;

    // Mix + saturation
    const mixed = sub + harm;
    const sat = Math.tanh(mixed * (1 + this.params.saturation * 2)) * 0.6;

    // Apply amp envelope + sidechain + level
    const out = this.dc.process(sat) * ampEnv * this.sidechainEnv * this.currentVelocity * this.params.level;
    return out;
  }

  isActive(): boolean { return this.env.isActive(); }

  reset() {
    this.subOsc.reset();
    this.harmOsc.reset();
    this.filter.reset();
    this.env.reset();
    this.dc.reset();
    this.sidechainEnv = 1;
    this.sidechainActive = false;
  }

  setParams(p: Partial<BassParams>) {
    this.params = { ...this.params, ...p };
    this.filter.setCutoff(this.params.cutoff);
    this.filter.setResonance(this.params.resonance);
  }
}
