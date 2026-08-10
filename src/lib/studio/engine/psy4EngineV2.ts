/**
 * PSY4 Engine V2 — based on PSY6 architecture (pooled voices, factory presets, step sequencer).
 *
 * This is a MAJOR upgrade from LiteEngine V1:
 *   - Pooled voices (persistent oscillators, no GC pressure)
 *   - 8 tracks (4 drums + 4 synth) with factory presets
 *   - Step sequencer with patterns, scenes, variation
 *   - Macros that affect real parameters
 *   - Worker-timed scheduler (jitter-resistant)
 *   - Syncs BPM and key with radio
 *   - REFERENCE PURSUIT: actively chases the radio's kick decay, spectral
 *     centroid, transient density, sub/high energy, bass decay, BPM and key.
 *
 * Sound quality comes from the 40+ factory presets adapted from PSY6.
 */

import { SeededRng, AcidPattern, BASS_PATTERNS, scaleNote, mtof } from './musicalGrammar';
import { HarmonyEngine, Chord, ChordVoicing } from './harmonyEngine';
import { MelodyEngine } from './melodyEngine';
import { WORLDS, WorldId, World } from './worlds';
import { classifyStyle, styleToWorld, StyleMatch, RefFeatures } from './styleClassifier';
import {
  AdvancedSynthVoice,
  AdvancedSynthPreset,
  SynthMode,
  getAdvancedSynthPreset,
} from './advancedVoice';
import { TrackEffectsRack, TrackRackConfig } from './effectsRack';
import { ChorusSend, PhaserSend, DistortionSend, BitcrushSend } from './sendEffects';
import { MultibandCompressor } from './multibandCompressor';
import { detectSynthesisCharacter, SynthesisCharacter } from './synthesisDetector';

// ─── Constants ──────────────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);

// ─── Per-track effects rack configs (Task E1) ───────────────────────────────
//
// Each of the 8 tracks gets a tailored insert chain. The configs are
// world-agnostic defaults; per-world send modulations are layered on top by
// applyWorldEffectSettings() so dark-psy gets more distortion/bitcrush, goa
// gets more phaser, morning gets more chorus, etc.
//
// Tracks: 0=KICK, 1=SNARE/CLAP, 2=HATS, 3=PERC, 4=BASS, 5=LEAD, 6=PAD, 7=ARP.

function buildTrackRackConfigs(world: World): TrackRackConfig[] {
  // Base configs — these give each track its core "produced" character.
  const base: TrackRackConfig[] = [
    // 0: KICK — mono/centered, heavy comp, no sends. Low-end focus.
    {
      eqLowGain: 2.5, eqMidFreq: 350, eqMidGain: -3, eqMidQ: 1.2, eqHighGain: -1,
      compThreshold: -16, compRatio: 6, compAttack: 0.003, compRelease: 0.08, compKnee: 4,
      satDrive: 1.4, satMix: 0.35,
      pan: 0, useHaas: false, haasDelayMs: 0, haasMix: 0,
      outputGain: 1.0,
      sendReverb: 0, sendDelay: 0, sendChorus: 0, sendPhaser: 0, sendDistortion: 0, sendBitcrush: 0,
    },
    // 1: SNARE/CLAP — stereo, comp, reverb send. Crackle + body.
    {
      eqLowGain: -2, eqMidFreq: 1500, eqMidGain: 2.5, eqMidQ: 1.2, eqHighGain: 3,
      compThreshold: -16, compRatio: 4, compAttack: 0.005, compRelease: 0.12, compKnee: 6,
      satDrive: 1.5, satMix: 0.25,
      pan: 0, useHaas: false, haasDelayMs: 0, haasMix: 0,
      outputGain: 0.6,
      sendReverb: 0.28, sendDelay: 0.12, sendChorus: 0, sendPhaser: 0, sendDistortion: 0, sendBitcrush: 0,
    },
    // 2: HATS — stereo, gentle comp, reverb send. Air + sizzle.
    {
      eqLowGain: -8, eqMidFreq: 3000, eqMidGain: 0, eqMidQ: 1, eqHighGain: 2.5,
      compThreshold: -22, compRatio: 3, compAttack: 0.003, compRelease: 0.06, compKnee: 6,
      satDrive: 1.1, satMix: 0.12,
      pan: 0.25, useHaas: false, haasDelayMs: 0, haasMix: 0,
      outputGain: 0.5,
      sendReverb: 0.16, sendDelay: 0.06, sendChorus: 0, sendPhaser: 0, sendDistortion: 0, sendBitcrush: 0,
    },
    // 3: PERC — stereo, comp, reverb send.
    {
      eqLowGain: -3, eqMidFreq: 800, eqMidGain: 1.5, eqMidQ: 1, eqHighGain: 1,
      compThreshold: -18, compRatio: 3, compAttack: 0.005, compRelease: 0.1, compKnee: 8,
      satDrive: 1.1, satMix: 0.18,
      pan: -0.25, useHaas: false, haasDelayMs: 0, haasMix: 0,
      outputGain: 0.4,
      sendReverb: 0.22, sendDelay: 0.1, sendChorus: 0, sendPhaser: 0, sendDistortion: 0, sendBitcrush: 0,
    },
    // 4: BASS — mono/centered, gentle comp, reverb send only (per spec).
    //    Tight low end with controlled midrange to leave room for the kick.
    {
      eqLowGain: 2.5, eqMidFreq: 280, eqMidGain: -2, eqMidQ: 1.1, eqHighGain: -1.5,
      compThreshold: -14, compRatio: 3, compAttack: 0.015, compRelease: 0.15, compKnee: 12,
      satDrive: 1.6, satMix: 0.4,
      pan: 0, useHaas: false, haasDelayMs: 0, haasMix: 0,
      outputGain: 1.2,
      sendReverb: 0.06, sendDelay: 0, sendChorus: 0, sendPhaser: 0, sendDistortion: 0, sendBitcrush: 0,
    },
    // 5: LEAD — stereo + Haas, all melodic sends active. Cuts through.
    {
      eqLowGain: -2.5, eqMidFreq: 1400, eqMidGain: 1.5, eqMidQ: 1, eqHighGain: 2,
      compThreshold: -16, compRatio: 3, compAttack: 0.005, compRelease: 0.15, compKnee: 8,
      satDrive: 1.5, satMix: 0.3,
      pan: 0.1, useHaas: true, haasDelayMs: 11, haasMix: 0.55,
      outputGain: 0.7,
      sendReverb: 0.25, sendDelay: 0.22, sendChorus: 0.3, sendPhaser: 0.25, sendDistortion: 0.1, sendBitcrush: 0,
    },
    // 6: PAD — stereo + Haas (wide), chorus + reverb heavy. Airy bed.
    {
      eqLowGain: -3.5, eqMidFreq: 800, eqMidGain: 0, eqMidQ: 1, eqHighGain: 2.5,
      compThreshold: -20, compRatio: 2, compAttack: 0.05, compRelease: 0.3, compKnee: 12,
      satDrive: 1.0, satMix: 0.15,
      pan: -0.1, useHaas: true, haasDelayMs: 17, haasMix: 0.7,
      outputGain: 0.5,
      sendReverb: 0.38, sendDelay: 0.15, sendChorus: 0.38, sendPhaser: 0.1, sendDistortion: 0, sendBitcrush: 0,
    },
    // 7: ARP — stereo + Haas, all melodic sends. Rhythmic texture.
    {
      eqLowGain: -3, eqMidFreq: 2200, eqMidGain: 1.5, eqMidQ: 1, eqHighGain: 2,
      compThreshold: -18, compRatio: 3, compAttack: 0.005, compRelease: 0.1, compKnee: 8,
      satDrive: 1.3, satMix: 0.25,
      pan: 0.18, useHaas: true, haasDelayMs: 9, haasMix: 0.5,
      outputGain: 0.5,
      sendReverb: 0.2, sendDelay: 0.26, sendChorus: 0.26, sendPhaser: 0.22, sendDistortion: 0, sendBitcrush: 0,
    },
  ];

  // ── Per-world SEND modulations (layered on top of base configs) ──
  // The base configs give every world the same essential "produced" chain.
  // The world's character then shapes which sends are pushed harder.
  const id = world.id;
  const w = world;
  // Clone so we can mutate per-world without polluting `base`.
  const cfgs = base.map(c => ({ ...c }));

  // dark-psy: more distortion/bitcrush on lead, more phaser on arp.
  if (id === 'dark-psy' || id === 'forest') {
    cfgs[5].sendDistortion = clamp(cfgs[5].sendDistortion + 0.25, 0, 1);
    cfgs[5].sendBitcrush   = clamp(cfgs[5].sendBitcrush   + 0.12, 0, 1);
    cfgs[7].sendPhaser     = clamp(cfgs[7].sendPhaser     + 0.15, 0, 1);
    cfgs[6].sendBitcrush   = 0.08; // lo-fi pad texture
  }
  // goa / acid-psy: heavy phaser on lead/arp, more chorus on pad.
  if (id === 'goa' || id === 'acid-psy') {
    cfgs[5].sendPhaser     = clamp(cfgs[5].sendPhaser     + 0.3, 0, 1);
    cfgs[7].sendPhaser     = clamp(cfgs[7].sendPhaser     + 0.25, 0, 1);
    cfgs[6].sendChorus     = clamp(cfgs[6].sendChorus     + 0.15, 0, 1);
    cfgs[5].sendDistortion = clamp(cfgs[5].sendDistortion + 0.15, 0, 1);
  }
  // morning-psy / cosmic / organic-psy: bright, lots of chorus on melodic.
  if (id === 'morning-psy' || id === 'cosmic' || id === 'organic-psy') {
    cfgs[5].sendChorus = clamp(cfgs[5].sendChorus + 0.2, 0, 1);
    cfgs[6].sendChorus = clamp(cfgs[6].sendChorus + 0.2, 0, 1);
    cfgs[7].sendChorus = clamp(cfgs[7].sendChorus + 0.2, 0, 1);
    cfgs[6].sendReverb = clamp(cfgs[6].sendReverb + 0.1, 0, 1);
  }
  // deep-psy / hypnotic: minimal — keep the groove focused. Pull sends down.
  if (id === 'deep-psy' || id === 'hypnotic') {
    for (const ti of [5, 6, 7]) {
      cfgs[ti].sendChorus *= 0.5;
      cfgs[ti].sendPhaser *= 0.5;
      cfgs[ti].sendDistortion *= 0.3;
    }
  }
  // Aggression scales distortion send across all melodic tracks.
  const aggBoost = (w.aggression - 0.5) * 0.3; // -0.15..+0.15
  if (Math.abs(aggBoost) > 0.02) {
    for (const ti of [5, 7]) {
      cfgs[ti].sendDistortion = clamp(cfgs[ti].sendDistortion + aggBoost, 0, 1);
    }
  }
  // Psychedelia scales phaser + chorus on melodic tracks.
  const psyBoost = (w.psychedelia - 0.5) * 0.2; // -0.1..+0.1
  if (Math.abs(psyBoost) > 0.02) {
    for (const ti of [5, 6, 7]) {
      cfgs[ti].sendPhaser = clamp(cfgs[ti].sendPhaser + psyBoost, 0, 1);
      cfgs[ti].sendChorus = clamp(cfgs[ti].sendChorus + psyBoost * 0.5, 0, 1);
    }
  }
  return cfgs;
}

/**
 * Map a reference spectral centroid (Hz) to a target synth cutoff (Hz)
 * using log-linear interpolation. Anchor points:
 *   500Hz  ->  800 Hz cutoff (dark / warm)
 *   2000Hz -> 3000 Hz cutoff (balanced)
 *   5000Hz -> 6000 Hz cutoff (bright / cutting)
 * Falls back to clamp(centroid, 200, 12000) if out of typical range.
 */
function centroidToCutoff(centroid: number): number {
  if (!isFinite(centroid) || centroid <= 0) return 1500;
  const lc = Math.log(clamp(centroid, 80, 16000));
  // Fit using endpoints (500,800) and (5000,6000):
  //   ln(cut) = 0.8753 * ln(centroid) + 1.245
  const lcut = 0.8753 * lc + 1.245;
  return clamp(Math.exp(lcut), 200, 12000);
}

// scaleNote is imported from musicalGrammar (supports all world scales including
// phrygianDominant, harmonicMinor, doubleHarmonic, minorPentatonic).

// ─── Factory Presets (adapted from PSY6) ───────────────────────────────────

interface DrumPreset {
  type: string; tune: number; decay: number; tone: number; punch: number;
}
interface SynthPreset {
  wave1: OscillatorType; wave2: OscillatorType; oct2: number; detune: number;
  cutoff: number; res: number; fType: BiquadFilterType;
  atk: number; dec: number; sus: number; rel: number; gate: number;
  lfoRate: number; lfoDepth: number; lfoDest: string; poly: number;
}

const DRUM_PRESETS: Record<string, DrumPreset> = {
  'PS-KICK-TIGHT': { type: 'kick', tune: 0.9, decay: 0.8, tone: 1, punch: 0.85 },
  'PS-KICK-DEEP': { type: 'kick', tune: 0.7, decay: 1.4, tone: 1, punch: 0.4 },
  'PS-HAT': { type: 'hatC', tune: 1, decay: 0.32, tone: 1.2, punch: 0 },
  'PS-PERC': { type: 'tom', tune: 1.2, decay: 0.5, tone: 1, punch: 0 },
  'PS-GLITCH': { type: 'glitch', tune: 1, decay: 1.2, tone: 0.8, punch: 0 },
  'TR-CLAP': { type: 'clap', tune: 1, decay: 1.6, tone: 0.9, punch: 0 },
  'PR-SHAKER': { type: 'shaker', tune: 1, decay: 0.5, tone: 1, punch: 0 },
};

const SYNTH_PRESETS: Record<string, SynthPreset> = {
  'PS-BASS-ROLL': {
    wave1: 'sawtooth', wave2: 'square', oct2: -1, detune: 4,
    cutoff: 500, res: 9, fType: 'lowpass',
    atk: 0.005, dec: 0.1, sus: 0.2, rel: 0.05, gate: 0.3,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 2,
  },
  'PS-BASS-DEEP': {
    wave1: 'sawtooth', wave2: 'sawtooth', oct2: -1, detune: 12,
    cutoff: 350, res: 7, fType: 'lowpass',
    atk: 0.005, dec: 0.15, sus: 0.3, rel: 0.08, gate: 0.5,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 2,
  },
  'PS-LEAD-SQUELCH': {
    wave1: 'square', wave2: 'sawtooth', oct2: 0, detune: 8,
    cutoff: 1800, res: 10, fType: 'lowpass',
    atk: 0.005, dec: 0.18, sus: 0.4, rel: 0.15, gate: 0.45,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
  'PS-LEAD-FMTEX': {
    wave1: 'sine', wave2: 'sine', oct2: 1, detune: 2,
    cutoff: 2000, res: 3, fType: 'lowpass',
    atk: 0.005, dec: 0.3, sus: 0.6, rel: 0.2, gate: 0.6,
    lfoRate: 8, lfoDepth: 0.3, lfoDest: 'cutoff', poly: 4,
  },
  'PS-PAD-PSYCH': {
    wave1: 'sawtooth', wave2: 'sine', oct2: 1, detune: 14,
    cutoff: 1000, res: 6, fType: 'lowpass',
    atk: 0.7, dec: 0.5, sus: 0.7, rel: 1.3, gate: 2.6,
    lfoRate: 0.3, lfoDepth: 0.4, lfoDest: 'cutoff', poly: 8,
  },
  'PS-ARP-ACID': {
    wave1: 'square', wave2: 'sawtooth', oct2: 0, detune: 6,
    cutoff: 1200, res: 9, fType: 'lowpass',
    atk: 0.003, dec: 0.1, sus: 0.2, rel: 0.08, gate: 0.24,
    lfoRate: 0, lfoDepth: 0, lfoDest: 'off', poly: 4,
  },
};

// ─── Track types ────────────────────────────────────────────────────────────

interface Track {
  idx: number;
  kind: 'drum' | 'synth';
  name: string;
  presetId: string;
  mix: { vol: number; pan: number; mute: boolean; sendA: number; sendB: number };
  base?: any;
}

interface StepData {
  on: number; vel: number; prob: number; note: number;
}

interface Pattern {
  name: string;
  data: Record<number, { len: number; steps: StepData[] }>;
}

// ─── Synth voice pool ───────────────────────────────────────────────────────
//
// The synth pool uses AdvancedSynthVoice (from ./advancedVoice) which supports
// 4 modes: classic (drop-in 2-osc), fm (carrier+modulator), supersaw (5-7 detuned
// saws with stereo spread), and wavetable (2 crossfading periodic waves with LFO
// morph). All nodes are preallocated per voice — zero per-note allocation.
//
// Each voice holds up to 7 OscillatorNodes. With 20 voices that's 140 oscillators
// max, well within modern browser limits.

// ─── Pooled Drum Voice (from PSY6 — multi-type) ────────────────────────────

class PooledDrumVoice {
  noise: AudioBufferSourceNode;
  noiseGain: GainNode;
  nFilter: BiquadFilterNode;
  osc: OscillatorNode;
  oscGain: GainNode;
  out: GainNode;
  bus: GainNode | null = null;

  constructor(ctx: AudioContext, noiseBuffer: AudioBuffer) {
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer;
    this.noise.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.nFilter = ctx.createBiquadFilter();
    this.nFilter.type = 'bandpass';
    this.noise.connect(this.nFilter);
    this.nFilter.connect(this.noiseGain);
    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0;
    this.osc.connect(this.oscGain);
    this.out = ctx.createGain();
    this.noiseGain.connect(this.out);
    this.oscGain.connect(this.out);
    this.noise.start();
    this.osc.start();
  }

  connect(bus: GainNode) {
    if (this.bus !== bus) {
      this.out.disconnect();
      this.out.connect(bus);
      this.bus = bus;
    }
  }

  /**
   * Trigger this voice. The optional `decayOverride` lets callers (e.g. reference
   * pursuit) replace the preset decay with a blended value to chase the radio's
   * kick decay. It is guarded against NaN/zero/out-of-range values.
   */
  hit(p: DrumPreset, when: number, vel: number, bus: GainNode, decayOverride?: number) {
    this.connect(bus);
    const tune = p.tune || 1;
    const candidateDecay = (typeof decayOverride === 'number'
      && isFinite(decayOverride) && decayOverride > 0.001 && decayOverride < 50)
      ? decayOverride
      : null;
    const decay = candidateDecay ?? p.decay ?? 1;
    const tone = p.tone || 1;
    const punch = p.punch || 0;
    const type = p.type;
    const ng = this.noiseGain.gain;
    const og = this.oscGain.gain;
    ng.cancelScheduledValues(when);
    og.cancelScheduledValues(when);
    ng.setValueAtTime(0, when);
    og.setValueAtTime(0, when);

    if (type === 'kick') {
      const dur = 0.12 + 0.5 * decay;
      this.osc.frequency.setValueAtTime(180 * tune, when);
      this.osc.frequency.exponentialRampToValueAtTime(Math.max(36 * tune, 24), when + 0.09);
      og.setValueAtTime(vel * 1.1, when);
      og.exponentialRampToValueAtTime(0.0001, when + dur);
      if (punch > 0) {
        ng.setValueAtTime(vel * punch * 0.8, when);
        ng.exponentialRampToValueAtTime(0.0001, when + 0.02);
        this.nFilter.frequency.setValueAtTime(2500, when);
      }
    } else if (type === 'clap') {
      const dur = 0.25 + 0.15 * decay;
      this.nFilter.type = 'bandpass';
      this.nFilter.frequency.setValueAtTime(1150 * tone, when);
      this.nFilter.Q.value = 1.3;
      ng.setValueAtTime(0, when);
      [0, 0.014, 0.03].forEach(t2 => {
        ng.setValueAtTime(0, when + t2);
        ng.linearRampToValueAtTime(vel * 0.9, when + t2 + 0.002);
        ng.exponentialRampToValueAtTime(0.02, when + t2 + 0.012);
      });
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'hatC' || type === 'hatO') {
      const open = type === 'hatO';
      const dur = open ? 0.26 + 0.5 * decay : 0.03 + 0.05 * decay;
      this.nFilter.type = 'highpass';
      this.nFilter.frequency.setValueAtTime(7200 * Math.sqrt(tone), when);
      ng.setValueAtTime(vel * (open ? 0.4 : 0.5), when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'tom') {
      const dur = 0.22 + 0.35 * decay;
      this.osc.type = 'sine';
      this.osc.frequency.setValueAtTime(180 * tune, when);
      this.osc.frequency.exponentialRampToValueAtTime(92 * tune, when + dur * 0.7);
      og.setValueAtTime(vel * 0.9, when);
      og.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'shaker') {
      const dur = 0.04 + 0.07 * decay;
      this.nFilter.type = 'highpass';
      this.nFilter.frequency.setValueAtTime(6000 * tone, when);
      ng.setValueAtTime(vel * 0.45, when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    } else if (type === 'glitch') {
      const dur = 0.08 + 0.14 * decay;
      this.nFilter.type = 'bandpass';
      this.nFilter.frequency.setValueAtTime(1500 * tone + 800, when);
      this.nFilter.Q.value = 4;
      ng.setValueAtTime(vel * 0.7, when);
      ng.exponentialRampToValueAtTime(0.0001, when + dur);
    }
  }

  panic(ctx: AudioContext) {
    try {
      this.noiseGain.gain.cancelScheduledValues(0);
      this.noiseGain.gain.setValueAtTime(0, ctx.currentTime);
      this.oscGain.gain.cancelScheduledValues(0);
      this.oscGain.gain.setValueAtTime(0, ctx.currentTime);
    } catch {}
  }
}

// ─── Engine V2 ──────────────────────────────────────────────────────────────

export class Psy4EngineV2 {
  ctx: AudioContext | null = null;
  playing = false;
  analyser: AnalyserNode | null = null;

  // Musical understanding
  private musicalKey: { root: number; scale: string } = { root: 43, scale: 'phrygian' };
  private targetLufs = 0;
  private ownLufs = -30;

  // ── Reference pursuit targets (set by liveTrack, consumed by triggerDrum / ──
  //    triggerSynth / scheduleStep). All zero = no pursuit active.
  private refKickDecay = 0;          // seconds (target kick decay from radio)
  private refSpectralCentroid = 0;   // Hz (target spectral centroid from radio)
  private refTransientDensity = 0;   // transients/sec
  private refSubEnergy = 0;          // 0..1
  private refHighEnergy = 0;         // 0..1
  private refBassDecay = 0;          // seconds

  // ── Learned params from ContinuousTrainer (offline optimization). These are  ──
  //    blended ON TOP of reference pursuit + world timbre. Zero/null = not set.
  private learned: {
    kickDecay?: number;      // seconds (override for kick tail length)
    bassCutoff?: number;     // Hz (override for bass filter cutoff)
    leadCutoff?: number;     // Hz (override for lead filter cutoff)
    leadDetune?: number;     // cents (override for lead detune)
    padCutoff?: number;      // Hz (override for pad filter cutoff)
    duck?: number;           // 0..1 (sidechain depth override)
  } = {};

  // ── Full reference feature snapshot for the style classifier (Task 14) ──
  //    These are updated by liveTrack() and consumed by classifyStyle() when
  //    applyMusicalUnderstanding() needs to infer a style from features.
  private refLowEnergy = 0;
  private refMidEnergy = 0;
  private refAirEnergy = 0;
  private refStereoWidth = 0;
  private refBpm = 0;
  private refEnergy = 0;
  private refKeyScale: string | undefined = undefined;

  // ── Task T1: extended reference feature storage (harmonic content / ──
  //    transient shape / stereo field). All zero = no pursuit active.
  //    These feed detectSynthesisCharacter() and applyEffectsPursuit().
  private refSpectralFlatness = 0;
  private refSpectralCrest = 0;
  private refHnr = 0;
  private refInharmonicity = 0;
  private refSpectralSlopeDb = 0;
  private refTransientSharpness = 0;
  private refTransientDecayMs = 0;
  private refStereoBalance = 0;
  private refStereoCorrelation = 0;
  private refMsRatio = 0;

  // ── Task T1: synthesis character detection state ──
  // detectedSynthesisCharacter is the LATEST detector output (always reflects
  // the most recent reference features, regardless of whether we acted on it).
  // lastSynthModeSwitchTime + SYNTH_MODE_COOLDOWN_MS prevent mode thrashing
  // when the detector wobbles between two equally-likely modes.
  private detectedSynthesisCharacter: SynthesisCharacter | null = null;
  private lastSynthModeSwitchTime = 0;
  private static readonly SYNTH_MODE_COOLDOWN_MS = 20_000;
  private static readonly SYNTH_CONFIDENCE_THRESHOLD = 0.5;

  // ── Task T1: own LUFS-variance tracker (for compression pursuit). ──
  // We don't have a true LUFS variance measurement here, but we track the
  // recent peak-to-mean LUFS swing as a proxy: a small swing over many
  // windows means heavy compression (the radio is "glued"), which should
  // push our master compressor ratio up.
  private recentLufsValues: number[] = [];
  private static readonly LUFS_HISTORY_MAX = 8;

  // ── Style classification (Task 14) — populated by applyMusicalUnderstanding() ──
  //    and read by getStyleClassification() for UI display.
  private styleMatches: StyleMatch[] = [];

  // ── Auto-switch anti-thrash guard (Task 14) ──
  //    Don't auto-switch worlds more often than every 30 seconds. Also
  //    remember the last world we switched to so we can detect no-op switches.
  private lastAutoSwitchTime = 0;
  private lastAutoSwitchWorldId: string | null = null;
  private static readonly AUTO_SWITCH_COOLDOWN_MS = 30_000;
  private static readonly AUTO_SWITCH_CONFIDENCE_THRESHOLD = 0.55;

  // ── Phrase-locked preset rotation (Task 15) ──
  //    Every 8 bars, rotate kick/bass preset between 2 variants, world-aware.
  //    (dark worlds → DEEP kick / ROLL bass; bright worlds → TIGHT kick / DEEP bass)
  private phraseCounter = 0;
  private phrasePresetVariant = 0; // 0 or 1 — alternates every 8 bars

  // ── Own measured values (set by selfTrack) — for getPursuitStatus() and ──
  //    sub/high energy balancing. Zero = no measurement yet.
  private ownSpectralCentroid = 0;
  private ownTransientDensity = 0;
  private ownSubEnergy = 0;
  private ownHighEnergy = 0;

  // ── Continuous BPM tracking — smooth ramp over 4 bars when diff > 2 BPM ──
  //    (avoids audio glitches from sudden tempo jumps)
  private targetBpm = 0;             // 0 = no active ramp
  private bpmRampPerBar = 0;         // bpm delta applied per bar
  private bpmRampBarsLeft = 0;       // bars remaining in current ramp

  // ── Musical generators — re-created on key change for true key pursuit ──
  //    MelodyEngine (Task M1) replaces the old LeadMotif. It produces
  //    developmental A A' B A'' phrases with motif transformation, sequences,
  //    tension curves, and call-response for the arp.
  private melody: MelodyEngine | null = null;
  private acidPattern: AcidPattern | null = null;
  private musicRng: SeededRng | null = null;

  // ── Harmonic engine (Task H1) ──
  //    HarmonyEngine produces scale-appropriate chord progressions with voice
  //    leading, inversions, extended chords (7th/9th), and modal interchange.
  //    Replaces the old "chordRoot + fifth" pad voicing with rich 4-5 note
  //    voicings that evolve smoothly between chords.
  private harmony: HarmonyEngine | null = null;
  private currentProgression: Chord[] = [];
  private chordIdx = 0;
  private currentChord: Chord | null = null;  // for bass + counterpoint reference

  // Audio graph
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noiseBuffer!: AudioBuffer;
  private delaySend!: GainNode;
  private delay!: DelayNode;
  private delayFb!: GainNode;
  private delayReturn!: GainNode;
  private reverbSend!: GainNode;
  private reverb!: ConvolverNode;
  private reverbReturn!: GainNode;
  private chains: GainNode[] = [];          // rack.input per track (voices connect here)
  private trackGains: GainNode[] = [];      // rack.output per track (fader — liveTrack/setWorld adjust this)
  private duckGain!: GainNode;  // sidechain duck for bass track
  private saturator!: WaveShaperNode;
  private toneLow!: BiquadFilterNode;
  private toneHigh!: BiquadFilterNode;

  // ── Per-track effects racks (Task E1) ──
  // Each track has a full insert chain (EQ → comp → sat → Haas → pan) plus
  // 6 send taps. Replaces the bare GainNode+HPF+panner chain in V2.
  private racks: TrackEffectsRack[] = [];

  // ── Send buses + effects (Task E1) ──
  // Chorus / Phaser / Distortion / Bitcrush are global SEND effects — each
  // track's rack sends a portion to the bus, the bus feeds the effect, and
  // the effect's output returns to the master sum.
  private chorusSend!: GainNode;        // bus input (sums all racks' chorus sends)
  private chorusEffect!: ChorusSend;
  private chorusReturn!: GainNode;
  private phaserSend!: GainNode;
  private phaserEffect!: PhaserSend;
  private phaserReturn!: GainNode;
  private distortionSend!: GainNode;
  private distortionEffect!: DistortionSend;
  private distortionReturn!: GainNode;
  private bitcrushSend!: GainNode;
  private bitcrushEffect!: BitcrushSend;
  private bitcrushReturn!: GainNode;

  // ── Multiband compressor on the master bus (Task E1) ──
  // Splits the sum into LOW / MID / HIGH, compresses each separately, and
  // sums back. Gives the "loud, glued" commercial sound.
  private multiband!: MultibandCompressor;

  // Voice pools
  private synthPool: AdvancedSynthVoice[] = [];
  private drumPool: PooledDrumVoice[] = [];
  private synthIdx = 0;
  private drumIdx = 0;

  // ── Synth mode overrides (Task S1) ──
  // Per-track synth-mode overrides let the reference pursuit switch a track's
  // synthesis mode in real time (e.g., switch leads to FM when the radio has
  // metallic content). When a track has an entry here, its preset's `mode`
  // is replaced at triggerSynth() time. Defaults to no overrides — worlds
  // select appropriate advanced presets directly via applyWorldPresets().
  private synthModeOverrides: Partial<Record<number, SynthMode>> = {};
  // Real-time modulation overrides applied on top of the preset:
  //   fmDepthOverride: 0 = no override (use preset's fmDepth)
  //   wtPositionOverride: -1 = no override (use preset's wtPosition)
  private fmDepthOverride = 0;
  private wtPositionOverride = -1;

  // Scheduler
  private timer: ReturnType<typeof setTimeout> | null = null;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private sectionIdx = 0;
  private currentSection = 'INTRO';

  // Tracks and patterns
  private tracks: Track[] = [];
  private pattern: Pattern | null = null;
  private presetIdx = 0;

  // ── World-driven pattern engine (Track A) ──
  private currentWorld: World = WORLDS['dark-psy'];
  private arpIdx = 0;
  private bassPatternIdx = 0;

  // Arrangement
  private arrangement = [
    { bars: 4, density: 0.3, bass: false, lead: false, label: 'INTRO' },
    { bars: 4, density: 0.5, bass: true, lead: false, label: 'GROOVE' },
    { bars: 4, density: 0.7, bass: true, lead: false, label: 'BUILD' },
    { bars: 8, density: 0.9, bass: true, lead: true, label: 'DROP' },
    { bars: 4, density: 0.7, bass: true, lead: true, label: 'VARIATION' },
    { bars: 4, density: 0.3, bass: false, lead: false, label: 'BREAK' },
    { bars: 8, density: 1.0, bass: true, lead: true, label: 'FINAL DROP' },
    { bars: 4, density: 0.3, bass: true, lead: false, label: 'OUTRO' },
  ];

  onSectionChange: ((section: string) => void) | null = null;

  /**
   * Callback fired when the engine auto-switches worlds (Task 14). Lets the UI
   * update its world dropdown / "AUTO" badge without polling. The optional
   * `reason` is a human-readable explanation (e.g. the matched style name).
   */
  onWorldChange: ((worldId: string, reason?: string) => void) | null = null;

  init(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const c = this.ctx = new Ctx({ latencyHint: 'interactive' });

    // Noise buffer
    this.noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Master chain — boosted + saturation + tone shelves (from PSY6/psy)
    this.master = c.createGain();
    this.master.gain.value = 1.1;

    // Saturation (WaveShaper — adds warmth and loudness)
    this.saturator = c.createWaveShaper();
    this.saturator.oversample = '4x';
    const satCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 512) - 1;
      satCurve[i] = Math.tanh(x * 1.3) * 0.7 + x * 0.3;
    }
    this.saturator.curve = satCurve;

    // Tone shelves (final EQ)
    this.toneLow = c.createBiquadFilter();
    this.toneLow.type = 'lowshelf';
    this.toneLow.frequency.value = 110;
    this.toneLow.gain.value = 1.5;
    this.toneHigh = c.createBiquadFilter();
    this.toneHigh.type = 'highshelf';
    this.toneHigh.frequency.value = 8500;
    this.toneHigh.gain.value = -2;

    this.comp = c.createDynamicsCompressor();
    // Comp is now a SAFETY LIMITER after the multiband — gentle ratio, fast
    // attack, threshold just below clipping. The multiband does the heavy
    // lifting; this catches anything that slips through.
    this.comp.threshold.value = -3;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.15;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;

    // Multiband compressor (Task E1) — 3-band crossover on the master bus.
    // Splits LOW/MID/HIGH, compresses each separately, sums back. This is
    // what gives the "loud, glued" commercial sound.
    this.multiband = new MultibandCompressor(c, {
      crossoverLow: 200, crossoverHigh: 2000,
      lowThreshold: -18, lowRatio: 4,  lowAttack: 0.012, lowRelease: 0.2,  lowKnee: 6,  lowMakeup: 1.2,
      midThreshold: -20, midRatio: 3,  midAttack: 0.008, midRelease: 0.15, midKnee: 10, midMakeup: 1.1,
      highThreshold: -22, highRatio: 2, highAttack: 0.003, highRelease: 0.08, highKnee: 12, highMakeup: 1.0,
    });

    // Connect: master → saturator → toneLow → toneHigh → multiband → comp (safety) → analyser → destination
    this.master.connect(this.saturator);
    this.saturator.connect(this.toneLow);
    this.toneLow.connect(this.toneHigh);
    this.toneHigh.connect(this.multiband.input);
    this.multiband.output.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(c.destination);

    // Delay (ping-pong with band-limited feedback)
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 0.15;
    this.delay = c.createDelay(0.5);
    this.delay.delayTime.value = 0.375;
    this.delayFb = c.createGain();
    this.delayFb.gain.value = 0.35;
    this.delayReturn = c.createGain();
    this.delayReturn.gain.value = 0.5;
    const dLP = c.createBiquadFilter();
    dLP.type = 'lowpass';
    dLP.frequency.value = 3300;
    this.delaySend.connect(this.delay);
    this.delay.connect(dLP);
    dLP.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.delayReturn);
    this.delayReturn.connect(this.master);

    // Reverb
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.12;
    this.reverb = c.createConvolver();
    const irLen = Math.floor(c.sampleRate * 1.5);
    const ir = c.createBuffer(2, irLen, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.4));
      }
    }
    this.reverb.buffer = ir;
    this.reverbReturn = c.createGain();
    this.reverbReturn.gain.value = 0.6;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);

    // ── Send effects: Chorus / Phaser / Distortion / Bitcrush (Task E1) ──
    // Each is a global SEND effect: per-track rack sends a portion to the bus
    // gain, the bus feeds the effect input, and the effect output returns to
    // the master sum (post-multiband-input, so sends are also compressed).

    // Chorus — modulated short delays, stereo spread. For lead/pad/arp.
    this.chorusSend = c.createGain();
    this.chorusSend.gain.value = 1.0; // bus level; per-track sends scale this
    this.chorusEffect = new ChorusSend(c, {
      rate: 0.5, depth: 0.004, baseDelay: 0.012, wet: 0.6, dry: 0.7,
    });
    this.chorusReturn = c.createGain();
    this.chorusReturn.gain.value = 0.5;
    this.chorusSend.connect(this.chorusEffect.input);
    this.chorusEffect.output.connect(this.chorusReturn);
    this.chorusReturn.connect(this.master);

    // Phaser — allpass cascade + LFO sweep. For lead/arp (psychedelic motion).
    this.phaserSend = c.createGain();
    this.phaserSend.gain.value = 1.0;
    this.phaserEffect = new PhaserSend(c, {
      rate: 0.3, depth: 0.6, baseFreq: 800, feedback: 0.4, stages: 6,
      wet: 0.55, dry: 0.6,
    });
    this.phaserReturn = c.createGain();
    this.phaserReturn.gain.value = 0.5;
    this.phaserSend.connect(this.phaserEffect.input);
    this.phaserEffect.output.connect(this.phaserReturn);
    this.phaserReturn.connect(this.master);

    // Distortion — hard-clip waveshaper. For acid/lead (grit).
    this.distortionSend = c.createGain();
    this.distortionSend.gain.value = 1.0;
    this.distortionEffect = new DistortionSend(c, {
      drive: 4, tone: 4000, wet: 0.5, dry: 0.5,
    });
    this.distortionReturn = c.createGain();
    this.distortionReturn.gain.value = 0.4;
    this.distortionSend.connect(this.distortionEffect.input);
    this.distortionEffect.output.connect(this.distortionReturn);
    this.distortionReturn.connect(this.master);

    // Bitcrush — stair-step quantizer + sample-and-hold. For lo-fi texture.
    this.bitcrushSend = c.createGain();
    this.bitcrushSend.gain.value = 1.0;
    this.bitcrushEffect = new BitcrushSend(c, {
      bits: 6, holdMs: 4, tone: 2500, wet: 0.5, dry: 0.6,
    });
    this.bitcrushReturn = c.createGain();
    this.bitcrushReturn.gain.value = 0.35;
    this.bitcrushSend.connect(this.bitcrushEffect.input);
    this.bitcrushEffect.output.connect(this.bitcrushReturn);
    this.bitcrushReturn.connect(this.master);

    // Track buses (8 tracks) — each gets a full TrackEffectsRack insert chain.
    this.duckGain = c.createGain();
    this.duckGain.gain.value = 1.0;
    // duckGain connects to master ONCE (not twice — was causing feedback)
    this.duckGain.connect(this.master);

    // Build per-track rack configs from the current world. The configs encode
    // per-track EQ/comp/sat/pan/Haas + per-track send levels + per-world
    // modulations (dark-psy → more distortion, goa → more phaser, etc.).
    const rackConfigs = buildTrackRackConfigs(this.currentWorld);
    for (let i = 0; i < 8; i++) {
      const rack = new TrackEffectsRack(c, rackConfigs[i]);
      this.racks.push(rack);
      // Voices connect to rack.input; liveTrack/setWorld adjust rack.output.
      this.chains.push(rack.input);
      this.trackGains.push(rack.output);

      // Wire rack.output → (duckGain for bass | master for others).
      // Bass goes through duckGain for sidechain ducking on kick hits.
      if (i === 4) {
        rack.output.connect(this.duckGain);
      } else {
        rack.output.connect(this.master);
      }

      // Wire all 6 send taps to the global send bus inputs.
      // reverb/delay are the existing global buses (their gain is the master
      // FX mix controlled by world.fxMix); chorus/phaser/distortion/bitcrush
      // are the new Task E1 buses (their gain stays at 1.0 — per-track send
      // gains do the scaling).
      rack.connectSend('reverb', this.reverbSend);
      rack.connectSend('delay', this.delaySend);
      rack.connectSend('chorus', this.chorusSend);
      rack.connectSend('phaser', this.phaserSend);
      rack.connectSend('distortion', this.distortionSend);
      rack.connectSend('bitcrush', this.bitcrushSend);
    }
    // duckGain already connected to master above

    // Allocate voice pools (20 synth + 24 drum — from PSY6)
    // Each AdvancedSynthVoice preallocates 7 OscillatorNodes + panners + LFOs.
    // Total: 20 voices × 7 osc = 140 max oscillators (modern browsers handle this).
    for (let i = 0; i < 20; i++) this.synthPool.push(new AdvancedSynthVoice(c, i));
    for (let i = 0; i < 24; i++) this.drumPool.push(new PooledDrumVoice(c, this.noiseBuffer));

    // Initialize tracks
    this.initTracks();
  }

  private initTracks(): void {
    const names = ['KICK', 'SNARE', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ARP'];
    const presets = ['PS-KICK-TIGHT', 'TR-CLAP', 'PS-HAT', 'PS-PERC', 'PS-BASS-ROLL', 'PS-LEAD-SQUELCH', 'PS-PAD-PSYCH', 'PS-ARP-ACID'];
    // Boosted track volumes for commercial loudness
    const vols = [1.0, 0.6, 0.5, 0.4, 1.2, 0.7, 0.5, 0.5];
    this.tracks = [];
    for (let i = 0; i < 8; i++) {
      this.tracks.push({
        idx: i,
        kind: i < 4 ? 'drum' : 'synth',
        name: names[i],
        presetId: presets[i],
        mix: { vol: vols[i], pan: 0, mute: false, sendA: 0, sendB: 0 },
      });
    }
    // Initialize musical generators with the default key so they exist before
    // the first key-change event arrives from the reference listener.
    this.refreshMusicalGenerators();
  }

  start(worldId?: string): void {
    this.init();
    if (this.ctx!.state === 'suspended') this.ctx!.resume();

    // ── World-driven configuration (Track A) ──
    this.currentWorld = WORLDS[worldId as WorldId] || WORLDS['dark-psy'];
    this._bpm = this.currentWorld.defaultBpm;
    this.musicalKey = {
      root: Math.floor((this.currentWorld.rootRange[0] + this.currentWorld.rootRange[1]) / 2),
      scale: this.currentWorld.defaultScale,
    };
    // Re-create musical generators with the world's key (MelodyEngine, AcidPattern)
    this.refreshMusicalGenerators();
    this.arpIdx = 0;
    this.bassPatternIdx = 0;
    // Reset phrase-locked rotation counters for a clean start
    this.phraseCounter = 0;
    this.phrasePresetVariant = 0;
    // Reset auto-switch anti-thrash guard
    this.lastAutoSwitchTime = 0;
    this.lastAutoSwitchWorldId = null;
    this.styleMatches = [];

    // Apply the world's preferred kick/bass/lead presets immediately so the
    // engine starts with the right timbres (Task 15).
    this.applyWorldPresets();

    // Apply per-world send-effect settings (Task E1) — pushes per-track send
    // levels and global effect parameters for the current world.
    this.applyWorldEffectSettings(this.currentWorld);

    // Apply world FX mix to reverb and delay sends
    const fxMix = this.currentWorld.fxMix;
    this.reverbSend.gain.setTargetAtTime(0.04 + fxMix * 0.22, this.ctx!.currentTime, 0.05);
    this.delaySend.gain.setTargetAtTime(0.05 + fxMix * 0.30, this.ctx!.currentTime, 0.05);

    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.bar = 0;
    this.sectionIdx = 0;
    this.currentSection = this.arrangement[0].label;
    this.onSectionChange?.(this.currentSection);
    this.nextTime = this.ctx!.currentTime + 0.03;
    this.scheduleNextTick();
  }

  stop(): void {
    this.playing = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.ctx) {
      for (const v of this.synthPool) v.panic(this.ctx);
      for (const v of this.drumPool) v.panic(this.ctx);
    }
  }

  private get bpm(): number {
    return this._bpm || 145;
  }
  private _bpm = 145;

  setBpm(bpm: number): void {
    this._bpm = bpm;
  }

  applyMusicalUnderstanding(understanding: {
    key: { root: number; scale: string; confidence: number };
    bpm: number;
    bpmConfidence: number;
    style?: string;
    styleConfidence?: number;
  }): void {
    // ── KEY PURSUIT — refresh lead/acid generators when key changes ──
    // The radio's key detector returns a CHROMATIC root (0-11, C=0..B=11).
    // Our internal musicalKey.root is a MIDI note (typically 36-60). So we
    // lift the chromatic root into the bass octave (36 + root) when it's in
    // the chromatic range. If the listener ever returns a MIDI note directly
    // (> 11), we trust it as-is. NaN/undefined confidence → no-op.
    const k = understanding.key;
    const conf = typeof k?.confidence === 'number' && isFinite(k.confidence) ? k.confidence : 0;
    const rawRoot = typeof k?.root === 'number' && isFinite(k.root) ? k.root : -1;
    if (conf > 0.2 && rawRoot >= 0) {
      // Snap the root into the world's preferred rootRange so the engine
      // stays in a useful octave for the current world. We pick the octave
      // of 36 + (root mod 12) that falls inside rootRange.
      const chroma = ((rawRoot % 12) + 12) % 12;
      const worldRange = this.currentWorld.rootRange;
      let newRoot: number;
      if (rawRoot >= 12 && rawRoot >= worldRange[0] && rawRoot <= worldRange[1]) {
        // Listener returned a MIDI note already in range — trust it.
        newRoot = rawRoot;
      } else {
        // Lift chroma into an octave inside the world's rootRange.
        const lo = worldRange[0];
        const candidate = lo + (((chroma - (lo % 12)) + 12) % 12);
        newRoot = candidate;
      }
      const newScale = (typeof k.scale === 'string' && k.scale.length > 0) ? k.scale : this.musicalKey.scale;
      const changed = newRoot !== this.musicalKey.root || newScale !== this.musicalKey.scale;
      // ALWAYS update musicalKey first, then refresh generators — order matters
      // so the generators pick up the new key.
      this.musicalKey = { root: newRoot, scale: newScale };
      // Also store the scale on the ref feature snapshot so the classifier
      // can use it next time it runs.
      this.refKeyScale = newScale;
      if (changed) {
        this.refreshMusicalGenerators();
        if (typeof console !== 'undefined') {
          console.log('[PSY4] Key updated:', this.musicalKey);
        }
      }
    }

    // ── CONTINUOUS BPM TRACKING (smooth ramp for large diffs) ──
    // Always honor the new BPM when confidence is high. Small diffs (<=2 BPM)
    // are applied immediately; larger diffs ramp across 4 bars to avoid tempo
    // glitches and keep the scheduler's lookahead stable.
    if (understanding.bpm > 0 && understanding.bpmConfidence > 0.5) {
      const target = Math.round(understanding.bpm);
      this.refBpm = clamp(target, 30, 220);
      const diff = target - this._bpm;
      if (Math.abs(diff) > 2) {
        this.targetBpm = clamp(target, 60, 200);
        this.bpmRampBarsLeft = 4;
        this.bpmRampPerBar = diff / 4;
      } else {
        this._bpm = clamp(target, 60, 200);
        this.targetBpm = 0;
        this.bpmRampBarsLeft = 0;
        this.bpmRampPerBar = 0;
      }
    }

    // ── STYLE CLASSIFICATION (Task 14) ──
    // Two paths to determine the style:
    //   (a) Reference listener provided an explicit style tag with high
    //       confidence → use it directly (legacy path, kept for compat).
    //   (b) No style tag (or low confidence) → LEARN the style from the
    //       acoustic features we've accumulated in liveTrack(). This is the
    //       new spectral classifier path that addresses the user's complaint
    //       that "style must be learned, not defined by fat bass".
    // In both cases we run the classifier on the stored features so the UI
    // can render the full ranking. Auto-switch only happens when the top
    // match's confidence exceeds the threshold AND the anti-thrash cooldown
    // has elapsed.
    const features = this.buildRefFeatures();
    if (features) {
      const matches = classifyStyle(features);
      this.styleMatches = matches;

      const explicitStyle = understanding.style;
      const explicitConf = understanding.styleConfidence ?? 0;
      const topMatch = matches[0];

      if (explicitStyle && explicitConf > 0.4) {
        // Path (a): use the explicit tag — but still record matches for UI.
        // Only auto-switch if explicit tag strongly disagrees with current world.
        const explicitWorldId = styleToWorld(explicitStyle);
        if (explicitWorldId !== this.currentWorld.id && explicitConf > 0.6) {
          this.tryAutoSwitch(explicitWorldId, `explicit style tag '${explicitStyle}' (${(explicitConf * 100).toFixed(0)}%)`);
        }
      } else if (topMatch &&
                 topMatch.confidence >= Psy4EngineV2.AUTO_SWITCH_CONFIDENCE_THRESHOLD) {
        // Path (b): learn from features and auto-switch if confident.
        const targetWorldId = styleToWorld(topMatch.style);
        if (targetWorldId !== this.currentWorld.id) {
          const reason = topMatch.reasons[0] || `style '${topMatch.style}' (${(topMatch.confidence * 100).toFixed(0)}%)`;
          this.tryAutoSwitch(targetWorldId, reason);
        }
      }
    }
  }

  /**
   * Apply a style classification result directly (Task 14).
   * If the top match's confidence exceeds the auto-switch threshold AND it
   * differs from the current world, switch worlds smoothly.
   * Public so the UI/tests can drive it explicitly if desired.
   */
  applyStyleClassification(matches: StyleMatch[]): void {
    this.styleMatches = matches;
    const top = matches[0];
    if (!top) return;
    if (top.confidence >= Psy4EngineV2.AUTO_SWITCH_CONFIDENCE_THRESHOLD) {
      const targetWorldId = styleToWorld(top.style);
      if (targetWorldId !== this.currentWorld.id) {
        const reason = top.reasons[0] || `style '${top.style}' (${(top.confidence * 100).toFixed(0)}%)`;
        this.tryAutoSwitch(targetWorldId, reason);
      }
    }
  }

  /**
   * Snapshot of the latest style classification for UI display.
   * Empty array if no reference features have arrived yet.
   */
  getStyleClassification(): StyleMatch[] {
    return this.styleMatches;
  }

  /**
   * Return the id of the currently active world. Used by the UI to keep its
   * dropdown in sync with the engine after an auto-switch (Task 14).
   */
  getCurrentWorldId(): string {
    return this.currentWorld.id;
  }

  /**
   * Attempt an automatic world switch. Respects the 30-second anti-thrash
   * cooldown and skips if the target world is the same as the last switch.
   * This is the only place auto-switches should happen.
   */
  private tryAutoSwitch(worldId: string, reason?: string): void {
    if (!this.ctx) return;
    // Defensive: validate that worldId is one of the known WorldIds before
    // attempting to switch. The classifier's styleToWorld() should always
    // return a valid id, but we don't want a bad id to slip through and
    // silently no-op in switchWorld().
    if (!(worldId in WORLDS)) {
      if (typeof console !== 'undefined') {
        console.warn('[PSY4] tryAutoSwitch: unknown worldId', worldId);
      }
      return;
    }
    const now = this.ctx.currentTime * 1000; // ms since ctx start
    if (this.lastAutoSwitchTime > 0 &&
        (now - this.lastAutoSwitchTime) < Psy4EngineV2.AUTO_SWITCH_COOLDOWN_MS) {
      return; // too soon — thrash guard
    }
    if (this.lastAutoSwitchWorldId === worldId) {
      return; // we already switched to this world recently — no-op
    }
    this.switchWorld(worldId as WorldId);
    this.lastAutoSwitchTime = now;
    this.lastAutoSwitchWorldId = worldId;
    // Notify the UI that an auto-switch happened.
    try { this.onWorldChange?.(worldId, reason); } catch {}
  }

  /**
   * Switch to a different world smoothly (Task 14). Does NOT restart playback.
   *   - Updates currentWorld, musicalKey (root + scale), refreshes generators
   *   - Ramps BPM over 4 bars if the new world's BPM differs by more than 2
   *   - Applies the new world's FX mix to reverb/delay sends
   *   - Resets phrase-locked rotation counters (start the new world's first
   *     phrase cleanly)
   *   - All audio parameter changes use setTargetAtTime / 4-bar ramp — no jumps
   */
  switchWorld(worldId: WorldId): void {
    const newWorld = WORLDS[worldId];
    if (!newWorld) return;
    this.currentWorld = newWorld;

    // Key — keep the root if it's within the world's range; otherwise snap to
    // the midpoint of the world's rootRange.
    const newRoot = (this.musicalKey.root >= newWorld.rootRange[0] &&
                     this.musicalKey.root <= newWorld.rootRange[1])
      ? this.musicalKey.root
      : Math.floor((newWorld.rootRange[0] + newWorld.rootRange[1]) / 2);
    // PRESERVE the listener-detected scale if the reference listener has set
    // one (refKeyScale) AND the new world allows that scale. This prevents
    // switchWorld from clobbering the key pursuit when the world auto-switches
    // (the original bug: radio detected "F major" but the engine reverted to
    // the world's defaultScale "phrygianDominant" immediately after switching).
    const listenerScale = this.refKeyScale;
    const scaleAllowed = (s?: string): s is string =>
      !!s && newWorld.scales.includes(s);
    const newScale = scaleAllowed(listenerScale)
      ? listenerScale
      : newWorld.defaultScale;
    const keyChanged = newRoot !== this.musicalKey.root || newScale !== this.musicalKey.scale;
    this.musicalKey = { root: newRoot, scale: newScale };
    if (keyChanged) this.refreshMusicalGenerators();

    // BPM — ramp over 4 bars if diff > 2
    const newBpm = newWorld.defaultBpm;
    if (Math.abs(newBpm - this._bpm) > 2) {
      this.targetBpm = clamp(newBpm, 60, 200);
      this.bpmRampBarsLeft = 4;
      this.bpmRampPerBar = (newBpm - this._bpm) / 4;
    } else {
      this._bpm = clamp(newBpm, 60, 200);
      this.targetBpm = 0;
      this.bpmRampBarsLeft = 0;
      this.bpmRampPerBar = 0;
    }

    // FX mix — smooth ramp
    if (this.ctx) {
      const now = this.ctx.currentTime;
      const fxMix = newWorld.fxMix;
      this.reverbSend.gain.setTargetAtTime(0.04 + fxMix * 0.22, now, 0.5);
      this.delaySend.gain.setTargetAtTime(0.05 + fxMix * 0.30, now, 0.5);
    }

    // Reset phrase-locked counters — start the new world's first phrase cleanly
    this.phraseCounter = 0;
    this.phrasePresetVariant = 0;
    this.arpIdx = 0;
    this.bassPatternIdx = 0;

    // Apply the new world's preferred kick/bass/lead presets immediately so
    // the next phrase starts with the right timbres. The phrase-locked
    // rotation will then alternate between the two variants from here on.
    this.applyWorldPresets();

    // Apply per-world send-effect settings (Task E1) — pushes per-track send
    // levels and global effect parameters for the new world.
    this.applyWorldEffectSettings(newWorld);
  }

  /**
   * Apply the current world's preferred kick/bass/lead/pad/arp presets.
   * Called by switchWorld() and at start(). Phrase-locked rotation in tick()
   * will alternate between the two variants every 8 bars from here on.
   *
   * Task S1: leads/pads/arp now use ADVANCED_PRESETS:
   *   - Goa/Acid leads → FM presets (PS-FM-GOA / PS-FM-SQUELCH) — metallic/squelchy
   *   - Dark worlds    → PS-FM-SQUELCH (acid character)
   *   - Bright worlds  → PS-FM-BELL (cleaner, bell-like)
   *   - Pads           → PS-SUPERSAW-PAD (thick, rich, 7-osc supersaw)
   *   - Arp            → PS-WT-MORPH (wavetable, evolving texture)
   *   - Bass           → classic (PS-BASS-ROLL/DEEP) — bass doesn't need FM
   *   - Kick           → classic drum presets (unchanged)
   *
   * synthModeOverrides (set by reference pursuit via setSynthMode) take
   * precedence over the world defaults — applied at triggerSynth() time.
   */
  private applyWorldPresets(): void {
    const id = this.currentWorld.id;
    // Dark worlds → DEEP kick + ROLL bass; bright worlds → TIGHT kick + DEEP bass.
    // Mid worlds → mix. Lead swaps for goa/acid (FM metallic) vs others (FM bell).
    const dark = id === 'dark-psy' || id === 'forest' || id === 'deep-psy' || id === 'hypnotic';
    const acid = id === 'goa' || id === 'acid-psy';
    const bright = id === 'morning-psy' || id === 'cosmic' || id === 'organic-psy';

    this.tracks[0].presetId = dark ? 'PS-KICK-DEEP' : 'PS-KICK-TIGHT';
    // Bass stays classic — bass doesn't need FM/supersaw/wavetable
    this.tracks[4].presetId = dark ? 'PS-BASS-ROLL' : (bright ? 'PS-BASS-DEEP' : 'PS-BASS-ROLL');
    // Lead: FM for goa/acid (metallic goa leads), squelchy FM for dark worlds,
    // bell FM for bright worlds. The synthModeOverrides can still flip a track
    // to supersaw/wavetable/classic at runtime via setSynthMode().
    this.tracks[5].presetId = acid
      ? 'PS-FM-GOA'
      : (dark ? 'PS-FM-SQUELCH' : 'PS-FM-BELL');
    // Pad: supersaw for thick rich pads (7-osc with stereo spread)
    this.tracks[6].presetId = 'PS-SUPERSAW-PAD';
    // Arp: wavetable for evolving textures that morph over time
    this.tracks[7].presetId = 'PS-WT-MORPH';
  }

  /**
   * Apply per-world send-effect modulations to the existing racks (Task E1).
   * Called by start() and switchWorld() after applyWorldPresets(). Rebuilds
   * the per-track rack configs for the new world and pushes the SEND levels
   * (reverb/delay/chorus/phaser/distortion/bitcrush) to the racks via smooth
   * ramps. EQ/comp/sat/pan are NOT changed here — they're set once at init()
   * and left alone so a world switch doesn't reset the per-track tonal balance
   * mid-phrase.
   *
   * Safe to call before init() (no-op when racks is empty).
   */
  private applyWorldEffectSettings(world: World): void {
    if (this.racks.length === 0) return;
    const cfgs = buildTrackRackConfigs(world);
    for (let i = 0; i < this.racks.length && i < cfgs.length; i++) {
      const rack = this.racks[i];
      const cfg = cfgs[i];
      // Only send levels are ramped here — tonal chain (EQ/comp/sat/pan) is
      // set once at init() and left alone for stability.
      rack.setParameter('sendReverb', cfg.sendReverb);
      rack.setParameter('sendDelay', cfg.sendDelay);
      rack.setParameter('sendChorus', cfg.sendChorus);
      rack.setParameter('sendPhaser', cfg.sendPhaser);
      rack.setParameter('sendDistortion', cfg.sendDistortion);
      rack.setParameter('sendBitcrush', cfg.sendBitcrush);
    }

    // Also nudge the global send-effect parameters based on world character.
    if (this.chorusEffect && this.phaserEffect && this.distortionEffect && this.bitcrushEffect) {
      // Bright worlds → faster chorus rate; dark worlds → slower.
      const chorusRate = 0.35 + world.brightness * 0.5;
      this.chorusEffect.setParameter('rate', chorusRate);
      // Psychedelic worlds → faster phaser sweep + more feedback.
      const phaserRate = 0.15 + world.psychedelia * 0.6;
      this.phaserEffect.setParameter('rate', phaserRate);
      this.phaserEffect.setParameter('feedback', 0.25 + world.psychedelia * 0.4);
      // Aggressive/dark worlds → harder distortion.
      const distDrive = 2.5 + world.aggression * 5 + world.darkness * 2;
      this.distortionEffect.setParameter('drive', distDrive);
      // Dark worlds → coarser bitcrush (fewer bits, longer hold).
      const bcBits = Math.round(8 - world.darkness * 4);
      const bcHold = 2 + world.darkness * 6;
      this.bitcrushEffect.setParameter('bits', bcBits);
      this.bitcrushEffect.setParameter('holdMs', bcHold);
    }
  }

  /**
   * Adjust a single per-track effect parameter in real-time (Task E1).
   * Routes to the named rack's setParameter(). Used by the reference pursuit
   * (and the future automated mixer) to nudge timbre as the radio's character
   * changes. Unknown trackIdx / effectName → silent no-op.
   *
   * Recognized effectNames (see TrackEffectsRack.setParameter):
   *   eqLowGain, eqMidFreq, eqMidGain, eqMidQ, eqHighGain,
   *   compThreshold, compRatio, compAttack, compRelease, compKnee,
   *   satDrive, satMix,
   *   pan, haasDelayMs, haasMix,
   *   outputGain,
   *   sendReverb, sendDelay, sendChorus, sendPhaser, sendDistortion, sendBitcrush
   */
  setTrackEffect(trackIdx: number, effectName: string, value: number): void {
    if (!Number.isFinite(value)) return;
    if (trackIdx < 0 || trackIdx >= this.racks.length) return;
    this.racks[trackIdx].setParameter(effectName, value);
  }

  /**
   * Adjust a per-track SEND level in real-time (Task E1). Subset of
   * setTrackEffect() specialized for sends — handy for the arrangement
   * engine to push more reverb in breaks, less in drops, etc.
   *
   *   sendName ∈ { 'reverb', 'delay', 'chorus', 'phaser', 'distortion', 'bitcrush' }
   *   level ∈ [0, 1]
   */
  setSendLevel(trackIdx: number, sendName: 'reverb' | 'delay' | 'chorus' | 'phaser' | 'distortion' | 'bitcrush', level: number): void {
    if (!Number.isFinite(level)) return;
    if (trackIdx < 0 || trackIdx >= this.racks.length) return;
    this.racks[trackIdx].setParameter(`send${sendName.charAt(0).toUpperCase()}${sendName.slice(1)}` as any, level);
  }

  /**
   * Adjust a global send-effect parameter (Task E1). Lets the reference
   * pursuit or arrangement engine tweak the chorus rate / phaser feedback /
   * distortion drive / bitcrush bits in real time.
   *
   *   effectName ∈ { 'chorus', 'phaser', 'distortion', 'bitcrush' }
   *   param depends on the effect (see each class's setParameter).
   */
  setSendEffectParam(effectName: 'chorus' | 'phaser' | 'distortion' | 'bitcrush', param: string, value: number): void {
    if (!Number.isFinite(value)) return;
    switch (effectName) {
      case 'chorus':     this.chorusEffect?.setParameter(param, value);     break;
      case 'phaser':     this.phaserEffect?.setParameter(param, value);     break;
      case 'distortion': this.distortionEffect?.setParameter(param, value); break;
      case 'bitcrush':   this.bitcrushEffect?.setParameter(param, value);   break;
    }
  }

  /**
   * Adjust a master multiband compressor parameter in real-time (Task E1).
   * Recognized names: crossoverLow, crossoverHigh,
   *   lowThreshold, lowRatio, lowAttack, lowRelease, lowKnee, lowMakeup,
   *   midThreshold, midRatio, midAttack, midRelease, midKnee, midMakeup,
   *   highThreshold, highRatio, highAttack, highRelease, highKnee, highMakeup.
   */
  setMasterParam(name: string, value: number): void {
    this.multiband?.setParameter(name, value);
  }

  /**
   * Re-create the MelodyEngine and AcidPattern with the current musicalKey.
   * Called whenever the reference listener reports a new key — this is what
   * makes the engine actually pursue the radio's tonal center, not just store it.
   *
   * The MelodyEngine (Task M1) replaces the old LeadMotif: it generates
   * developmental A A' B A'' phrases with motif transformation, sequences,
   * tension curves, and call-response.
   */
  private refreshMusicalGenerators(): void {
    const seed = (this.musicalKey.root * 31 + this.musicalKey.scale.length * 7 + 11) >>> 0;
    this.musicRng = new SeededRng(seed);
    this.melody = new MelodyEngine(this.musicalKey.root, this.musicalKey.scale, this.musicRng);
    this.acidPattern = new AcidPattern(this.musicalKey.root, this.musicalKey.scale, this.musicRng);
    // ── Task H1: re-create HarmonyEngine + generate a default progression ──
    // Whenever the key changes, the harmony engine is rebuilt with the new
    // root/scale, and a fresh progression is generated so the pad can fall
    // back on it before the next section boundary triggers a regeneration.
    this.harmony = new HarmonyEngine(this.musicalKey.root, this.musicalKey.scale);
    // Use a mid-level energy estimate for the default progression; the next
    // section boundary will regenerate with the section's actual energy.
    this.currentProgression = this.harmony.generateProgression(4, 0.5);
    this.chordIdx = 0;
    this.currentChord = null;
  }

  private applyStyle(style: string): void {
    // Map detected style to preset combinations
    const stylePresets: Record<string, { kick: string; bass: string; lead: string; pad: string; arp: string }> = {
      'progressive-psy': { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-DEEP', lead: 'PS-LEAD-FMTEX', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'dark-psy':        { kick: 'PS-KICK-DEEP', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'goa':             { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'morning-psy':     { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-DEEP', lead: 'PS-LEAD-FMTEX', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'forest':          { kick: 'PS-KICK-DEEP', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'acid-psy':        { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
      'full-on':         { kick: 'PS-KICK-TIGHT', bass: 'PS-BASS-ROLL', lead: 'PS-LEAD-SQUELCH', pad: 'PS-PAD-PSYCH', arp: 'PS-ARP-ACID' },
    };
    const p = stylePresets[style];
    if (p) {
      this.tracks[0].presetId = p.kick;
      this.tracks[4].presetId = p.bass;
      this.tracks[5].presetId = p.lead;
      this.tracks[6].presetId = p.pad;
      this.tracks[7].presetId = p.arp;
    }
  }

  private targetEnergy = 0.5;

  /**
   * Receive fresh metrics from the reference radio and store them as pursuit
   * targets. Also applies the smooth sub/high energy gain ramps immediately
   * (these are the only adjustments that can ramp across long time constants
   * without per-note cooperation — kick decay / centroid / transient density
   * are applied per-note in triggerDrum / triggerSynth / scheduleStep).
   */
  liveTrack(refMetrics: {
    lufs: number;
    kickDecayMs: number;
    spectralCentroid: number;
    energy?: number;
    subEnergy?: number;
    lowEnergy?: number;
    midEnergy?: number;
    highEnergy?: number;
    airEnergy?: number;
    transientDensity?: number;
    bassDecayMs?: number;
    stereoWidth?: number;
    bpm?: number;
    detectedKey?: { root: number; scale: string; confidence: number };
    // ── Task T1: extended harmonic / transient-shape / stereo fields ──
    // All optional — older callers (and the V1 listener) won't send them,
    // in which case the pursuit gracefully no-ops.
    spectralFlatness?: number;
    spectralCrest?: number;
    hnr?: number;
    inharmonicity?: number;
    spectralSlopeDb?: number;
    transientSharpness?: number;
    transientDecayMs?: number;
    stereoBalance?: number;
    stereoCorrelation?: number;
    msRatio?: number;
  }): void {
    if (isFinite(refMetrics.lufs)) this.targetLufs = refMetrics.lufs;
    if (refMetrics.energy !== undefined && isFinite(refMetrics.energy)) {
      this.targetEnergy = clamp(refMetrics.energy, 0, 1);
      this.refEnergy = this.targetEnergy;
    }

    // ── KICK DECAY target (seconds) ──
    if (refMetrics.kickDecayMs > 50 && refMetrics.kickDecayMs < 800) {
      this.refKickDecay = clamp(refMetrics.kickDecayMs / 1000, 0.05, 0.8);
    }

    // ── SPECTRAL CENTROID target (Hz) ──
    if (isFinite(refMetrics.spectralCentroid) && refMetrics.spectralCentroid > 0) {
      this.refSpectralCentroid = clamp(refMetrics.spectralCentroid, 100, 12000);
    }

    // ── TRANSIENT DENSITY target (transients/sec) ──
    const td = refMetrics.transientDensity ?? 0;
    if (isFinite(td) && td > 0) {
      this.refTransientDensity = clamp(td, 0, 40);
    }

    // ── SUB / HIGH ENERGY targets (0..1) ──
    if (refMetrics.subEnergy !== undefined && isFinite(refMetrics.subEnergy)) {
      this.refSubEnergy = clamp(refMetrics.subEnergy, 0, 1);
    }
    if (refMetrics.highEnergy !== undefined && isFinite(refMetrics.highEnergy)) {
      this.refHighEnergy = clamp(refMetrics.highEnergy, 0, 1);
    }

    // ── BASS DECAY target (seconds) ──
    if (refMetrics.bassDecayMs !== undefined && refMetrics.bassDecayMs > 20 && refMetrics.bassDecayMs < 1500) {
      this.refBassDecay = clamp(refMetrics.bassDecayMs / 1000, 0.05, 1.5);
    }

    // ── Additional features for the style classifier (Task 14) ──
    if (refMetrics.lowEnergy !== undefined && isFinite(refMetrics.lowEnergy)) {
      this.refLowEnergy = clamp(refMetrics.lowEnergy, 0, 1);
    }
    if (refMetrics.midEnergy !== undefined && isFinite(refMetrics.midEnergy)) {
      this.refMidEnergy = clamp(refMetrics.midEnergy, 0, 1);
    }
    if (refMetrics.airEnergy !== undefined && isFinite(refMetrics.airEnergy)) {
      this.refAirEnergy = clamp(refMetrics.airEnergy, 0, 1);
    }
    if (refMetrics.stereoWidth !== undefined && isFinite(refMetrics.stereoWidth)) {
      this.refStereoWidth = clamp(refMetrics.stereoWidth, 0, 1);
    }
    if (refMetrics.bpm !== undefined && isFinite(refMetrics.bpm) && refMetrics.bpm > 0) {
      this.refBpm = clamp(refMetrics.bpm, 30, 220);
    }
    if (refMetrics.detectedKey?.scale) {
      this.refKeyScale = refMetrics.detectedKey.scale;
    }

    // ── Task T1: store the new extended metrics ──
    if (refMetrics.spectralFlatness !== undefined && isFinite(refMetrics.spectralFlatness)) {
      this.refSpectralFlatness = clamp(refMetrics.spectralFlatness, 0, 1);
    }
    if (refMetrics.spectralCrest !== undefined && isFinite(refMetrics.spectralCrest)) {
      this.refSpectralCrest = clamp(refMetrics.spectralCrest, 0, 100);
    }
    if (refMetrics.hnr !== undefined && isFinite(refMetrics.hnr)) {
      this.refHnr = clamp(refMetrics.hnr, 0, 1);
    }
    if (refMetrics.inharmonicity !== undefined && isFinite(refMetrics.inharmonicity)) {
      this.refInharmonicity = clamp(refMetrics.inharmonicity, 0, 1);
    }
    if (refMetrics.spectralSlopeDb !== undefined && isFinite(refMetrics.spectralSlopeDb)) {
      this.refSpectralSlopeDb = clamp(refMetrics.spectralSlopeDb, -36, 6);
    }
    if (refMetrics.transientSharpness !== undefined && isFinite(refMetrics.transientSharpness)) {
      this.refTransientSharpness = clamp(refMetrics.transientSharpness, 0, 1);
    }
    if (refMetrics.transientDecayMs !== undefined && isFinite(refMetrics.transientDecayMs)) {
      this.refTransientDecayMs = clamp(refMetrics.transientDecayMs, 0, 1000);
    }
    if (refMetrics.stereoBalance !== undefined && isFinite(refMetrics.stereoBalance)) {
      this.refStereoBalance = clamp(refMetrics.stereoBalance, -1, 1);
    }
    if (refMetrics.stereoCorrelation !== undefined && isFinite(refMetrics.stereoCorrelation)) {
      this.refStereoCorrelation = clamp(refMetrics.stereoCorrelation, -1, 1);
    }
    if (refMetrics.msRatio !== undefined && isFinite(refMetrics.msRatio)) {
      this.refMsRatio = clamp(refMetrics.msRatio, 0, 1);
    }

    // ── Task T1: track LUFS history for compression-pursuit proxy ──
    if (isFinite(refMetrics.lufs)) {
      this.recentLufsValues.push(refMetrics.lufs);
      if (this.recentLufsValues.length > Psy4EngineV2.LUFS_HISTORY_MAX) {
        this.recentLufsValues.shift();
      }
    }

    // ── SUB / HIGH energy balancing — smooth ramp on track gains ──
    // Boost bass track (4) when ref has more sub than we do; boost lead/pad/arp
    // (5,6,7) when ref has more high energy. Time constants 0.8-1.0s (timbre).
    if (this.ctx) {
      const now = this.ctx.currentTime;
      if (this.refSubEnergy > 0 && this.ownSubEnergy > 0) {
        const subDiff = this.refSubEnergy - this.ownSubEnergy;
        if (Math.abs(subDiff) > 0.05) {
          const bassAdj = clamp(subDiff * 0.4, -0.3, 0.3);
          const bassTarget = clamp(0.8 + bassAdj, 0.3, 2.0);
          this.trackGains[4]?.gain.setTargetAtTime(bassTarget, now, 0.8);
          if (subDiff > 0.05) {
            const kickTarget = clamp(1.0 + subDiff * 0.2, 0.6, 1.8);
            this.trackGains[0]?.gain.setTargetAtTime(kickTarget, now, 0.8);
          }
        }
      }
      if (this.refHighEnergy > 0 && this.ownHighEnergy > 0) {
        const highDiff = this.refHighEnergy - this.ownHighEnergy;
        if (Math.abs(highDiff) > 0.05) {
          const adj = clamp(highDiff * 0.5, -0.3, 0.3);
          for (const ti of [5, 6, 7]) {
            const target = clamp(0.8 + adj, 0.3, 1.6);
            this.trackGains[ti]?.gain.setTargetAtTime(target, now, 1.0);
          }
        }
      }
    }

    // ── Task T1: drive the new synthesis + effects pursuit paths ──
    // Both run inside liveTrack() so they fire as soon as fresh reference
    // features arrive (every ~10s from the V2 listener). They are guarded
    // against NaN/undefined internally, so partial feature sets no-op.
    this.applySynthesisPursuit();
    this.applyEffectsPursuit();
  }

  // ─── Task T1: synthesis character pursuit ──────────────────────────────────
  //
  // Calls detectSynthesisCharacter() on the latest reference features. If the
  // detector returns a confident result (confidence > 0.5) AND the 20-second
  // anti-thrash cooldown has elapsed, switches the LEAD track (5) to the
  // detected mode and tunes the mode-specific parameter (FM depth, supersaw
  // spread, or wavetable position).
  //
  // The detected character is ALWAYS stored (even when we don't act on it) so
  // the UI / dashboard can show what the detector currently thinks. This is
  // important: a low-confidence "between two modes" result is still useful
  // diagnostic info, even if we leave the preset selection alone.
  private applySynthesisPursuit(): void {
    // Build the RefFeatures snapshot from stored metrics. If we don't have
    // the harmonic-content sub-object, the detector returns 'classic' with
    // zero confidence and we no-op.
    const features = this.buildRefFeatures();
    if (!features) return;

    const character = detectSynthesisCharacter(features);
    this.detectedSynthesisCharacter = character;

    // Only act on confident detections — low confidence means the radio
    // doesn't strongly match any synthesis mode, so leave the per-world
    // preset selection alone.
    if (character.confidence < Psy4EngineV2.SYNTH_CONFIDENCE_THRESHOLD) return;

    // Anti-thrash: don't switch more often than every 20 seconds. This
    // prevents the lead from flickering between FM and supersaw when the
    // detector wobbles on borderline material.
    const nowMs = Date.now();
    if (nowMs - this.lastSynthModeSwitchTime < Psy4EngineV2.SYNTH_MODE_COOLDOWN_MS) {
      // Still update the modulation params below — even mid-cooldown, we
      // can tune FM depth / wavetable position without flipping the mode.
    } else if (character.mode !== 'classic') {
      // Switch the LEAD track (5) to the detected synthesis mode.
      this.setSynthMode(5, character.mode);
      this.lastSynthModeSwitchTime = nowMs;
      if (typeof console !== 'undefined') {
        console.log(
          `[PSY4] Synthesis pursuit: lead → ${character.mode} ` +
          `(${(character.confidence * 100).toFixed(0)}% — ` +
          `${character.reasons.join('; ') || 'no reasons'})`,
        );
      }
    } else {
      // Classic with high confidence → clear any active override so the
      // per-world preset selection takes over again.
      this.setSynthMode(5, null);
      this.lastSynthModeSwitchTime = nowMs;
    }

    // Always tune the mode-specific parameter when in that mode. This lets
    // the pursuit continuously shape FM depth / wavetable position to match
    // the radio's evolving timbre, even between mode switches.
    if (character.mode === 'fm' && character.fmDepth > 0) {
      this.setFMDepth(character.fmDepth);
    } else if (character.fmDepth === 0 && this.fmDepthOverride > 0) {
      // Clear stale FM depth override when we're no longer in FM mode.
      this.setFMDepth(0);
    }
    if (character.mode === 'wavetable' && character.wtPosition >= 0) {
      this.setWavetablePosition(character.wtPosition);
    } else if (character.wtPosition === 0.5 && this.wtPositionOverride >= 0) {
      // Reset wavetable override when leaving wavetable mode.
      this.setWavetablePosition(-1);
    }
  }

  // ─── Task T1: effects parameter pursuit ────────────────────────────────────
  //
  // Drives the new effects control surface (Task E1) from the extended
  // reference features. Each branch is independent and guarded so a missing
  // feature on one axis doesn't block the others.
  //
  //   - Reverb tail: long kickDecay + wide stereo → more reverb send on the
  //     music (LEAD/PAD/ARP) and atmos (SNARE/HATS/PERC) buses.
  //   - Brightness: high centroid/airEnergy → high-shelf boost on lead/arp;
  //     low centroid → high-shelf cut + low-shelf boost on bass.
  //   - Stereo width: low correlation (<0.5) → longer Haas delay on the
  //     melodic tracks for extra width.
  //   - Compression: small LUFS variance over recent windows → higher
  //     master compressor ratio (the radio is "glued").
  //
  // All ramps use setTargetAtTime via setTrackEffect / setMasterParam so the
  // changes are smooth and don't introduce clicks.
  private applyEffectsPursuit(): void {
    if (!this.ctx) return;

    // ── Reverb send ──
    // Long kick decay + wide stereo is the signature of a reverberant mix.
    // Boost the per-track reverb sends on melodic + atmos tracks. Cap the
    // boost at +0.15 so we don't drown the mix.
    if (this.refKickDecay > 0 && this.refStereoWidth > 0) {
      const tailness = clamp(
        (this.refKickDecay - 0.12) / 0.5 * 0.6 +
        this.refStereoWidth * 0.4,
        0, 1,
      );
      if (tailness > 0.05) {
        // Music bus: LEAD(5), PAD(6), ARP(7) — push the wettest sends.
        const musicBoost = clamp(tailness * 0.18, 0, 0.18);
        for (const ti of [5, 6, 7]) {
          // Read the current send via the rack's snapshot — we don't have a
          // getter, so we just push the target value (clamped) and let the
          // rack's internal setParameter handle smoothing. The rack clamps
          // 0..1, so this is safe.
          this.setSendLevel(ti, 'reverb', clamp(0.22 + musicBoost, 0, 0.5));
        }
        // Atmos bus: SNARE(1), HATS(2), PERC(3) — smaller boost.
        const atmosBoost = clamp(tailness * 0.10, 0, 0.10);
        for (const ti of [1, 2, 3]) {
          this.setSendLevel(ti, 'reverb', clamp(0.16 + atmosBoost, 0, 0.4));
        }
      }
    }

    // ── Brightness ──
    // High centroid (>3500 Hz) or high airEnergy (>0.4) → boost high-shelf
    // on LEAD(5)/ARP(7). Low centroid (<1500 Hz) → cut high-shelf, boost
    // low-shelf on BASS(4) for warmth.
    if (this.refSpectralCentroid > 0) {
      const bright = this.refSpectralCentroid;
      if (bright > 3500) {
        const boost = clamp((bright - 3500) / 4000 * 3, 0, 3);
        for (const ti of [5, 7]) {
          this.setTrackEffect(ti, 'eqHighGain', clamp(2 + boost, 0, 6));
        }
      } else if (bright < 1500) {
        // Dark reference — pull back the high shelf, warm up the bass.
        const cut = clamp((1500 - bright) / 1000 * 2, 0, 4);
        for (const ti of [5, 6, 7]) {
          this.setTrackEffect(ti, 'eqHighGain', clamp(-1 - cut, -8, 0));
        }
        this.setTrackEffect(4, 'eqLowGain', clamp(2.5 + cut * 0.5, 0, 6));
      }
    }
    if (this.refAirEnergy > 0.4) {
      // Extra air boost on HATS(2) when the reference has a lot of air energy.
      this.setTrackEffect(2, 'eqHighGain', clamp(2.5 + (this.refAirEnergy - 0.4) * 4, 0, 6));
    }

    // ── Stereo width via Haas delay ──
    // Low correlation (<0.5) means the radio is wide. Lengthen the Haas
    // delay on melodic tracks (LEAD/PAD/ARP) to add width. Correlation
    // >0.8 means the radio is narrow — pull Haas back toward mono.
    if (this.refStereoCorrelation !== 0 || this.refStereoWidth > 0) {
      const corr = this.refStereoCorrelation;
      if (corr > -1 && corr < 0.5) {
        // Wide: scale Haas delay 9..22 ms based on (0.5 - corr).
        const wideness = clamp((0.5 - corr) / 1.5, 0, 1);
        const haasMs = clamp(9 + wideness * 13, 9, 22);
        for (const ti of [5, 6, 7]) {
          this.setTrackEffect(ti, 'haasDelayMs', haasMs);
          this.setTrackEffect(ti, 'haasMix', clamp(0.5 + wideness * 0.4, 0.3, 0.9));
        }
      } else if (corr > 0.8) {
        // Narrow: reduce Haas mix toward mono.
        for (const ti of [5, 6, 7]) {
          this.setTrackEffect(ti, 'haasMix', 0.2);
        }
      }
    }

    // ── Master compression ──
    // If recent LUFS values span a small range (<2 dB), the radio is heavily
    // compressed / limited. Push our master mid-band ratio up to match the
    // "glued" character. Wide LUFS swing (>6 dB) means dynamic material —
    // relax the ratio so we don't over-compress.
    if (this.recentLufsValues.length >= 3) {
      const minL = Math.min(...this.recentLufsValues);
      const maxL = Math.max(...this.recentLufsValues);
      const swing = maxL - minL;
      if (swing < 2) {
        // Glued — push mid ratio up to ~4:1.
        this.setMasterParam('midRatio', clamp(3 + (2 - swing) * 0.5, 3, 5));
        this.setMasterParam('highRatio', clamp(2 + (2 - swing) * 0.25, 2, 3));
      } else if (swing > 6) {
        // Dynamic — relax mid ratio to ~2:1.
        this.setMasterParam('midRatio', 2);
      }
    }

    // ── Transient sharpness → distortion send ──
    // Sharp transients in the reference (>0.7) suggest aggressive /
    // distorted source material. Push the distortion send on LEAD(5) up.
    if (this.refTransientSharpness > 0.7) {
      const extra = clamp((this.refTransientSharpness - 0.7) * 0.5, 0, 0.15);
      this.setSendLevel(5, 'distortion', clamp(0.18 + extra, 0, 0.4));
    }
  }

  /**
   * Build a RefFeatures snapshot from the stored reference metrics.
   * Returns null if we don't have enough features to classify meaningfully
   * (need at least BPM or centroid + one energy band).
   *
   * Task T1: also populates the optional harmonicContent / transientShape /
   * stereoField subobjects so detectSynthesisCharacter() can do its job.
   */
  private buildRefFeatures(): RefFeatures | null {
    const hasBpm = this.refBpm > 0;
    const hasCentroid = this.refSpectralCentroid > 0;
    const hasEnergy = this.refSubEnergy > 0 || this.refHighEnergy > 0 ||
                      this.refLowEnergy > 0 || this.refMidEnergy > 0;
    if (!hasBpm && !hasCentroid && !hasEnergy) return null;

    // ── Task T1: only attach the nested subobjects when we actually have
    //    harmonic-content data (HNR > 0 OR spectralCrest > 0 OR inharmonicity
    //    > 0). This lets detectSynthesisCharacter() distinguish "no analysis
    //    done yet" from "analysis done, classic mode detected".
    const hasHarmonic = this.refSpectralCrest > 0 || this.refHnr > 0 ||
                        this.refInharmonicity > 0 || this.refSpectralFlatness > 0;
    const harmonicContent = hasHarmonic ? {
      flatness: this.refSpectralFlatness,
      crest: this.refSpectralCrest,
      hnr: this.refHnr,
      inharmonicity: this.refInharmonicity,
      slope: this.refSpectralSlopeDb,
    } : undefined;

    const hasTransientShape = this.refTransientSharpness > 0 || this.refTransientDecayMs > 0;
    const transientShape = hasTransientShape ? {
      sharpness: this.refTransientSharpness,
      decay: this.refTransientDecayMs,
    } : undefined;

    // stereoField: we always have stereoWidth (even if 0), so always attach.
    // The other fields default to 0 when not measured.
    const stereoField = {
      width: this.refStereoWidth,
      balance: this.refStereoBalance,
      correlation: this.refStereoCorrelation,
      msRatio: this.refMsRatio,
    };

    return {
      bpm: this.refBpm,
      spectralCentroid: this.refSpectralCentroid,
      subEnergy: this.refSubEnergy,
      lowEnergy: this.refLowEnergy,
      midEnergy: this.refMidEnergy,
      highEnergy: this.refHighEnergy,
      airEnergy: this.refAirEnergy,
      transientDensity: this.refTransientDensity,
      kickDecayMs: this.refKickDecay * 1000,
      bassDecayMs: this.refBassDecay * 1000,
      stereoWidth: this.refStereoWidth,
      energy: this.refEnergy,
      detectedKey: this.refKeyScale
        ? { root: this.musicalKey.root, scale: this.refKeyScale, confidence: 1 }
        : undefined,
      harmonicContent,
      transientShape,
      stereoField,
    };
  }

  /**
   * Receive fresh metrics from our own engine output (via SelfAnalyzer).
   * Stores own sub/high/centroid/transient for getPursuitStatus() and the
   * sub/high balancing done in liveTrack().
   */
  selfTrack(selfMetrics: {
    lufs: number;
    energy?: number;
    spectralCentroid?: number;
    transientDensity?: number;
    subEnergy?: number;
    highEnergy?: number;
  }): void {
    this.ownLufs = selfMetrics.lufs;
    if (selfMetrics.spectralCentroid !== undefined && isFinite(selfMetrics.spectralCentroid) && selfMetrics.spectralCentroid > 0) {
      this.ownSpectralCentroid = selfMetrics.spectralCentroid;
    }
    if (selfMetrics.transientDensity !== undefined && isFinite(selfMetrics.transientDensity)) {
      this.ownTransientDensity = selfMetrics.transientDensity;
    }
    if (selfMetrics.subEnergy !== undefined && isFinite(selfMetrics.subEnergy)) {
      this.ownSubEnergy = selfMetrics.subEnergy;
    }
    if (selfMetrics.highEnergy !== undefined && isFinite(selfMetrics.highEnergy)) {
      this.ownHighEnergy = selfMetrics.highEnergy;
    }
    // LUFS matching
    if (this.targetLufs !== 0 && Math.abs(selfMetrics.lufs - this.targetLufs) > 1.0) {
      const diff = this.targetLufs - selfMetrics.lufs;
      const adj = diff > 0 ? 0.08 : -0.08;
      const newMaster = clamp(this.master.gain.value + adj, 0.3, 2.0);
      this.master.gain.setTargetAtTime(newMaster, this.ctx!.currentTime, 0.15);
    }
    // Energy matching — adjust track volumes
    if (this.targetEnergy > 0 && selfMetrics.energy !== undefined) {
      const energyDiff = this.targetEnergy - selfMetrics.energy;
      if (Math.abs(energyDiff) > 0.05) {
        // Boost/reduce all track gains slightly
        const volAdj = energyDiff > 0 ? 0.02 : -0.02;
        for (let i = 0; i < 8; i++) {
          const g = this.trackGains[i];
          if (g) {
            const newVol = clamp(g.gain.value + volAdj, 0.1, 2.0);
            g.gain.setTargetAtTime(newVol, this.ctx!.currentTime, 0.5);
          }
        }
      }
    }
  }

  setWorld(params: Record<string, number>): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (params.masterLevel !== undefined) {
      this.master.gain.setTargetAtTime(params.masterLevel, t, 0.1);
    }
    if (params.bassLevel !== undefined) {
      this.trackGains[4].gain.setTargetAtTime(params.bassLevel * 0.8, t, 0.1);
    }
    if (params.leadLevel !== undefined) {
      this.trackGains[5].gain.setTargetAtTime(params.leadLevel * 0.8, t, 0.1);
    }
    if (params.kickLevel !== undefined) {
      this.trackGains[0].gain.setTargetAtTime(params.kickLevel * 0.8, t, 0.1);
    }
    // ── Learned params from ContinuousTrainer (Task 22): store for blending ──
    //    These are applied incrementally in triggerDrum / triggerSynth, not here,
    //    because they affect per-voice synthesis. Guard against NaN/out-of-range.
    if (isFinite(params.kickDecay) && params.kickDecay > 0.02 && params.kickDecay < 2) {
      this.learned.kickDecay = params.kickDecay;
    }
    if (isFinite(params.bassCutoff) && params.bassCutoff > 40 && params.bassCutoff < 4000) {
      this.learned.bassCutoff = params.bassCutoff;
    }
    if (isFinite(params.leadCutoff) && params.leadCutoff > 100 && params.leadCutoff < 16000) {
      this.learned.leadCutoff = params.leadCutoff;
    }
    if (isFinite(params.leadDetune) && params.leadDetune >= 0 && params.leadDetune < 100) {
      this.learned.leadDetune = params.leadDetune;
    }
    if (isFinite(params.padCutoff) && params.padCutoff > 80 && params.padCutoff < 12000) {
      this.learned.padCutoff = params.padCutoff;
    }
    if (isFinite(params.duck) && params.duck >= 0 && params.duck <= 1) {
      this.learned.duck = params.duck;
    }
  }

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  private scheduleNextTick(): void {
    if (!this.playing) return;
    this.timer = setTimeout(() => {
      this.tick();
      this.scheduleNextTick();
    }, 15);
  }

  private tick(): void {
    if (!this.playing || !this.ctx) return;
    const lookahead = 0.06;

    while (this.nextTime < this.ctx.currentTime + lookahead) {
      // Recompute s16 each step so the BPM ramp changes tempo smoothly
      // without invalidating the scheduler's lookahead window.
      const s16 = 60 / this.bpm / 4;
      this.scheduleStep(this.step, this.bar, this.nextTime);
      this.step++;
      this.nextTime += s16;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        // ── Per-bar melodic evolution (Task M1) ──
        // MelodyEngine.tickEvolution() refreshes the B section (contrasting motif)
        // every N bars based on the world's evolutionRate. Interval shrinks as
        // evolutionRate grows (faster evolution for goa / acid-psy).
        this.melody?.tickEvolution(this.bar, this.currentWorld.evolutionRate, 8);
        // ── BPM ramp smoothing (one step per bar, over 4 bars total) ──
        if (this.bpmRampBarsLeft > 0 && this.bpmRampPerBar !== 0) {
          const stepped = this._bpm + this.bpmRampPerBar;
          this._bpm = clamp(Math.round(stepped * 10) / 10, 60, 200);
          this.bpmRampBarsLeft--;
          if (this.bpmRampBarsLeft <= 0) {
            // Snap to final target at end of ramp
            this._bpm = this.targetBpm || this._bpm;
            this.targetBpm = 0;
            this.bpmRampPerBar = 0;
          }
        }
        const section = this.arrangement[this.sectionIdx % this.arrangement.length];
        if (this.bar >= section.bars) {
          this.sectionIdx++;
          this.bar = 0;
          const next = this.arrangement[this.sectionIdx % this.arrangement.length];
          this.currentSection = next.label;
          this.onSectionChange?.(this.currentSection);
          // ── Section boundary: force a new developmental phrase (Task M1) ──
          // MelodyEngine.newPhrase() builds a fresh A A' B A'' phrase using the
          // new section's energy + tension curve. This is what makes the lead
          // play evolving, developing melodies instead of static motifs.
          const baseE = this.currentWorld.energyCurve[0] ?? 0.5;
          const phraseEnergy = clamp(baseE * (0.4 + 0.6 * next.density), 0, 1);
          this.melody?.newPhrase(phraseEnergy);
          // ── Task H1: regenerate the harmonic progression at section boundary ──
          // Each new section gets a fresh chord progression whose length matches
          // the section's bar count and whose extension level (triad/7th/9th)
          // matches the section's energy. Drops get lush 9ths; breaks get triads.
          if (this.harmony) {
            this.currentProgression = this.harmony.generateProgression(next.bars, phraseEnergy);
            this.chordIdx = 0;
            this.currentChord = null;
          }
        }
        // ── Phrase-locked preset rotation (Task 15) ──
        // Every 8 bars, rotate kick/bass preset between 2 variants based on
        // world character. Gives sonic consistency within a phrase, then
        // variation across phrases. Also rotates bass pattern every 4 bars
        // for melodic variation (kept from Track A).
        this.phraseCounter++;
        if (this.bar % 8 === 0 && this.bar > 0) {
          this.phrasePresetVariant = (this.phrasePresetVariant + 1) % 2;
          this.applyPhrasePresetRotation();
        }
        // Bass pattern rotates every 4 bars (kept from Track A — denser variation)
        if (this.bar % 4 === 0 && this.bar > 0) {
          const bassStyle = this.deriveBassStyle();
          const bps = BASS_PATTERNS[bassStyle] || BASS_PATTERNS.off;
          this.bassPatternIdx = (this.bassPatternIdx + 1) % bps.length;
        }
      }
    }
  }

  /**
   * Phrase-locked preset rotation (Task 15). Every 8 bars, swap kick + bass
   * presets between two variants based on the current world's character:
   *   - Dark worlds (dark-psy, forest, deep-psy, hypnotic) → rotate between
   *     DEEP/ROLL (default) and TIGHT/ROLL (variation).
   *   - Bright worlds (morning-psy, cosmic, organic-psy) → rotate between
   *     TIGHT/DEEP (default) and TIGHT/ROLL (variation).
   *   - Acid worlds (goa, acid-psy) → rotate between TIGHT/ROLL and TIGHT/DEEP.
   *   - Others → rotate between TIGHT/ROLL and DEEP/ROLL.
   * Lead/Pad/Arp presets stay fixed per world — only kick/bass rotate to keep
   * the harmonic identity stable.
   */
  private applyPhrasePresetRotation(): void {
    const id = this.currentWorld.id;
    const variant = this.phrasePresetVariant;
    const dark = id === 'dark-psy' || id === 'forest' || id === 'deep-psy' || id === 'hypnotic';
    const bright = id === 'morning-psy' || id === 'cosmic' || id === 'organic-psy';
    const acid = id === 'goa' || id === 'acid-psy';

    let kick: string;
    let bass: string;
    if (dark) {
      kick = variant === 0 ? 'PS-KICK-DEEP' : 'PS-KICK-TIGHT';
      bass = 'PS-BASS-ROLL';
    } else if (bright) {
      kick = 'PS-KICK-TIGHT';
      bass = variant === 0 ? 'PS-BASS-DEEP' : 'PS-BASS-ROLL';
    } else if (acid) {
      kick = 'PS-KICK-TIGHT';
      bass = variant === 0 ? 'PS-BASS-ROLL' : 'PS-BASS-DEEP';
    } else {
      // progressive-psy and any other mid character
      kick = variant === 0 ? 'PS-KICK-TIGHT' : 'PS-KICK-DEEP';
      bass = variant === 0 ? 'PS-BASS-ROLL' : 'PS-BASS-DEEP';
    }
    this.tracks[0].presetId = kick;
    this.tracks[4].presetId = bass;
  }

  /** Derive bass style from world id (worlds.ts doesn't have a 'bass' field). */
  private deriveBassStyle(): 'roll' | 'acid' | 'off' {
    const id = this.currentWorld.id;
    if (id.includes('dark') || id.includes('forest')) return 'roll';
    if (id.includes('goa') || id.includes('acid')) return 'acid';
    return 'off';
  }

  private scheduleStep(step: number, bar: number, time: number): void {
    const w = this.currentWorld;
    const section = this.arrangement[this.sectionIdx % this.arrangement.length];
    const key = this.musicalKey;
    const root = key.root;
    const sc = key.scale;
    const sd = 60 / this.bpm / 4;

    // ── Energy from world's energyCurve, modulated by section density ──
    const eIdx = clamp(
      Math.floor((bar / Math.max(1, section.bars)) * w.energyCurve.length),
      0,
      w.energyCurve.length - 1
    );
    const baseEnergy = w.energyCurve[eIdx];
    const energy = clamp(baseEnergy * (0.4 + 0.6 * section.density), 0, 1);

    // ── Swing: delay offbeat steps by swing * halfStep ──
    let stepTime = time;
    if (step % 2 === 1 && w.swing > 0) {
      stepTime += w.swing * sd * 0.5;
    }

    const isPreDrop = (section.label === 'BUILD' || section.label === 'BUILD 2') && bar >= section.bars - 2;
    const isDropStart = section.label.includes('DROP') && bar === 0 && step === 0;

    // ── RISER FX (last 2 bars of build) — uses raw time, not swung ──
    if (isPreDrop && step === 0 && bar === section.bars - 2) {
      this.triggerRiser(time, sd * 32);
    }

    // ── IMPACT FX (drop start) ──
    if (isDropStart) {
      this.triggerImpact(time);
    }

    // Reference pursuit — scale hat/perc probability by refTransientDensity.
    const tScale = this.refTransientDensity > 0
      ? clamp(0.5 + this.refTransientDensity / 24, 0.3, 1.8)
      : 1.0;
    const tVelBoost = tScale > 1 ? (tScale - 1) * 0.5 : 0;

    // ── Pre-compute world timbre overrides (cutoff/resonance modulated by character) ──
    const leadTimbre = {
      cutoff: w.leadTimbre.cutoff * (0.7 + 0.6 * w.brightness),
      res: 2 + w.leadTimbre.resonance * 12,
      drive: w.leadTimbre.drive,
    };
    const bassTimbre = {
      cutoff: w.bassTimbre.cutoff * (0.7 + 0.6 * (1 - w.darkness)),
      res: 2 + w.bassTimbre.resonance * 12,
      drive: w.bassTimbre.drive,
    };
    const padTimbre = {
      cutoff: w.padTimbre.cutoff * (0.6 + 0.8 * w.brightness),
      res: 2 + w.padTimbre.resonance * 12,
      drive: w.padTimbre.drive,
    };
    const arpTimbre = {
      cutoff: w.textureTimbre.cutoff * (0.7 + 0.6 * w.psychedelia),
      res: 2 + w.textureTimbre.resonance * 12,
      drive: w.textureTimbre.drive,
    };

    // ── KICK (track 0) — world-driven kickPattern (16-char gate string) ──
    if (w.kickPattern.length === 16 && w.kickPattern.charAt(step) === 'x') {
      const isDownbeat = step % 4 === 0;
      const aggressionBoost = 0.7 + 0.6 * w.aggression;
      // Velocity scales with both section.density and energyCurve so drops hit
      // harder than builds even at the same density (Task 15: verify energy
      // actually affects velocity/density).
      const vel = isDownbeat
        ? 0.4 + section.density * 0.3 * aggressionBoost + energy * 0.15
        : 0.3 * aggressionBoost + energy * 0.1;
      this.triggerDrum(0, stepTime, vel);
    }

    // ── CLAP (track 1) — world-driven clapPattern gate ('x' = hit) ──
    if (w.clapPattern && w.clapPattern.length === 16 && w.clapPattern.charAt(step) === 'x' && section.density > 0.4) {
      this.triggerDrum(1, stepTime, 0.3 + energy * 0.1);
    }

    // ── HATS (track 2) — probability from world.hatDensity per eligible offbeat ──
    const hatProb = clamp(w.hatDensity * (0.5 + 0.5 * energy) * tScale, 0, 1);
    if (step % 2 === 1 && this.musicRng?.chance(hatProb)) {
      const vel = 0.15 + (step % 4 === 3 ? 0.1 : 0) + energy * 0.1 + tVelBoost;
      this.triggerDrum(2, stepTime, vel);
    }

    // ── PERC (track 3) — world-driven percPattern gate + density-based probability ──
    const percProb = clamp(w.percDensity * energy * tScale, 0, 1);
    if (w.percPattern && w.percPattern.length === 16 && w.percPattern.charAt(step) === 'x' && section.density > 0.5 && this.musicRng?.chance(percProb)) {
      this.triggerDrum(3, stepTime, 0.2 + tVelBoost);
    }

    // ── BASS (track 4) — world-driven bassPattern + BASS_PATTERNS by derived style ──
    // Task H1: when in a lead section (drop/variation) with an active chord,
    // the bass follows the chord root — bassDeg becomes an offset ABOVE the
    // current chord's scale degree. This makes the bass walk with the harmony
    // (e.g. during a VI chord, the bass plays the VI root + pattern offsets
    // instead of staying on the tonic). In non-lead sections (groove/build/
    // outro), the bass stays on the tonic for that classic psytrance pump.
    if (section.bass && w.bassPattern.length === 16 && w.bassPattern.charAt(step) === 'x') {
      const bassStyle = this.deriveBassStyle();
      const bps = BASS_PATTERNS[bassStyle] || BASS_PATTERNS.off;
      const bp = bps[this.bassPatternIdx % bps.length];
      const bassStep = Math.floor((step - 1) / 2) % bp.steps.length;
      const bassDeg = bp.steps[bassStep];
      if (bassDeg >= 0) {
        // Shift the bass note by the current chord's scale degree during lead
        // sections so the bass walks with the harmony. Otherwise (non-lead
        // sections, or before the first chord plays) keep the bass on the
        // tonic degree — psytrance sub-bass pumping on the tonic is genre-
        // defining and we don't want to lose that feel.
        const chordDegOffset = (section.lead && this.currentChord)
          ? this.currentChord.scaleDegree
          : 0;
        const note = scaleNote(root, sc, chordDegOffset + bassDeg);
        const accent = bp.accents[bassStep] ?? 1;
        // Bass velocity scales with energy so drops push the bass harder
        this.triggerSynth(4, stepTime, note, (0.4 + energy * 0.2) * accent, sd, undefined, bassTimbre);
      }
    }

    // ── LEAD (track 5) — MelodyEngine with developmental A A' B A'' structure ──
    // Replaces the old LeadMotif (Task M1). The engine handles motif generation,
    // transformation (transpose/invert/fragment/sequence), tension curves, and
    // call-response automatically. nextNote() returns null on rests / steps
    // without a scheduled event (so notes can sustain across multiple steps).
    if (section.lead && this.melody && energy > 0.35) {
      const noteInfo = this.melody.nextNote(step, bar, energy);
      if (noteInfo) {
        // Use the engine's per-note duration (1-4 16th steps) for proper
        // melodic phrasing — longer notes for emphasis, short notes for runs.
        this.triggerSynth(5, stepTime, noteInfo.note, noteInfo.velocity, sd, sd * noteInfo.duration, leadTimbre);
      }
    }

    // ── PAD (track 6) — rich 4-5 note voicings via HarmonyEngine (Task H1) ──
    // Replaces the old "chordRoot + fifth" two-note pad with voice-led chord
    // voicings that include bass note (root or inversion), 3rd, 5th, 7th, 9th.
    // The progression is regenerated at section boundaries with energy-driven
    // extension levels (triads in breaks → 9ths in drops). Voice leading keeps
    // common tones and minimizes movement for smooth symphonic flow.
    if (section.lead && step === 0 && this.harmony && this.currentProgression.length > 0) {
      const chord = this.currentProgression[this.chordIdx % this.currentProgression.length];
      this.chordIdx++;
      if (chord) {
        const voicing: ChordVoicing = this.harmony.voiceLead(chord);
        // Track the current chord so the bass + lead can harmonize with it.
        this.currentChord = chord;
        // Trigger one pad voice per note in the voicing.
        // Bass voice (lowest) gets slightly higher velocity; upper voices get
        // a small staggered timing offset (5ms per voice) to avoid phase
        // cancellation between detuned supersaw oscillators.
        const noteCount = voicing.notes.length;
        for (let i = 0; i < noteCount; i++) {
          const note = voicing.notes[i];
          // Bass voice (i === 0) carries more weight; upper voices are softer
          // to leave headroom for the lead. Velocity scales with energy so
          // drops push the harmony harder than builds.
          const isBass = i === 0;
          const vel = isBass
            ? 0.20 + energy * 0.14
            : 0.10 + energy * 0.08 - (i - 1) * 0.01;  // taper upper voices
          const t = isBass ? stepTime : stepTime + 0.005 * i;
          this.triggerSynth(6, t, note, Math.max(0.05, vel), sd * 4, undefined, padTimbre);
        }
      }
    }

    // ── ARP (track 7) — world-driven arpPattern OR call-response (Task M1) ──
    // In VARIATION sections, the arp plays a "response" counter-melody to the
    // lead's "call" — descending, ending on a stable tone, an octave above
    // the lead. In all other sections, the arp plays its world-driven pattern.
    const arpProb = clamp(0.7 * energy, 0, 1);
    const isVariation = section.label === 'VARIATION';
    if (section.lead && step % 2 === 0 && this.musicRng?.chance(arpProb)) {
      if (isVariation && this.melody) {
        // Call-response: arp plays the response to the lead's call.
        // If no response event is scheduled for this step, the arp is silent —
        // this creates natural breathing space between call and response.
        const resp = this.melody.nextResponseNote(step, bar, energy);
        if (resp) {
          this.triggerSynth(7, stepTime, resp.note, resp.velocity, sd, sd * resp.duration, arpTimbre);
        }
      } else {
        // Default: world-driven arp pattern.
        const arp = w.arpPattern || [0,2,4,7,4,2,0,7];
        const arpStep = Math.floor(step / 2) % arp.length;
        const deg = arp[arpStep];
        const note = scaleNote(root + 24, sc, deg);
        this.triggerSynth(7, stepTime, note, 0.25 * energy, sd, undefined, arpTimbre);
      }
    }

    // ── SHAKER (track 3 alt) — continuous offbeat in drops ──
    const shakerProb = clamp(0.4 * energy * tScale, 0, 1);
    if (section.bass && section.lead && step % 2 === 1 && this.musicRng?.chance(shakerProb)) {
      this.triggerDrum(3, stepTime, 0.15 + tVelBoost);
    }
  }

  private triggerDrum(trackIdx: number, time: number, vel: number, decayOverride?: number): void {
    const track = this.tracks[trackIdx];
    if (track.mix.mute) return;
    const preset = DRUM_PRESETS[track.presetId];
    if (!preset) return;
    const voice = this.drumPool[this.drumIdx];
    this.drumIdx = (this.drumIdx + 1) % this.drumPool.length;

    // Reference pursuit — KICK DECAY: blend preset decay with refKickDecay.
    // The kick dur formula is `dur = 0.12 + 0.5 * decay`, so to hit a target
    // seconds T the equivalent decay param is `(T - 0.12) / 0.5`. We blend
    // 50/50 with the preset decay so the kick keeps its tonal character but
    // adopts the reference's tail length.
    let effectiveDecayOverride = decayOverride;
    if (trackIdx === 0 && this.refKickDecay > 0) {
      const targetDur = clamp(this.refKickDecay, 0.05, 0.8);
      const refDecayParam = clamp((targetDur - 0.12) / 0.5, 0.05, 4.0);
      const blended = preset.decay * 0.5 + refDecayParam * 0.5;
      effectiveDecayOverride = (isFinite(blended) && blended > 0) ? blended : undefined;
    }
    // Learned kick decay (from ContinuousTrainer offline optimization) — blend 25%
    // on top of the reference-pursued decay. This lets the trainer nudge the kick
    // tail toward an optimized value without fighting the live reference pursuit.
    if (trackIdx === 0 && this.learned.kickDecay && effectiveDecayOverride !== undefined) {
      const learnedDur = clamp(this.learned.kickDecay, 0.05, 0.8);
      const learnedParam = clamp((learnedDur - 0.12) / 0.5, 0.05, 4.0);
      const blended = effectiveDecayOverride * 0.75 + learnedParam * 0.25;
      effectiveDecayOverride = (isFinite(blended) && blended > 0) ? blended : effectiveDecayOverride;
    }

    voice.hit(preset, time, vel * track.mix.vol, this.chains[trackIdx], effectiveDecayOverride);

    // Sidechain: when kick fires, duck the bass
    if (trackIdx === 0 && this.duckGain && this.ctx) {
      this.duckGain.gain.cancelScheduledValues(time);
      // Blend learned duck depth (from trainer) with the default 0.4 — trainer
      // can push the sidechain deeper (up to 0.7) or shallower for groove control.
      const duckDepth = this.learned.duck !== undefined
        ? clamp(0.4 * 0.6 + this.learned.duck * 0.7 * 0.4, 0.15, 0.7)
        : 0.4;
      this.duckGain.gain.setValueAtTime(1 - duckDepth, time);
      this.duckGain.gain.linearRampToValueAtTime(1.0, time + 0.25); // 250ms recovery
    }
  }

  private triggerRiser(time: number, dur: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    // Noise through filter that opens up
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(200, time);
    filter.frequency.exponentialRampToValueAtTime(8000, time + dur);
    filter.Q.value = 2;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.3, time + dur);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur + 0.1);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    noise.start(time);
    noise.stop(time + dur + 0.2);
  }

  private triggerImpact(time: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    // Sub boom + noise crack
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(35, time + 0.5);
    const og = c.createGain();
    og.gain.setValueAtTime(0.8, time);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
    osc.connect(og);
    og.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.7);

    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.4, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(this.master);
    noise.start(time);
    noise.stop(time + 0.1);
  }

  private triggerSynth(
    trackIdx: number,
    time: number,
    midi: number,
    vel: number,
    stepDur: number,
    dur?: number,
    timbre?: { cutoff?: number; res?: number; drive?: number }
  ): void {
    const track = this.tracks[trackIdx];
    if (track.mix.mute) return;
    // Lookup via getAdvancedSynthPreset so ADVANCED_PRESETS (FM/supersaw/wavetable)
    // are returned with their `mode` field set, and legacy SYNTH_PRESETS are
    // wrapped with mode='classic' for backwards compatibility.
    const basePreset = getAdvancedSynthPreset(track.presetId, SYNTH_PRESETS);
    if (!basePreset) return;
    const voice = this.synthPool[this.synthIdx];
    this.synthIdx = (this.synthIdx + 1) % this.synthPool.length;

    // ── Apply world timbre overrides on top of the factory preset ──
    let preset: AdvancedSynthPreset = basePreset;
    if (timbre) {
      preset = {
        ...basePreset,
        cutoff: timbre.cutoff !== undefined ? clamp(timbre.cutoff, 60, 16000) : basePreset.cutoff,
        res: timbre.res !== undefined ? clamp(timbre.res, 0.2, 24) : basePreset.res,
      };
    }

    let p: AdvancedSynthPreset = dur ? { ...preset, gate: dur / (stepDur * 2) } : preset;

    // ── Task S1: synth mode overrides (reference pursuit can switch modes) ──
    // If a per-track override is set, replace the preset's mode and fill in
    // sensible defaults for any mode-specific params that aren't already set.
    const overrideMode = this.synthModeOverrides[trackIdx];
    if (overrideMode && overrideMode !== p.mode) {
      p = { ...p, mode: overrideMode };
      // Provide defaults for the new mode so the AdvancedSynthVoice has values
      // to work with. These are only applied if the preset didn't already set
      // them (so a world's pad preset won't have its sawCount clobbered when
      // the pursuit flips it to supersaw, for example — but a classic bass
      // preset flipped to FM needs fmRatio/fmDepth/fmEnvAmount filled in).
      if (overrideMode === 'fm') {
        if (p.fmRatio === undefined) p.fmRatio = 2;
        if (p.fmDepth === undefined) p.fmDepth = 4;
        if (p.fmEnvAmount === undefined) p.fmEnvAmount = 0.6;
      } else if (overrideMode === 'supersaw') {
        if (p.sawCount === undefined) p.sawCount = 5;
        if (p.sawDetune === undefined) p.sawDetune = 12;
        if (p.sawSpread === undefined) p.sawSpread = 0.5;
      } else if (overrideMode === 'wavetable') {
        if (p.wtPosition === undefined) p.wtPosition = 0.5;
        if (p.wtMorphRate === undefined) p.wtMorphRate = 0.3;
      }
    }

    // ── Task S1: real-time modulation overrides (setFMDepth / setWavetablePosition) ──
    // Applied on top of the preset's mode-specific params so the reference
    // pursuit can dynamically tune FM depth or wavetable position to match the
    // radio's timbre without changing the world's preset selection.
    if (this.fmDepthOverride > 0 && p.mode === 'fm') {
      p = { ...p, fmDepth: this.fmDepthOverride };
    }
    if (this.wtPositionOverride >= 0 && p.mode === 'wavetable') {
      p = { ...p, wtPosition: this.wtPositionOverride };
    }

    // Reference pursuit — SPECTRAL CENTROID matching for lead (5) and pad (6).
    // Applied on top of the world timbre so radio brightness nudges the world cutoff.
    if ((trackIdx === 5 || trackIdx === 6) && this.refSpectralCentroid > 0) {
      const targetCut = centroidToCutoff(this.refSpectralCentroid);
      const blended = preset.cutoff * 0.6 + targetCut * 0.4;
      if (isFinite(blended) && blended > 60) {
        p = { ...p, cutoff: clamp(blended, 200, 12000) };
      }
    }

    // Reference pursuit — BASS DECAY matching for bass (4).
    if (trackIdx === 4 && this.refBassDecay > 0) {
      const desiredGate = clamp(this.refBassDecay / Math.max(stepDur * 2, 0.01), 0.05, 2.5);
      const blended = preset.gate * 0.7 + desiredGate * 0.3;
      if (isFinite(blended) && blended > 0) {
        p = { ...p, gate: clamp(blended, 0.05, 2.5) };
      }
    }

    // ── Learned params from ContinuousTrainer (Task 22) ──
    //    Blend 30% learned cutoff on top of world + reference pursuit.
    //    This lets the offline optimizer steer timbre toward an accepted
    //    configuration without overriding the live reference pursuit.
    if (trackIdx === 4 && this.learned.bassCutoff) {
      const blended = p.cutoff * 0.7 + this.learned.bassCutoff * 0.3;
      if (isFinite(blended) && blended > 40) p = { ...p, cutoff: clamp(blended, 60, 4000) };
    }
    if (trackIdx === 5 && this.learned.leadCutoff) {
      const blended = p.cutoff * 0.7 + this.learned.leadCutoff * 0.3;
      if (isFinite(blended) && blended > 100) p = { ...p, cutoff: clamp(blended, 200, 16000) };
    }
    if (trackIdx === 6 && this.learned.padCutoff) {
      const blended = p.cutoff * 0.7 + this.learned.padCutoff * 0.3;
      if (isFinite(blended) && blended > 80) p = { ...p, cutoff: clamp(blended, 150, 12000) };
    }
    // Learned lead detune — nudge the osc2 detune toward the optimized value.
    if (trackIdx === 5 && this.learned.leadDetune !== undefined) {
      const blended = (p.detune || 0) * 0.7 + this.learned.leadDetune * 0.3;
      if (isFinite(blended) && blended >= 0) p = { ...p, detune: clamp(blended, 0, 50) };
    }

    // Drive scales the voice velocity (per-voice drive isn't a SynthPreset field)
    const driveBoost = timbre?.drive ? clamp(timbre.drive / 1.5, 0.5, 1.8) : 1;
    voice.noteOn(p, time, midi, vel * track.mix.vol * driveBoost, stepDur, this.chains[trackIdx]);

    // Add sub oscillator for bass track (sine one octave below)
    if (trackIdx === 4 && this.ctx) {
      const subFreq = mtof(midi - 12); // one octave below
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.value = subFreq;
      // When chasing ref bass decay, lengthen the sub-osc tail to match.
      const baseDur = dur || stepDur * 0.3;
      const subDecay = (this.refBassDecay > 0)
        ? clamp(baseDur * 0.5 + this.refBassDecay * 0.5, 0.05, 1.5)
        : baseDur + 0.05;
      subGain.gain.setValueAtTime(0.5 * track.mix.vol * driveBoost, time);
      subGain.gain.exponentialRampToValueAtTime(0.001, time + subDecay);
      subOsc.connect(subGain);
      subGain.connect(this.chains[4]);
      subOsc.start(time);
      subOsc.stop(time + subDecay + 0.02);
    }
  }

  // ─── Task S1: Advanced synthesis control surface ──────────────────────────
  //
  // These methods let the reference pursuit (or any external controller) steer
  // the AdvancedSynthVoice's mode and parameters in real time without restarting
  // the engine or changing the world's preset selection:
  //
  //   setSynthMode(trackIdx, mode)   — override a track's synthesis mode
  //   setFMDepth(depth)              — real-time FM depth modulation (0-8)
  //   setWavetablePosition(pos)      — real-time wavetable position (0-1)
  //
  // All overrides are applied in triggerSynth() on top of the preset's values.
  // To clear an override, pass the no-op sentinel (null for setSynthMode,
  // 0 for setFMDepth, -1 for setWavetablePosition).

  /**
   * Override the synthesis mode for a specific track. The override takes
   * effect on the next noteOn for that track. Pass `null` to clear the
   * override and revert to the world/preset's default mode.
   *
   * Use cases:
   *   - Reference pursuit detects metallic FM content in the radio →
   *     `setSynthMode(5, 'fm')` to flip leads to FM synthesis.
   *   - Reference pursuit detects rich saw content →
   *     `setSynthMode(5, 'supersaw')` for anthemic leads.
   *   - Reference pursuit detects evolving textures →
   *     `setSynthMode(6, 'wavetable')` for morphing pads.
   */
  setSynthMode(trackIdx: number, mode: SynthMode | null): void {
    if (trackIdx < 0 || trackIdx >= this.tracks.length) return;
    if (mode === null) {
      delete this.synthModeOverrides[trackIdx];
    } else {
      this.synthModeOverrides[trackIdx] = mode;
    }
  }

  /**
   * Real-time FM depth modulation. Applied on top of any FM preset's fmDepth
   * for all tracks currently in FM mode. Range 0-8 (0 = no modulation,
   * 4 = typical, 8 = extreme metallic). Pass 0 to disable the override.
   *
   * The reference pursuit can call this to match the radio's FM brightness:
   * brighter/more metallic → higher depth, softer/darker → lower depth.
   */
  setFMDepth(depth: number): void {
    const d = typeof depth === 'number' && isFinite(depth) ? depth : 0;
    this.fmDepthOverride = clamp(d, 0, 8);
  }

  /**
   * Real-time wavetable position modulation. Applied on top of any wavetable
   * preset's wtPosition for all tracks currently in wavetable mode. Range 0-1
   * (0 = wave A, 1 = wave B). Pass -1 to disable the override.
   *
   * The reference pursuit can call this to match the radio's spectral character:
   * darker → lower position (sine/warm), brighter → higher position (saw/bright).
   */
  setWavetablePosition(pos: number): void {
    const p = typeof pos === 'number' && isFinite(pos) ? pos : -1;
    this.wtPositionOverride = clamp(p, -1, 1);
  }

  /**
   * Snapshot of the current synth-mode overrides for UI display.
   * Returns a map of trackIdx → SynthMode for tracks with active overrides.
   */
  getSynthModeOverrides(): Record<number, SynthMode> {
    const result: Record<number, SynthMode> = {};
    for (const k of Object.keys(this.synthModeOverrides) as unknown as string[]) {
      const idx = Number(k);
      const mode = this.synthModeOverrides[idx];
      if (mode !== undefined) result[idx] = mode;
    }
    return result;
  }

  /**
   * Snapshot of reference pursuit state for UI display. Each entry pairs the
   * radio target with our current actual so the UI can render a delta.
   * Values are zero when no reference data has arrived yet.
   */
  getPursuitStatus(): {
    kickDecay: { target: number; actual: number };
    centroid: { target: number; actual: number };
    transientDensity: { target: number; actual: number };
    bpm: { target: number; actual: number };
    key: { root: number; scale: string };
  } {
    // Actual kick decay = current kick preset's dur, blended with ref if pursuing.
    let actualKickDur = 0;
    const kickPreset = DRUM_PRESETS[this.tracks[0]?.presetId ?? ''];
    if (kickPreset) {
      const presetDur = 0.12 + 0.5 * (kickPreset.decay || 1);
      if (this.refKickDecay > 0) {
        const refDecayParam = clamp((this.refKickDecay - 0.12) / 0.5, 0.05, 4.0);
        const blendedDecay = kickPreset.decay * 0.5 + refDecayParam * 0.5;
        actualKickDur = 0.12 + 0.5 * blendedDecay;
      } else {
        actualKickDur = presetDur;
      }
    }
    return {
      kickDecay: { target: this.refKickDecay, actual: actualKickDur },
      centroid: { target: this.refSpectralCentroid, actual: this.ownSpectralCentroid },
      transientDensity: { target: this.refTransientDensity, actual: this.ownTransientDensity },
      bpm: { target: this.targetBpm || this._bpm, actual: this._bpm },
      key: { root: this.musicalKey.root, scale: this.musicalKey.scale },
    };
  }

  getMusicalKey(): { root: number; scale: string } { return this.musicalKey; }
  getOwnLufs(): number { return this.ownLufs; }

  /**
   * Task T1: return the latest detected synthesis character (or null if the
   * detector hasn't run yet — i.e., no reference features with harmonic
   * content have arrived). This is what the UI dashboard reads to show
   * "FM 78%" / "Supersaw 64%" badges.
   *
   * The returned object is a snapshot — it reflects the most recent
   * detectSynthesisCharacter() call, regardless of whether we actually
   * applied the mode (low-confidence results are still exposed for
   * diagnostic display, but the engine leaves the preset selection alone).
   */
  getSynthesisCharacter(): SynthesisCharacter | null {
    return this.detectedSynthesisCharacter;
  }

  /**
   * Task T1: complete pursuit dashboard for UI display. Combines the existing
   * getPursuitStatus() data (kick decay, centroid, transient density, BPM,
   * key) with the new harmonic-content / transient-shape / stereo-field /
   * synthesis / effects snapshots.
   *
   * Every field is paired (target vs. actual) where it makes sense. Fields
   * that don't have a measured "actual" yet (e.g., the new stereo-field
   * metrics — we don't currently self-analyze those) are returned as the
   * reference value alone, so the UI can still render "what we're hearing"
   * even before the engine has fully responded.
   */
  getPursuitDashboard(): {
    // ── Existing pursuit targets (kept identical to getPursuitStatus) ──
    kickDecay: { target: number; actual: number };
    centroid: { target: number; actual: number };
    transientDensity: { target: number; actual: number };
    bpm: { target: number; actual: number };
    key: { root: number; scale: string };
    // ── Task T1: harmonic content ──
    harmonicContent: {
      flatness: number;
      crest: number;
      hnr: number;
      inharmonicity: number;
      slope: number;
    };
    // ── Task T1: transient shape ──
    transientShape: {
      sharpness: number;
      decay: number;
    };
    // ── Task T1: stereo field ──
    stereoField: {
      width: number;
      balance: number;
      correlation: number;
      msRatio: number;
    };
    // ── Task T1: synthesis character ──
    synthesis: {
      mode: string;
      confidence: number;
      fmDepth: number;
      sawSpread: number;
      wtPosition: number;
    };
    // ── Task T1: per-track effects sends (current values, 0..1) ──
    effects: {
      reverbSend: number[];     // per-track reverb send
      delaySend: number[];      // per-track delay send
      chorusSend: number[];     // per-track chorus send
      phaserSend: number[];     // per-track phaser send
      distortionSend: number[]; // per-track distortion send
    };
  } {
    // ── Existing pursuit status (compute once, reuse) ──
    const status = this.getPursuitStatus();

    // ── Per-track effect-send snapshot ──
    // We read each rack's current send gain. The rack exposes the GainNode
    // directly (sendReverb, sendDelay, etc.) so we can read .gain.value.
    const reverbSend: number[] = [];
    const delaySend: number[] = [];
    const chorusSend: number[] = [];
    const phaserSend: number[] = [];
    const distortionSend: number[] = [];
    for (let i = 0; i < this.racks.length; i++) {
      const rack = this.racks[i];
      reverbSend.push(rack ? rack.sendReverb.gain.value : 0);
      delaySend.push(rack ? rack.sendDelay.gain.value : 0);
      chorusSend.push(rack ? rack.sendChorus.gain.value : 0);
      phaserSend.push(rack ? rack.sendPhaser.gain.value : 0);
      distortionSend.push(rack ? rack.sendDistortion.gain.value : 0);
    }

    const synth = this.detectedSynthesisCharacter;
    return {
      kickDecay: status.kickDecay,
      centroid: status.centroid,
      transientDensity: status.transientDensity,
      bpm: status.bpm,
      key: status.key,
      harmonicContent: {
        flatness: this.refSpectralFlatness,
        crest: this.refSpectralCrest,
        hnr: this.refHnr,
        inharmonicity: this.refInharmonicity,
        slope: this.refSpectralSlopeDb,
      },
      transientShape: {
        sharpness: this.refTransientSharpness,
        decay: this.refTransientDecayMs,
      },
      stereoField: {
        width: this.refStereoWidth,
        balance: this.refStereoBalance,
        correlation: this.refStereoCorrelation,
        msRatio: this.refMsRatio,
      },
      synthesis: synth
        ? {
            mode: synth.mode,
            confidence: synth.confidence,
            fmDepth: synth.fmDepth,
            sawSpread: synth.sawSpread,
            wtPosition: synth.wtPosition,
          }
        : { mode: 'classic', confidence: 0, fmDepth: 0, sawSpread: 0, wtPosition: 0.5 },
      effects: {
        reverbSend,
        delaySend,
        chorusSend,
        phaserSend,
        distortionSend,
      },
    };
  }

  /**
   * Expose the HarmonyEngine (Task H1) so other modules (e.g. MelodyEngine for
   * counterpoint) can query the current chord, avoid notes, and chord-tone
   * membership. Returns null if the harmony engine hasn't been initialized.
   */
  getHarmony(): HarmonyEngine | null { return this.harmony; }

  /**
   * Return the current chord playing on the pad (Task H1). Useful for UI
   * display (chord name) and for the lead/arp to shape their note choices.
   * Returns null outside lead sections or before the first chord plays.
   */
  getCurrentChord(): Chord | null { return this.currentChord; }
}
