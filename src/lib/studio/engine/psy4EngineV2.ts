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
import { SchedulerWorker } from './schedulerWorker';
import { PerformanceMonitor, QualityLevel, PerformanceStatus } from './performanceMonitor';
import { FlowEngine, FlowState, SurpriseEvent } from './flowEngine';
// ── Task A1: deep A/B analysis (effects, timbre, uniqueness, router) ──
import { detectEffects, DetectedEffects } from './effectsDetector';
import {
  computeTimbreFingerprint,
  compareFingerprints,
  TimbreFingerprint,
  FingerprintComparison,
} from './timbreFingerprint';
import { detectUniqueElements, UniqueElement } from './uniquenessDetector';
import { routeSynthesis, SynthesisPlan, SynthesisAdjustment } from './synthesisRouter';
// ── Task D1: DJ-style phase sync (phase-locked beat matching + downbeat
// alignment). The PhaseSync aligns our beat grid with the radio's beat
// grid so the kick drums hit together — the DJ-software sync model. ──
import { PhaseSync, PhaseInfo, SyncStatus } from './phaseSync';

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
    // P1: skipHaas=true — kick is mono/centered, no need for the Haas widener
    // or stereo panner. Saves 9 nodes per rack.
    {
      eqLowGain: 2.5, eqMidFreq: 350, eqMidGain: -3, eqMidQ: 1.2, eqHighGain: -1,
      compThreshold: -16, compRatio: 6, compAttack: 0.003, compRelease: 0.08, compKnee: 4,
      satDrive: 1.4, satMix: 0.35,
      pan: 0, useHaas: false, haasDelayMs: 0, haasMix: 0,
      outputGain: 1.0,
      sendReverb: 0, sendDelay: 0, sendChorus: 0, sendPhaser: 0, sendDistortion: 0, sendBitcrush: 0,
      skipHaas: true,
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
    // P1: skipHaas=true — bass is mono/centered, no need for the Haas widener
    // or stereo panner. Saves 9 nodes per rack.
    {
      eqLowGain: 2.5, eqMidFreq: 280, eqMidGain: -2, eqMidQ: 1.1, eqHighGain: -1.5,
      compThreshold: -14, compRatio: 3, compAttack: 0.015, compRelease: 0.15, compKnee: 12,
      satDrive: 1.6, satMix: 0.4,
      pan: 0, useHaas: false, haasDelayMs: 0, haasMix: 0,
      outputGain: 1.2,
      sendReverb: 0.06, sendDelay: 0, sendChorus: 0, sendPhaser: 0, sendDistortion: 0, sendBitcrush: 0,
      skipHaas: true,
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

// ─── Arrangement section type (Task V2b: section-based effects automation) ──
//
// Each entry in the `arrangement` array describes a section of the song:
//   - bars:     section length in bars
//   - density:  0..1 — drives energy / velocity / hat+perc probability
//   - bass:     whether the bass track is active in this section
//   - lead:     whether the lead+pad+arp tracks are active in this section
//   - label:    human-readable name (INTRO / GROOVE / BUILD / DROP / ...)
//
// Task V2b's `applySectionAutomation(section, bar, step)` reads this struct
// to decide which effects automation profile to apply. The same struct is
// used by `scheduleStep()` to gate tracks and by `tick()` to advance the
// arrangement when `bar >= section.bars`.
export interface ArrangementSection {
  bars: number;
  density: number;
  bass: boolean;
  lead: boolean;
  label: string;
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

  // ── Task A1: deep A/B analysis state ──
  // The expanded A/B comparison stores the latest detector outputs so the UI
  // can render them via getDeepAnalysis(). All of these update on every
  // liveTrack() call, but the actual SYNTHESIS ROUTING is only applied when
  // the deep pursuit cooldown has elapsed (10s) — this prevents thrashing
  // when the detectors wobble on borderline material.
  private refEffects: DetectedEffects | null = null;
  private refTimbre: TimbreFingerprint | null = null;
  private currentTimbre: TimbreFingerprint | null = null;
  private timbreComparison: FingerprintComparison | null = null;
  private uniqueElements: UniqueElement[] = [];
  private synthPlan: SynthesisPlan | null = null;
  private refFeaturesHistory: RefFeatures[] = [];
  private static readonly REF_HISTORY_MAX = 12; // ~2 minutes at 10s hop
  private lastDeepPursuitTime = 0;
  private static readonly DEEP_PURSUIT_COOLDOWN_MS = 10_000;
  private static readonly DEEP_PURSUIT_CONFIDENCE_THRESHOLD = 0.3;


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
  // P1: reduced from 20 → 8 synth voices and 24 → 10 drum voices.
  // Psytrance rarely has >6 simultaneous synth notes; the 7th/8th voices
  // are for overlap during note transitions. Drum voice count of 10 covers
  // kick + snare + 2 hats + 2 perc + 2 claps + 2 spare with voice stealing.
  // Combined with lazy voice allocation (AdvancedSynthVoice), idle synth
  // pool is 8 voices × 8 common nodes = 64 nodes (was 580).
  private synthPool: AdvancedSynthVoice[] = [];
  private drumPool: PooledDrumVoice[] = [];
  private synthIdx = 0;
  private drumIdx = 0;

  // ── P1: adaptive quality (Task P1) ──
  // PerformanceMonitor watches main-thread frame time + engine tick duration
  // and escalates / de-escalates the quality level on a 3s/10s hysteresis.
  // Quality level controls: supersaw osc cap, send-effect availability,
  // multiband compressor bypass, and Haas widener engagement.
  private perfMonitor: PerformanceMonitor = new PerformanceMonitor({
    onQualityChange: (q, reason) => this.onAdaptiveQualityChange(q, reason),
  });
  private quality: QualityLevel = 'medium';
  // Supersaw osc cap — clamped per-note in triggerSynth. 'low'=3, 'medium'=4,
  // 'high'=7 (full). Lowering this on weak devices keeps supersaw's character
  // (detuned saws panned across the field) while cutting CPU.
  private maxSupersawOsc = 7;
  // Track the multiband's last-set ratios so we can restore them when quality
  // escalates back to 'medium' / 'high' without re-reading the world config.
  private multibandLowRatio = 4;
  private multibandMidRatio = 3;
  private multibandHighRatio = 2;

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
  // ── Task V2a: Worker-based scheduler (replaces main-thread setTimeout) ──
  // The SchedulerWorker posts `{type:'tick'}` messages from a separate thread,
  // so main-thread GC/React renders don't jitter the 15ms musical clock. If
  // Worker is unavailable (SSR / old browser), the wrapper falls back to a
  // main-thread setInterval automatically. The `timer` field is kept as a
  // last-resort fallback path for environments where neither Worker nor
  // setInterval-with-onTick is desired — currently unused.
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduler: SchedulerWorker = new SchedulerWorker();
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
  private arrangement: ArrangementSection[] = [
    { bars: 4, density: 0.3, bass: false, lead: false, label: 'INTRO' },
    { bars: 4, density: 0.5, bass: true, lead: false, label: 'GROOVE' },
    { bars: 4, density: 0.7, bass: true, lead: false, label: 'BUILD' },
    { bars: 8, density: 0.9, bass: true, lead: true, label: 'DROP' },
    { bars: 4, density: 0.7, bass: true, lead: true, label: 'VARIATION' },
    { bars: 4, density: 0.3, bass: false, lead: false, label: 'BREAK' },
    { bars: 8, density: 1.0, bass: true, lead: true, label: 'FINAL DROP' },
    { bars: 4, density: 0.3, bass: true, lead: false, label: 'OUTRO' },
  ];

  // ── Task V2b: section-based effects automation state ──
  // Per-section automation profiles are applied through setSendLevel /
  // setTrackEffect (which both use setTargetAtTime inside the rack for
  // smooth, click-free ramps). The `lastAutomationSection` field tracks
  // which section we last applied static levels for — so we only re-push
  // the static send levels when the section changes (not every step).
  // The `leadCutoffOverride` field is the live lead filter cutoff used by
  // the BUILD-section filter sweep; -1 means "no override" (use the world
  // timbre + reference pursuit blend as before).
  private lastAutomationSection = '';
  private leadCutoffOverride = -1;

  // ── Task F1: dynamic flow engine (replaces the fixed `arrangement` array) ──
  // The FlowEngine decides WHEN to transition (based on radio energy, time
  // since last transition, musical logic, and the world's flow profile) and
  // WHAT to transition to (archetype + section length). It also produces
  // continuous automation parameters (filterCutoff, reverbAmount, delayAmount,
  // tension, surprise) that replace the old static section-based automation.
  //
  // `currentFlow` is the latest FlowState returned by flowEngine.tick() —
  // scheduleStep reads it instead of `arrangement[sectionIdx]`.
  // `totalBars` is the absolute bar counter (never resets) — the flow engine
  // uses it to track time-since-transition and schedule surprise events.
  // `lastRefEnergyForFlow` tracks the last radio energy value pushed to the
  // flow engine so we can detect significant shifts (>0.15 delta) and call
  // onReferenceEnergyChange() — this is how the flow engine "listens" to the
  // radio and follows its energy curve.
  // `activeSurprise` is the currently-active surprise event (or null). It's
  // popped from the flow engine in tick() and applied per-step in
  // applyFlowAutomation() (e.g., keep tracks muted during a dropOut, keep
  // the filter swept during a filterSweep).
  // `surpriseReverseHitScheduled` guards the reverseHit one-shot so it fires
  // exactly once per surprise (not every step while the surprise is active).
  private flowEngine: FlowEngine | null = null;
  private currentFlow: FlowState | null = null;
  private totalBars = 0;
  private lastRefEnergyForFlow = 0;
  private activeSurprise: SurpriseEvent | null = null;
  private surpriseReverseHitScheduled = false;

  // ── Task D1: DJ-style phase sync ──
  // The PhaseSync aligns our beat grid with the radio's beat grid so the
  // kick drums hit together. It is OPTIONAL — when syncEnabled is false,
  // getPhaseOffset() returns 0 and tickBar() returns no nudges. The engine
  // still works exactly as before (BPM tracking via applyMusicalUnderstanding).
  //
  // `pendingBeatDropOffsetSec` is the signed time-jump the engine should
  // apply to nextTime when a beat-drop is queued by PhaseSync.tickBar().
  // We store it on the engine because the bar boundary arrives in tick()
  // and we apply it to nextTime there (before the next scheduleStep call).
  // `phaseOffsetEnabled` mirrors phaseSync.isSyncEnabled() so the engine
  // can short-circuit the per-step offset fetch when sync is off.
  private phaseSync: PhaseSync = new PhaseSync();
  private pendingBeatDropOffsetSec = 0;

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

    // Allocate voice pools (P1: 8 synth + 10 drum — down from 20 + 24).
    // Each AdvancedSynthVoice now lazy-allocates only its 8 common nodes on
    // construction; per-osc nodes are added on noteOn and torn down on
    // release-tail-end. With 8 voices × 8 common = 64 idle nodes (was 580).
    // 10 drum voices × ~8 nodes = 80 nodes; with voice stealing this covers
    // the busiest psytrance patterns.
    for (let i = 0; i < 8; i++) this.synthPool.push(new AdvancedSynthVoice(c, i));
    for (let i = 0; i < 10; i++) this.drumPool.push(new PooledDrumVoice(c, this.noiseBuffer));

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
    // ── Task F1: create the dynamic flow engine ──
    // Replaces the fixed `arrangement` array with a creative, radio-responsive
    // flow. The engine decides when to transition (based on radio energy, time
    // since last transition, musical logic, and the world's flow profile) and
    // produces continuous automation parameters (filterCutoff, reverbAmount,
    // delayAmount, tension, surprise) that replace the old static section-based
    // automation.
    //
    // The seed combines the world id hash, key root, and scale length so each
    // world+key combo produces a different but reproducible flow. A fresh seed
    // on every start() means each play-through takes a different path through
    // the archetype graph (more creative, less formulaic).
    this.totalBars = 0;
    this.lastRefEnergyForFlow = 0;
    this.activeSurprise = null;
    this.surpriseReverseHitScheduled = false;
    const flowSeed = ((Date.now() & 0xffff) ^ (this.currentWorld.id.length * 131) ^
                      (this.musicalKey.root * 17) ^ (this.musicalKey.scale.length * 7) ^ 0x5a5a) >>> 0;
    this.flowEngine = new FlowEngine(new SeededRng(flowSeed || 1));
    this.flowEngine.setWorld(this.currentWorld);
    this.currentFlow = this.flowEngine.getCurrent();
    this.currentSection = this.currentFlow.label;
    // Task V2b: reset section-automation state so the first section's static
    // levels get pushed on the first tick. Also clear any leftover lead
    // cutoff override from a previous session so the lead starts clean.
    this.lastAutomationSection = '';
    this.leadCutoffOverride = -1;
    this.onSectionChange?.(this.currentSection);
    this.nextTime = this.ctx!.currentTime + 0.03;
    this.scheduleNextTick();
  }

  stop(): void {
    this.playing = false;
    // Task V2a: stop the Worker-based scheduler. The SchedulerWorker keeps
    // the underlying Worker instance alive across stop/start cycles (cheap
    // restart) — it just stops posting ticks. We also clear the legacy
    // `timer` field for the (currently unused) setTimeout fallback path.
    this.scheduler.stop();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.ctx) {
      for (const v of this.synthPool) v.panic(this.ctx);
      for (const v of this.drumPool) v.panic(this.ctx);
    }
    // ── Task D1: reset PhaseSync own-beat state ──
    // The reference phase + syncEnabled flag are preserved (the radio is
    // still playing and the user's toggle choice persists across restarts).
    // We only clear the own-beat ring buffer + phase offsets + beat-drop
    // state — these are engine-instance-specific and would be stale after
    // a restart (the new engine instance has a different audio context).
    this.phaseSync.reset();
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

    // ── Task F1: update the flow engine's world profile ──
    // The new world's flow characteristics (baseline energy, section length
    // range, archetype weights, surprise rate) take effect on the NEXT
    // transition. We DON'T force a transition here — the music keeps flowing
    // organically and the new world's character shapes the next section
    // change. This avoids jarring mid-section character shifts while still
    // adapting the flow to the new world's identity.
    if (this.flowEngine) {
      this.flowEngine.setWorld(newWorld);
    }
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
   *
   * Task V2b addition: 'cutoff' is special-cased for the LEAD track (idx 5).
   * The lead's filter cutoff lives inside the AdvancedSynthVoice (not the
   * rack — the rack is post-voice). So we store the override here and apply
   * it in triggerSynth() when the lead's voice is about to fire. Pass -1
   * to clear the override (revert to world timbre + reference pursuit blend).
   * Any non-negative value (Hz) is clamped to [200, 16000] and used directly.
   */
  setTrackEffect(trackIdx: number, effectName: string, value: number): void {
    if (!Number.isFinite(value)) return;
    // Task V2b: lead filter cutoff override (for BUILD-section filter sweeps).
    // Stored on the engine; applied in triggerSynth() when the lead fires.
    if (effectName === 'cutoff') {
      if (trackIdx !== 5) return; // only LEAD has a sweepable filter override
      this.leadCutoffOverride = value < 0 ? -1 : clamp(value, 200, 16000);
      return;
    }
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

  // ─── Task F1: continuous flow automation (replaces V2b section automation) ──
  //
  // Commercial psytrance rides the mix alongside the arrangement: reverb
  // washes out in breaks, sucks dry in drops, delay throws in transitions,
  // filter sweeps open in builds, chorus thickens in the variation.
  //
  // The V2b approach pushed STATIC send levels on section changes — a DROP
  // and a BREAK had different reverb tails, but within a section the mix was
  // flat. Task F1 replaces this with CONTINUOUS automation: the flow engine
  // produces smooth filterCutoff / reverbAmount / delayAmount / tension /
  // surprise values every bar (interpolated toward the archetype target with
  // a 1-4 bar time constant), and applyFlowAutomation() pushes them every
  // step via setTrackEffect / setSendLevel (both use setTargetAtTime
  // internally, so re-pushing is a smooth no-op once settled).
  //
  // This means:
  //   - The lead filter OPENS continuously during a BUILD (tension rising →
  //     cutoff rising) instead of jumping at the section boundary.
  //   - The reverb wash CONTINUOUSLY recedes during a DROP approach (energy
  //     rising → reverb falling) instead of snapping dry at the drop start.
  //   - The delay amount RISES at the end of a VARIATION phrase (tension
  //     releasing → delay rising for echo throws) instead of being a flat
  //     0.40 throughout.
  //
  // Layered on top:
  //   - Per-section chorus/phaser profile (kept from V2b — these are timbral
  //     colors that don't benefit from continuous automation).
  //   - Active surprise event effects (dropOut mute, filterSweep progression,
  //     echoThrow delay boost, silence) — applied per-step.
  //
  // Tracks: 0=KICK 1=SNARE 2=HATS 3=PERC 4=BASS 5=LEAD 6=PAD 7=ARP.
  applyFlowAutomation(flow: FlowState, bar: number, step: number, time: number): void {
    if (!this.ctx) return;

    // ── (1) Per-section chorus/phaser profile (pushed on label change) ──
    // These are timbral colors that don't benefit from continuous automation
    // — they're either on or off for a given section type. We track the last
    // applied label to avoid spamming the audio thread (the rack uses
    // setTargetAtTime(0.05s) so re-pushing is a no-op once settled).
    if (flow.label !== this.lastAutomationSection) {
      this.lastAutomationSection = flow.label;
      this.applySectionChorusPhaser(flow.label);
    }

    // ── (2) Continuous reverb send — driven by flow.reverbAmount ──
    // The flow engine smooths reverbAmount toward the archetype target:
    //   BREAK → 0.70 (wash), DROP → 0.25 (punchy), INTRO → 0.60, etc.
    // We push it to all melodic (5/6/7) and atmos (1/2/3) tracks. Kick (0)
    // and bass (4) stay at their world defaults — they need to stay punchy.
    const melReverb = clamp(flow.reverbAmount, 0, 0.8);
    const atmoReverb = clamp(flow.reverbAmount * 0.7, 0, 0.6);
    for (const ti of [5, 6, 7]) {
      this.setSendLevel(ti, 'reverb', melReverb);
    }
    for (const ti of [1, 2, 3]) {
      this.setSendLevel(ti, 'reverb', atmoReverb);
    }

    // ── (3) Continuous delay send — driven by flow.delayAmount ──
    // The flow engine smooths delayAmount: VARIATION → 0.45 (echo throws),
    // BREAK → 0.50, DROP → 0.30, INTRO → 0.10. Same track routing as reverb.
    const melDelay = clamp(flow.delayAmount, 0, 0.6);
    const atmoDelay = clamp(flow.delayAmount * 0.5, 0, 0.4);
    for (const ti of [5, 6, 7]) {
      this.setSendLevel(ti, 'delay', melDelay);
    }
    for (const ti of [1, 2, 3]) {
      this.setSendLevel(ti, 'delay', atmoDelay);
    }

    // ── (4) Continuous lead filter cutoff — driven by flow.filterCutoff ──
    // The flow engine smooths filterCutoff exponentially (ears hear log-Hz):
    //   BUILD → 3500 Hz (opening), DROP → 4000 Hz (bright), BREAK → 700 Hz
    //   (closing), INTRO → 1200 Hz. This naturally produces the signature
    //   "filter opening" build effect and "filter closing" break release
    //   WITHOUT hardcoded per-section sweeps — the smoothing does the work.
    //
    // During a filterSweep surprise, we OVERRIDE this with the surprise's
    // own sweep curve (computed below in the surprise handling section).
    let leadCutoffTarget = flow.filterCutoff;

    // ── (5) Active surprise event effects ──
    // Per-step application of the active surprise (set in tick() when
    // maybeSurprise() returns an event).
    const surprise = this.activeSurprise;
    if (surprise) {
      const surpriseProgress = clamp(
        (this.totalBars - surprise.startBar) / Math.max(1, surprise.durationBars),
        0, 1,
      );
      switch (surprise.type) {
        case 'filterSweep': {
          // Open the filter wide, then close it back — a DJ-style EQ sweep.
          // Peak at mid-progress (intensity scales how wide the sweep goes).
          const peakHz = clamp(2000 + surprise.intensity * 6000, 2000, 12000);
          const baseHz = clamp(leadCutoffTarget, 400, 4000);
          // Triangle: baseHz → peakHz → baseHz
          const tri = 1 - Math.abs(surpriseProgress * 2 - 1);
          leadCutoffTarget = baseHz * Math.pow(peakHz / baseHz, tri);
          break;
        }
        case 'echoThrow': {
          // Boost the delay send + feedback for the echo throw duration.
          // The delay feedback is on this.delayFb (set at init to 0.35).
          const throwBoost = clamp(0.4 + surprise.intensity * 0.4, 0.4, 0.8);
          this.setSendLevel(5, 'delay', throwBoost);     // lead echo
          this.setSendLevel(7, 'delay', throwBoost * 0.7); // arp echo
          if (this.delayFb) {
            this.delayFb.gain.setTargetAtTime(
              clamp(0.45 + surprise.intensity * 0.3, 0.4, 0.8),
              time, 0.05,
            );
          }
          break;
        }
        case 'stutter': {
          // During a stutter, the lead retrigger is handled by the surprise
          // start handler (startSurprise) — here we just boost the delay send
          // so the stuttered notes echo.
          this.setSendLevel(5, 'delay', clamp(0.5 * surprise.intensity + 0.2, 0.2, 0.7));
          break;
        }
        case 'dropOut':
        case 'silence':
        case 'reverseHit':
          // No per-step FX change — the note gating in scheduleStep handles
          // dropOut/silence, and reverseHit is a one-shot fired in startSurprise.
          break;
      }
    } else {
      // No active surprise — relax the delay feedback back to its default.
      if (this.delayFb) {
        this.delayFb.gain.setTargetAtTime(0.35, time, 0.3);
      }
    }

    // Apply the lead cutoff target (from flow OR from a filterSweep surprise).
    // setTrackEffect(5, 'cutoff', ...) stores it in leadCutoffOverride, which
    // triggerSynth reads and applies to the AdvancedSynthVoice's filter.
    this.setTrackEffect(5, 'cutoff', clamp(leadCutoffTarget, 200, 16000));
  }

  /**
   * Push the per-section chorus/phaser profile for a given section label.
   * Extracted from the old applyStaticSectionLevels (Task V2b) — only the
   * chorus/phaser part is kept here because reverb/delay are now driven
   * continuously by flow.reverbAmount / flow.delayAmount.
   *
   * All ramps are smooth (the rack uses setTargetAtTime(0.05s) internally).
   * Layered on top of the world's per-track send levels.
   *
   * Tracks: 0=KICK 1=SNARE 2=HATS 3=PERC 4=BASS 5=LEAD 6=PAD 7=ARP.
   */
  private applySectionChorusPhaser(label: string): void {
    interface SectionProfile {
      melChorus: number; melPhaser: number;
      arpPhaser?: number;
      leadChorus?: number;
    }
    const profiles: Record<string, SectionProfile> = {
      INTRO:        { melChorus: 0.00, melPhaser: 0.00 },
      GROOVE:       { melChorus: 0.15, melPhaser: 0.10, leadChorus: 0.20 },
      BUILD:        { melChorus: 0.20, melPhaser: 0.15 },
      DROP:         { melChorus: 0.30, melPhaser: 0.20, leadChorus: 0.35, arpPhaser: 0.30 },
      VARIATION:    { melChorus: 0.25, melPhaser: 0.25, leadChorus: 0.25, arpPhaser: 0.20 },
      BREAK:        { melChorus: 0.10, melPhaser: 0.10 },
      'FINAL DROP': { melChorus: 0.32, melPhaser: 0.22, leadChorus: 0.38, arpPhaser: 0.30 },
      OUTRO:        { melChorus: 0.00, melPhaser: 0.00 },
    };
    const p = profiles[label] || profiles.GROOVE;
    for (const ti of [5, 6, 7]) {
      this.setSendLevel(ti, 'chorus', p.melChorus);
      this.setSendLevel(ti, 'phaser', p.melPhaser);
    }
    if (p.leadChorus !== undefined) {
      this.setSendLevel(5, 'chorus', p.leadChorus);
    }
    if (p.arpPhaser !== undefined) {
      this.setSendLevel(7, 'phaser', p.arpPhaser);
    }
  }

  // ─── Task F1: surprise event handlers ──────────────────────────────────────
  //
  // startSurprise() is called once when a surprise event is popped from the
  // flow engine (in tick()). It fires any one-shot effects:
  //   - reverseHit: trigger a reversed impact (build tension)
  //   - dropOut:    ramp non-kick track gains to near-zero (DJ brake)
  //   - silence:    ramp the master to near-zero (dramatic pause)
  //   - stutter:    schedule a rapid lead retrigger via the existing triggerSynth
  //   - filterSweep / echoThrow: no one-shot — handled per-step in applyFlowAutomation
  //
  // endActiveSurprise() is called when the surprise's duration has elapsed.
  // It restores any muted tracks / boosted sends to their normal levels.
  // The continuous automation in applyFlowAutomation will re-push the
  // correct values on the next step, so we just need to clear the surprise-
  // specific overrides here.

  private startSurprise(event: SurpriseEvent, time: number): void {
    if (!this.ctx) return;
    const intensity = clamp(event.intensity, 0, 1);

    switch (event.type) {
      case 'reverseHit': {
        // Fire a reversed impact — a sub-boom that swells IN instead of
        // decaying OUT. Builds tension before the next hit.
        if (!this.surpriseReverseHitScheduled) {
          this.triggerReverseImpact(time, intensity);
          this.surpriseReverseHitScheduled = true;
        }
        break;
      }
      case 'dropOut': {
        // DJ brake: ramp all non-kick track gains to near-zero over 50ms,
        // hold for the duration, then ramp back (the ramp-back happens in
        // endActiveSurprise). Kick (track 0) is NOT muted — it's the
        // heartbeat that keeps the groove alive during the brake.
        const muteDepth = clamp(1 - intensity * 0.95, 0.05, 0.5);
        for (let i = 1; i < 8; i++) {
          const g = this.trackGains[i];
          if (g) {
            g.gain.setTargetAtTime(g.gain.value * muteDepth, time, 0.02);
          }
        }
        break;
      }
      case 'silence': {
        // Dramatic pause: ramp the master to near-zero. The next section's
        // first hit (or the end-of-surprise ramp-back) will be the payoff.
        const muteDepth = clamp(1 - intensity * 0.98, 0.02, 0.3);
        this.master.gain.setTargetAtTime(this.master.gain.value * muteDepth, time, 0.015);
        break;
      }
      case 'stutter': {
        // Rapid lead retrigger — fire 4-6 short lead notes at the current
        // chord root. Uses triggerSynth directly so the notes go through
        // the full voice + rack chain (with the flow's current lead timbre).
        if (this.currentChord && this.melody) {
          const root = this.currentChord.notes[0] + 12; // one octave up
          const stutters = 4 + Math.round(intensity * 2);
          const s16 = 60 / this.bpm / 4;
          for (let i = 0; i < stutters; i++) {
            this.triggerSynth(5, time + i * s16 * 0.5, root, 0.3 + intensity * 0.2, s16, s16 * 0.4);
          }
        }
        break;
      }
      case 'filterSweep':
      case 'echoThrow':
        // No one-shot — handled per-step in applyFlowAutomation
        break;
    }
  }

  /**
   * Restore tracks/sends to normal after a surprise event ends. The
   * continuous automation in applyFlowAutomation will re-push the correct
   * values on the next step; this just clears the surprise-specific mutes.
   */
  private endActiveSurprise(time: number): void {
    if (!this.ctx) return;
    // Restore master gain (in case of silence surprise)
    this.master.gain.setTargetAtTime(1.1, time, 0.05);
    // Restore track gains (in case of dropOut surprise) — ramp back to
    // their world-default levels. The liveTrack() selfTrack loop will
    // re-adjust these based on LUFS/energy matching, so we just need a
    // reasonable restoration here.
    const defaultVols = [1.0, 0.6, 0.5, 0.4, 1.2, 0.7, 0.5, 0.5];
    for (let i = 1; i < 8; i++) {
      const g = this.trackGains[i];
      if (g) {
        g.gain.setTargetAtTime(defaultVols[i], time, 0.1);
      }
    }
    // Restore delay feedback (in case of echoThrow surprise)
    if (this.delayFb) {
      this.delayFb.gain.setTargetAtTime(0.35, time, 0.1);
    }
  }

  /**
   * Trigger a reversed impact — a sub-boom that swells IN (opposite of the
   * normal triggerImpact which decays OUT). Used by the reverseHit surprise.
   */
  private triggerReverseImpact(time: number, intensity: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = 'sine';
    // Start low, swell up to a sub-bass peak
    osc.frequency.setValueAtTime(35, time);
    osc.frequency.exponentialRampToValueAtTime(120, time + 0.5);
    const og = c.createGain();
    // Reversed envelope: start silent, swell in, then cut
    og.gain.setValueAtTime(0.001, time);
    og.gain.exponentialRampToValueAtTime(0.6 * intensity, time + 0.5);
    og.gain.setValueAtTime(0.6 * intensity, time + 0.5);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
    osc.connect(og);
    og.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.7);

    // Add a noise swell that builds in (reversed crack)
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.001, time);
    ng.gain.exponentialRampToValueAtTime(0.3 * intensity, time + 0.4);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(this.master);
    noise.start(time);
    noise.stop(time + 0.6);
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
    // ── Task V2c: re-link the melody engine to the harmony engine ──
    // The MelodyEngine queries the HarmonyEngine for chord tones on strong
    // beats so the lead always harmonizes with the pad. We re-link here so
    // a key change (which rebuilds both engines) doesn't break the link.
    this.melody.setHarmonyEngine(this.harmony);
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
    // ── Task D1: DJ-style phase sync info from the V2 listener ──
    // Optional — populated by referenceListenerV2.computePhaseInfo(). When
    // present, the engine forwards it to phaseSync.setReferencePhase() so
    // the beat grid can phase-lock to the radio.
    phaseInfo?: PhaseInfo;
  }): void {
    if (isFinite(refMetrics.lufs)) this.targetLufs = refMetrics.lufs;
    if (refMetrics.energy !== undefined && isFinite(refMetrics.energy)) {
      const newEnergy = clamp(refMetrics.energy, 0, 1);
      this.targetEnergy = newEnergy;
      this.refEnergy = this.targetEnergy;
      // ── Task F1: notify the flow engine of significant radio energy shifts ──
      // The flow engine uses this to decide when to transition early (chase
      // the radio's energy curve). We only call onReferenceEnergyChange when
      // the energy has shifted by more than 0.15 from the last value we
      // pushed — this avoids spamming the flow engine with every minor
      // fluctuation (the flow engine's tick() also reads this.refEnergy
      // directly every bar for the smooth chase).
      if (this.flowEngine && Math.abs(newEnergy - this.lastRefEnergyForFlow) > 0.15) {
        this.flowEngine.onReferenceEnergyChange(newEnergy);
        this.lastRefEnergyForFlow = newEnergy;
      }
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
    // ── Task A1: deep A/B analysis ──
    // Runs the effects detector + timbre fingerprint + uniqueness detector +
    // synthesis router on the latest reference features. Stores the results
    // for the UI dashboard. The synthesis ROUTING (mode switches, send-level
    // adjustments) is gated by a 10-second anti-thrash cooldown so the engine
    // doesn't flicker modes when the detector wobbles on borderline material.
    this.applyDeepPursuit();
    // ── Task D1: forward reference phase info to PhaseSync ──
    // The V2 listener's computePhaseInfo() builds a PhaseInfo from the kick-
    // band transient grid. When present, we hand it to the PhaseSync so it
    // can recompute the target phase offset for the scheduler. When absent
    // (no kick transients, low confidence, or V1 listener), we no-op — the
    // PhaseSync gracefully degrades (no offset, no nudge).
    if (refMetrics.phaseInfo) {
      this.phaseSync.setReferencePhase(refMetrics.phaseInfo);
    }
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

  // ─── Task A1: deep A/B analysis (effects + timbre + uniqueness + router) ──
  //
  // applyDeepPursuit() runs the four new detectors on the latest reference
  // features and stores the results for the UI dashboard. The synthesis
  // ROUTING (applying mode switches + send-level adjustments) is gated by
  // a 10-second anti-thrash cooldown so the engine doesn't flicker modes
  // when the detector wobbles on borderline material.
  //
  // The detectors themselves ALWAYS run (every liveTrack call) — even when
  // we don't act on them, the dashboard should show what the engine is
  // currently "hearing". This is critical for the UI: a low-confidence
  // "between two modes" result is still useful diagnostic info.
  private applyDeepPursuit(): void {
    const features = this.buildRefFeatures();
    if (!features) return;

    // ── Push to history (for uniqueness detection across windows) ──
    this.refFeaturesHistory.push(features);
    if (this.refFeaturesHistory.length > Psy4EngineV2.REF_HISTORY_MAX) {
      this.refFeaturesHistory.shift();
    }

    // ── Effects detector ──
    // We don't have the decoded PCM here (the listener doesn't expose it
    // to the engine), so we pass undefined for the audioBuffer parameter.
    // The detector falls back to feature-only heuristics — still useful
    // for reverb / chorus / distortion / compression / filter / stereo.
    try {
      this.refEffects = detectEffects(features);
    } catch {
      this.refEffects = null;
    }

    // ── Timbre fingerprint ──
    try {
      this.refTimbre = computeTimbreFingerprint(features);
    } catch {
      this.refTimbre = null;
    }

    // ── Current timbre (from own metrics) ──
    // Build a minimal RefFeatures-like snapshot from own self-tracked values
    // so we can compare our timbre to the reference's.
    if (this.ownSpectralCentroid > 0) {
      const ownFeatures: RefFeatures = {
        bpm: this._bpm,
        spectralCentroid: this.ownSpectralCentroid,
        subEnergy: this.ownSubEnergy,
        lowEnergy: 0,
        midEnergy: 0,
        highEnergy: this.ownHighEnergy,
        airEnergy: 0,
        transientDensity: this.ownTransientDensity,
        kickDecayMs: this.refKickDecay * 1000, // approx
        bassDecayMs: this.refBassDecay * 1000,
        stereoWidth: this.refStereoWidth, // we don't measure own stereo
        energy: 0,
      };
      try {
        this.currentTimbre = computeTimbreFingerprint(ownFeatures);
      } catch {
        this.currentTimbre = null;
      }
    }

    // ── Timbre comparison ──
    if (this.refTimbre && this.currentTimbre) {
      try {
        this.timbreComparison = compareFingerprints(this.refTimbre, this.currentTimbre);
      } catch {
        this.timbreComparison = null;
      }
    } else {
      this.timbreComparison = null;
    }

    // ── Uniqueness detector (uses the history we've been accumulating) ──
    try {
      this.uniqueElements = detectUniqueElements(features, this.refFeaturesHistory);
    } catch {
      this.uniqueElements = [];
    }

    // ── Synthesis router ──
    // Always compute the plan (so the UI can show it), even if we don't
    // apply it this cycle due to the cooldown.
    if (this.refEffects && this.refTimbre) {
      try {
        this.synthPlan = routeSynthesis(
          this.refEffects,
          this.refTimbre,
          this.currentTimbre,
          this.currentWorld?.id ?? 'dark-psy',
        );
      } catch {
        this.synthPlan = null;
      }
    }

    // ── Apply the plan (gated by 10s cooldown) ──
    const nowMs = Date.now();
    if (nowMs - this.lastDeepPursuitTime < Psy4EngineV2.DEEP_PURSUIT_COOLDOWN_MS) {
      return; // cooldown not elapsed — wait
    }
    if (!this.synthPlan) return;
    this.lastDeepPursuitTime = nowMs;

    // ── Apply mode switches (lead / pad / arp) ──
    // These ride on top of the per-world preset selection AND the T1
    // synthesis-character detector. A1's router is more sophisticated
    // (it considers world + effects + timbre, not just harmonic content),
    // so its choice wins when active. Pass null to clear if the plan
    // says 'classic' (revert to per-world preset).
    if (this.synthPlan.leadMode === 'classic') {
      this.setSynthMode(5, null);
    } else {
      this.setSynthMode(5, this.synthPlan.leadMode);
    }
    if (this.synthPlan.padMode === 'classic') {
      this.setSynthMode(6, null);
    } else {
      this.setSynthMode(6, this.synthPlan.padMode);
    }
    if (this.synthPlan.arpMode === 'classic') {
      this.setSynthMode(7, null);
    } else {
      this.setSynthMode(7, this.synthPlan.arpMode);
    }

    // Apply each adjustment. The router emits concrete (param, track, value)
    // triples that map directly to the engine's existing control surface.
    // We skip adjustments that would push us out of safe ranges — the
    // detectors clamp internally, but we double-check here.
    for (const adj of this.synthPlan.adjustments) {
      this.applySynthesisAdjustment(adj);
    }
  }

  /**
   * Apply a single SynthesisAdjustment from the router's plan. Routes to
   * the appropriate engine control method (setSynthMode, setSendLevel,
   * setTrackEffect, setFMDepth, setWavetablePosition, setMasterParam, or
   * setSendEffectParam) based on the adjustment's `param` name.
   *
   * Track = -1 means "master / global" (not a per-track adjustment).
   */
  private applySynthesisAdjustment(adj: SynthesisAdjustment): void {
    const { param, track, targetValue } = adj;
    if (!Number.isFinite(targetValue)) return;

    // Global params (track === -1).
    if (track === -1) {
      if (param === 'midRatio' || param === 'highRatio' || param === 'lowRatio') {
        this.setMasterParam(param, targetValue);
      } else if (param === 'chorusRate') {
        this.setSendEffectParam('chorus', 'rate', targetValue);
      } else if (param === 'phaserRate') {
        this.setSendEffectParam('phaser', 'rate', targetValue);
      } else if (param === 'phaserFeedback') {
        this.setSendEffectParam('phaser', 'feedback', targetValue);
      } else if (param === 'distortionDrive') {
        this.setSendEffectParam('distortion', 'drive', targetValue);
      }
      return;
    }

    // Per-track send levels.
    if (param === 'sendReverb') {
      this.setSendLevel(track, 'reverb', targetValue);
    } else if (param === 'sendDelay') {
      this.setSendLevel(track, 'delay', targetValue);
    } else if (param === 'sendChorus') {
      this.setSendLevel(track, 'chorus', targetValue);
    } else if (param === 'sendPhaser') {
      this.setSendLevel(track, 'phaser', targetValue);
    } else if (param === 'sendDistortion') {
      this.setSendLevel(track, 'distortion', targetValue);
    } else if (param === 'sendBitcrush') {
      this.setSendLevel(track, 'bitcrush', targetValue);
    } else if (param === 'cutoff') {
      // Lead filter cutoff override (Task V2b special-case in setTrackEffect).
      this.setTrackEffect(track, 'cutoff', targetValue);
    } else if (param === 'haasMix' || param === 'haasDelayMs') {
      this.setTrackEffect(track, param, targetValue);
    } else if (param === 'eqLowGain' || param === 'eqMidGain' || param === 'eqHighGain') {
      this.setTrackEffect(track, param, targetValue);
    } else if (param === 'fmDepth') {
      // FM depth is a global override (not per-track) — apply to the engine.
      this.setFMDepth(targetValue);
      // Also ensure the lead track is in FM mode (the router's leadMode
      // drives this — handled separately below).
    } else if (param === 'sawSpread') {
      // Saw spread is applied via the preset's sawSpread field — there's no
      // direct setter, but the synth-mode override already routes through
      // the supersaw preset. We log it for diagnostics.
    } else if (param === 'wtPosition') {
      this.setWavetablePosition(targetValue);
    } else if (param === 'delayTimeMs') {
      // Global delay time — set on the delay node (we don't have a public
      // setter for this yet; the existing delay tap is fixed at 375 ms).
      // For now we skip — a future enhancement could expose setDelayTime().
    }
  }

  /**
   * Task A1: deep A/B analysis snapshot for UI display. Returns the latest
   * detected effects, reference timbre, current (own) timbre, fingerprint
   * comparison, unique elements, and the synthesis plan — everything the
   * expanded A/B comparison card needs to render.
   *
   * Every field is null until the first liveTrack() call with sufficient
   * reference features. The UI should use optional chaining throughout.
   */
  getDeepAnalysis(): {
    effects: DetectedEffects | null;
    refTimbre: TimbreFingerprint | null;
    currentTimbre: TimbreFingerprint | null;
    timbreComparison: FingerprintComparison | null;
    uniqueElements: UniqueElement[];
    synthPlan: SynthesisPlan | null;
    historyLength: number;
  } {
    return {
      effects: this.refEffects,
      refTimbre: this.refTimbre,
      currentTimbre: this.currentTimbre,
      timbreComparison: this.timbreComparison,
      uniqueElements: this.uniqueElements,
      synthPlan: this.synthPlan,
      historyLength: this.refFeaturesHistory.length,
    };
  }

  /**
   * Task A1: force-apply the current synthesis plan (e.g. when the user
   * manually requests it from the UI). Bypasses the 10-second cooldown.
   */
  applySynthesisPlanNow(): void {
    if (!this.synthPlan) return;
    this.lastDeepPursuitTime = Date.now();
    // Apply mode switches (same logic as applyDeepPursuit).
    this.setSynthMode(5, this.synthPlan.leadMode === 'classic' ? null : this.synthPlan.leadMode);
    this.setSynthMode(6, this.synthPlan.padMode === 'classic' ? null : this.synthPlan.padMode);
    this.setSynthMode(7, this.synthPlan.arpMode === 'classic' ? null : this.synthPlan.arpMode);
    for (const adj of this.synthPlan.adjustments) {
      this.applySynthesisAdjustment(adj);
    }
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

  /**
   * Task V2a: kick off the scheduler using the Worker-based tick.
   *
   * The SchedulerWorker posts `{type:'tick'}` messages from a separate
   * thread, which the main thread's `onTick` callback turns into a call to
   * `this.tick()`. Because the worker thread has no other work, its 15ms
   * interval fires far more reliably than main-thread `setTimeout(15ms)`,
   * which is subject to React renders, GC, layout, and the HTML5 4ms clamp.
   *
   * If `Worker` isn't available (SSR, old browser, CSP), the SchedulerWorker
   * transparently falls back to a main-thread `setInterval` — the engine
   * keeps running, just without the jitter reduction. Either way we never
   * touch `this.timer` here; that field is retained only for the unlikely
   * case of an explicit fallback demand (currently unused).
   *
   * Re-entrant safety: `start()` checks `this.playing` first, so calling
   * `scheduleNextTick` while already ticking is a no-op (the worker's
   * onTick handler is idempotent — `tick()` early-returns if `!playing`).
   */
  private scheduleNextTick(): void {
    if (!this.playing) return;
    // Wire the tick callback once. Setting onTick is cheap (just a field
    // assignment) so it's safe to set every call; if it's already set to
    // the same closure, this is a no-op in practice.
    this.scheduler.onTick = () => { this.tick(); };
    // Start the worker at 15ms. If the worker is already running, this is
    // a no-op (it just confirms the interval).
    this.scheduler.start(15);
  }

  private tick(): void {
    if (!this.playing || !this.ctx) return;
    // P1: report this tick's duration to the PerformanceMonitor so it can
    // detect audio-thread overload (tick > 5ms = at-risk). Measured around
    // the entire scheduling pass — including scheduleStep, applySectionAutomation,
    // triggerDrum/triggerSynth, and the bar/section bookkeeping below.
    const __p1TickStart = (typeof performance !== 'undefined') ? performance.now() : 0;
    const lookahead = 0.06;

    while (this.nextTime < this.ctx.currentTime + lookahead) {
      // Recompute s16 each step so the BPM ramp changes tempo smoothly
      // without invalidating the scheduler's lookahead window.
      const s16 = 60 / this.bpm / 4;
      // ── Task D1: apply DJ-style phase offset to the scheduled time ──
      // The PhaseSync returns a smoothed offset (seconds) that aligns our
      // beat grid with the radio's. We add it to nextTime when calling
      // scheduleStep so every step fires at the phase-correct time. The
      // offset is small (< 50 ms per step nudge) so there are no audio
      // glitches. When sync is disabled, getPhaseOffset() returns 0.
      //
      // Note: we do NOT add the offset to `this.nextTime` itself — that
      // would accumulate across steps. The offset is applied to the time
      // passed to scheduleStep, leaving the scheduler's internal clock
      // unchanged so the lookahead window stays valid.
      const phaseOffset = this.phaseSync.getPhaseOffset();
      this.scheduleStep(this.step, this.bar, this.nextTime + phaseOffset);
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
        // ── Task D1: DJ-style phase sync per-bar tick ──
        // tickBar() returns:
        //   - bpmNudge: small BPM delta to apply this bar (gradual convergence
        //     toward the ref BPM — 0.1 / 0.3 BPM/bar based on |delta|).
        //   - doBeatDrop: if true, jump nextTime by beatDropOffsetSec to
        //     realign downbeats. This is the "soft restart" DJ move —
        //     happens rarely (only when sync first engages or after a
        //     major drift). The engine applies the jump by adding it to
        //     nextTime (advancing or retarding the grid by an integer
        //     number of beats).
        //   - beatDropOffsetSec: signed time-jump to apply (if doBeatDrop).
        const syncAction = this.phaseSync.tickBar(this._bpm);
        if (syncAction.bpmNudge !== 0) {
          // Apply the gradual BPM nudge. We don't touch targetBpm /
          // bpmRampBarsLeft — those are owned by the engine's existing
          // BPM ramp (which fires when applyMusicalUnderstanding sees a
          // > 2 BPM delta). Our nudge is a small additional step on top.
          this._bpm = clamp(
            Math.round((this._bpm + syncAction.bpmNudge) * 10) / 10,
            60, 200,
          );
        }
        if (syncAction.doBeatDrop && syncAction.beatDropOffsetSec !== 0) {
          // Apply the beat-drop: jump nextTime by the signed offset. This
          // shifts the entire future grid by an integer number of beats,
          // realigning our downbeats with the radio's. The PhaseSync has
          // already reset its currentOffset to 0, so the per-step nudge
          // starts fresh from the new alignment.
          //
          // Positive offset = jump forward (we were ahead of the radio).
          // Negative offset = jump backward (we were behind the radio).
          // Jumping backward is safe because we're inside the lookahead
          // window — the next scheduleStep will see the adjusted nextTime
          // and schedule at the corrected time (still in the future).
          this.nextTime += syncAction.beatDropOffsetSec;
        }
        // ── Task F1: dynamic flow engine drives section transitions ──
        // The flow engine decides WHEN to transition (based on radio energy,
        // time since last transition, musical logic, and the world's flow
        // profile) and WHAT to transition to (archetype + section length).
        // It also produces continuous automation parameters (filterCutoff,
        // reverbAmount, delayAmount, tension, surprise) that replace the old
        // static section-based automation.
        //
        // `totalBars` is the absolute bar counter (never resets) — the flow
        // engine uses it to track time-since-transition and schedule surprise
        // events. `this.bar` is bar-WITHIN-section (resets on transition) and
        // is used by scheduleStep for energy-curve indexing, riser triggers,
        // and the phrase-locked rotation below.
        this.totalBars++;
        const flow = this.flowEngine ? this.flowEngine.tick(this.totalBars, this.refEnergy) : null;
        if (flow) {
          this.currentFlow = flow;
          if (flow.label !== this.currentSection) {
            // ── Flow-driven section transition ──
            // Reset bar-within-section so scheduleStep's energy-curve indexing
            // and riser logic work with the new section's framing.
            this.bar = 0;
            this.currentSection = flow.label;
            this.onSectionChange?.(this.currentSection);
            // ── Section boundary: force a new developmental phrase (Task M1) ──
            // MelodyEngine.newPhrase() builds a fresh A A' B A'' phrase using the
            // new section's energy + tension curve. This is what makes the lead
            // play evolving, developing melodies instead of static motifs.
            const baseE = this.currentWorld.energyCurve[0] ?? 0.5;
            const phraseEnergy = clamp(baseE * (0.4 + 0.6 * flow.density), 0, 1);
            this.melody?.newPhrase(phraseEnergy);
            // ── Task H1: regenerate the harmonic progression at section boundary ──
            // Each new section gets a fresh chord progression whose length matches
            // the section's bar count and whose extension level (triad/7th/9th)
            // matches the section's energy. Drops get lush 9ths; breaks get triads.
            if (this.harmony) {
              this.currentProgression = this.harmony.generateProgression(flow.sectionBars, phraseEnergy);
              this.chordIdx = 0;
              this.currentChord = null;
            }
          }
          // ── Task F1: pop surprise events from the flow engine ──
          // maybeSurprise() returns a queued event whose startBar has arrived.
          // We store it as activeSurprise so scheduleStep's applyFlowAutomation
          // can apply the per-step effect (mute, filter sweep, delay boost).
          // The engine also calls startSurprise() to fire any one-shot effects
          // (reverse hit, initial mute ramp) at the surprise's start time.
          const surprise = this.flowEngine!.maybeSurprise(this.totalBars);
          if (surprise) {
            this.activeSurprise = surprise;
            this.surpriseReverseHitScheduled = false;
            this.startSurprise(surprise, this.nextTime);
          }
          // Clear the active surprise when its duration has elapsed.
          if (this.activeSurprise &&
              this.totalBars >= this.activeSurprise.startBar + this.activeSurprise.durationBars) {
            this.endActiveSurprise(this.nextTime);
            this.activeSurprise = null;
            this.surpriseReverseHitScheduled = false;
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

    // P1: report this tick's duration to the PerformanceMonitor. Cheap
    // (one performance.now() subtraction + array push). When the audio
    // thread is overloaded (tick > 5ms), the monitor escalates quality
    // down after 3s; when stable, it escalates up after 10s.
    if (__p1TickStart > 0 && typeof performance !== 'undefined') {
      this.perfMonitor.reportTickDuration(performance.now() - __p1TickStart);
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
    // ── Task F1: read the dynamic flow state instead of the fixed arrangement ──
    // `flow` is the latest FlowState returned by flowEngine.tick() in the
    // engine's tick() method. It carries the same fields as the old
    // ArrangementSection (label, density, bass, lead, bars) PLUS continuous
    // automation parameters (filterCutoff, reverbAmount, delayAmount,
    // tension, surprise) that applyFlowAutomation() applies every step.
    //
    // If the flow engine isn't initialized yet (defensive — shouldn't happen
    // after start()), fall back to a minimal default so scheduleStep doesn't
    // crash. This keeps the engine resilient to any future refactor that
    // might call scheduleStep before flowEngine is ready.
    const flow: FlowState = this.currentFlow ?? {
      energy: 0.5, density: 0.5, bassOn: true, leadOn: false, acidOn: false,
      hatDensity: 0.7, percDensity: 0.6, fxDensity: 0.6,
      label: 'GROOVE', filterCutoff: 1800, reverbAmount: 0.4, delayAmount: 0.2,
      tension: 0.4, surprise: 0.05, sectionBars: 8, barInSection: bar,
    };
    const key = this.musicalKey;
    const root = key.root;
    const sc = key.scale;
    const sd = 60 / this.bpm / 4;

    // ── Task F1: continuous flow automation ──
    // Replaces the old static section-based automation (applySectionAutomation).
    // Pushes the flow engine's continuous parameters (filterCutoff,
    // reverbAmount, delayAmount, tension) via setTrackEffect / setSendLevel
    // every step. Both methods use setTargetAtTime internally, so re-pushing
    // every step is a smooth no-op once settled (no audio glitches).
    //
    // Also applies the per-step effects of any active surprise event (dropOut
    // mute, filterSweep progression, echoThrow delay boost, silence).
    // Called BEFORE the rest of the step scheduling so the new send levels
    // are in effect when the note for this step fires.
    this.applyFlowAutomation(flow, bar, step, time);

    // ── Energy from world's energyCurve, modulated by flow density ──
    // The flow engine's `energy` field is already a smoothed target, but we
    // ALSO blend in the world's energyCurve (indexed by bar-in-section) so
    // the energy rises and falls WITHIN a section as well as across sections.
    // This gives the music intra-section dynamic shape (e.g. a drop builds
    // tension across its first 4 bars, peaks in the middle, releases at the
    // end) instead of being a flat energy plateau.
    const eIdx = clamp(
      Math.floor((bar / Math.max(1, flow.sectionBars)) * w.energyCurve.length),
      0,
      w.energyCurve.length - 1
    );
    const baseEnergy = w.energyCurve[eIdx];
    const energy = clamp(baseEnergy * (0.4 + 0.6 * flow.density), 0, 1);

    // ── Swing: delay offbeat steps by swing * halfStep ──
    let stepTime = time;
    if (step % 2 === 1 && w.swing > 0) {
      stepTime += w.swing * sd * 0.5;
    }

    // ── Task F1: surprise event per-step gating ──
    // If a surprise event is active, it can suppress notes for this step.
    //   - silence:  suppress ALL notes (dramatic pause)
    //   - dropOut:  suppress everything except the kick (DJ brake effect)
    // Other surprise types (filterSweep, echoThrow, stutter, reverseHit)
    // don't gate notes — they shape the FX chain via applyFlowAutomation().
    const activeSurprise = this.activeSurprise;
    const suppressAll = activeSurprise?.type === 'silence';
    const suppressNonKick = activeSurprise?.type === 'dropOut';

    const isPreDrop = (flow.label === 'BUILD' || flow.label === 'BUILD 2') && bar >= flow.sectionBars - 2;
    const isDropStart = flow.label.includes('DROP') && bar === 0 && step === 0;

    // ── RISER FX (last 2 bars of build) — uses raw time, not swung ──
    if (isPreDrop && step === 0 && bar === flow.sectionBars - 2) {
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
    // Kick is the ONLY track that fires during a dropOut surprise (DJ brake).
    // During silence, even the kick is suppressed.
    if (!suppressAll && w.kickPattern.length === 16 && w.kickPattern.charAt(step) === 'x') {
      const isDownbeat = step % 4 === 0;
      const aggressionBoost = 0.7 + 0.6 * w.aggression;
      // Velocity scales with both flow.density and energyCurve so drops hit
      // harder than builds even at the same density (Task 15: verify energy
      // actually affects velocity/density).
      const vel = isDownbeat
        ? 0.4 + flow.density * 0.3 * aggressionBoost + energy * 0.15
        : 0.3 * aggressionBoost + energy * 0.1;
      this.triggerDrum(0, stepTime, vel);
      // ── Task D1: report our own beat to the PhaseSync ──
      // The PhaseSync uses this to compute our predicted phase and align it
      // with the radio's phase. `isDownbeat` flags bar-start kicks (step % 16
      // === 0) so the downbeat phase can be tracked separately.
      //
      // We pass both the audio-context time (when the kick fires) and the
      // current wall-clock + ctx.currentTime so PhaseSync can convert audio-
      // context time → wall-clock time (its unified time base shared with
      // the listener).
      if (this.ctx) {
        const wallNow = (typeof performance !== 'undefined' && performance.now)
          ? performance.now() / 1000
          : Date.now() / 1000;
        this.phaseSync.setOwnBeat(
          stepTime,
          this.ctx.currentTime,
          wallNow,
          step % 16 === 0,
        );
      }
    }

    // ── CLAP (track 1) — world-driven clapPattern gate ('x' = hit) ──
    if (!suppressAll && !suppressNonKick && w.clapPattern && w.clapPattern.length === 16 && w.clapPattern.charAt(step) === 'x' && flow.density > 0.4) {
      this.triggerDrum(1, stepTime, 0.3 + energy * 0.1);
    }

    // ── HATS (track 2) — probability from world.hatDensity per eligible offbeat ──
    const hatProb = clamp(w.hatDensity * flow.hatDensity * (0.5 + 0.5 * energy) * tScale, 0, 1);
    if (!suppressAll && !suppressNonKick && step % 2 === 1 && this.musicRng?.chance(hatProb)) {
      const vel = 0.15 + (step % 4 === 3 ? 0.1 : 0) + energy * 0.1 + tVelBoost;
      this.triggerDrum(2, stepTime, vel);
    }

    // ── PERC (track 3) — world-driven percPattern gate + density-based probability ──
    const percProb = clamp(w.percDensity * flow.percDensity * energy * tScale, 0, 1);
    if (!suppressAll && !suppressNonKick && w.percPattern && w.percPattern.length === 16 && w.percPattern.charAt(step) === 'x' && flow.density > 0.5 && this.musicRng?.chance(percProb)) {
      this.triggerDrum(3, stepTime, 0.2 + tVelBoost);
    }

    // ── BASS (track 4) — world-driven bassPattern + BASS_PATTERNS by derived style ──
    // Task H1: when in a lead section (drop/variation) with an active chord,
    // the bass follows the chord root — bassDeg becomes an offset ABOVE the
    // current chord's scale degree. This makes the bass walk with the harmony
    // (e.g. during a VI chord, the bass plays the VI root + pattern offsets
    // instead of staying on the tonic). In non-lead sections (groove/build/
    // outro), the bass stays on the tonic for that classic psytrance pump.
    if (!suppressAll && !suppressNonKick && flow.bassOn && w.bassPattern.length === 16 && w.bassPattern.charAt(step) === 'x') {
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
        const chordDegOffset = (flow.leadOn && this.currentChord)
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
    if (!suppressAll && flow.leadOn && this.melody && energy > 0.35) {
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
    if (!suppressAll && !suppressNonKick && flow.leadOn && step === 0 && this.harmony && this.currentProgression.length > 0) {
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
    const isVariation = flow.label === 'VARIATION';
    if (!suppressAll && !suppressNonKick && flow.leadOn && step % 2 === 0 && this.musicRng?.chance(arpProb)) {
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
    if (!suppressAll && !suppressNonKick && flow.bassOn && flow.leadOn && step % 2 === 1 && this.musicRng?.chance(shakerProb)) {
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
    // P1: voice stealing — find a free voice (isBusy=false) or steal the
    // oldest active voice (smallest lastTriggeredAt). With 8 voices and
    // psytrance's typical 6 simultaneous notes, the 7th/8th are usually free.
    // When a dense polyphonic moment does occur, we steal the oldest rather
    // than drop the new note — the stolen voice's release tail is cut short.
    const voice = this.acquireSynthVoice();

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

    // ── P1: adaptive quality — cap supersaw osc count ──
    // On 'low' quality (maxSupersawOsc=3) and 'medium' (maxSupersawOsc=4),
    // reduce the supersaw's osc count to lower CPU. The supersaw's character
    // (detuned saws panned across the field) is preserved at any count ≥ 3;
    // only the thickness is reduced. 'high' quality is uncapped (7 osc).
    if (p.mode === 'supersaw' && typeof p.sawCount === 'number'
        && p.sawCount > this.maxSupersawOsc) {
      p = { ...p, sawCount: this.maxSupersawOsc };
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

    // ── Task F1: continuous flow filter cutoff override ──
    // applyFlowAutomation() pushes the flow engine's continuous filterCutoff
    // (or a filterSweep surprise's sweep curve) into leadCutoffOverride every
    // step. This OVERRIDES the world timbre + reference pursuit blend — the
    // flow's continuous automation is the dominant lead filter control.
    // Outside a flow (leadCutoffOverride === -1, only possible before the
    // flow engine is initialized) this is a no-op.
    if (trackIdx === 5 && this.leadCutoffOverride > 0) {
      p = { ...p, cutoff: clamp(this.leadCutoffOverride, 200, 16000) };
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

  // ─── Task D1: DJ-style phase sync public API ──────────────────────────────
  //
  // These methods expose the PhaseSync to the UI. The toggle lets the user
  // enable/disable sync at runtime; the status returns the live sync state
  // for display (synced indicator, offset, BPM match, downbeat alignment,
  // beat grid visualization). All methods are safe to call before start() —
  // they no-op gracefully on an uninitialized engine.

  /**
   * Enable or disable DJ-style phase sync. When disabled, the engine runs
   * exactly as before (BPM tracking via applyMusicalUnderstanding + flow
   * engine, no phase offset, no beat-drop). When enabled, the PhaseSync
   * smoothly aligns our beat grid with the radio's.
   *
   * Safe to call before start() — PhaseSync is constructed eagerly so the
   * toggle state persists across stop/start cycles.
   */
  setSyncEnabled(enabled: boolean): void {
    this.phaseSync.setSyncEnabled(enabled);
  }

  /** Returns true if DJ-style phase sync is currently enabled. */
  isSyncEnabled(): boolean {
    return this.phaseSync.isSyncEnabled();
  }

  /**
   * Returns the current sync status for UI display. The shape mirrors
   * PhaseSync.getSyncStatus() — see phaseSync.ts for field docs. All fields
   * are guarded against missing data (zero/false when no ref phase yet).
   */
  getSyncStatus(): SyncStatus {
    return this.phaseSync.getSyncStatus();
  }

  // ─── P1 stubs: adaptive quality + voice stealing ──────────────────────────
  //
  // These methods are referenced by the P1 (PerformanceMonitor) code above
  // (the `perfMonitor` field initializer and `triggerSynth`). The full P1
  // implementations were in progress but not committed; these stubs make
  // the file compile cleanly so the F1 flow engine work isn't blocked.
  // A future P1 agent can replace these with full implementations.

  /**
   * P1: acquire a synth voice from the pool with voice stealing.
   * Stub: simple round-robin (same as the pre-P1 behavior). A full
   * implementation would scan for `isBusy()=false` and steal the oldest
   * voice when all are busy.
   */
  private acquireSynthVoice(): AdvancedSynthVoice {
    const n = this.synthPool.length;
    if (n === 0) {
      // Defensive — should never happen (pool is allocated in init()).
      throw new Error('synthPool is empty — init() not called');
    }
    const voice = this.synthPool[this.synthIdx];
    this.synthIdx = (this.synthIdx + 1) % n;
    return voice;
  }

  /**
   * P1: PerformanceMonitor callback — invoked when the monitor's adaptive
   * logic decides to escalate / de-escalate quality. Stub: log only. A
   * full implementation would call `this.applyQuality(level)`.
   */
  private onAdaptiveQualityChange(level: QualityLevel, reason: string): void {
    if (typeof console !== 'undefined') {
      console.log(`[PSY4] Quality → ${level} (${reason})`);
    }
    this.quality = level;
  }
}
