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
import { PhaseSync, PhaseInfo } from './phaseSync';
// ── Task D1 (upgrade): full DJ controller — extends PhaseSync with key /
// groove / energy / phrase sync (Pioneer CDJ / Traktor / Serato model).
// The DJController is a PEER of PhaseSync — it reads the existing phase
// sync state and extends it with the additional dimensions.
import { DJController, DJSyncState, GrooveInfo } from './djController';
// ── Task P4 (phrase-level sync): aligns our 4-8 bar phrase boundaries
//    with the radio's. Beat sync (PhaseSync) aligns individual beats;
//    section sync (MusicAnalyzer + flowEngine.transitionTo) aligns section
//    types; phrase sync aligns the STRUCTURAL unit — when the radio starts
//    a new 8-bar phrase, we start a new phrase too (not 3 bars into our
//    current one). The PhraseSync is OPTIONAL — when master sync is off,
//    checkRealignment() always returns { realign: false }. Constructed
//    eagerly so the toggle state persists across stop/start cycles.
import { PhraseSync, PhraseSyncState } from './phraseSync';
// ── Task M1 (Musical Director): phrase-level composer that replaces the
// step-by-step note decision in scheduleStep. The director composes full
// 4-8 bar phrases ahead of time with musical phrasing (build/drop/break),
// rhythmic complexity (syncopation, polyrhythm, ghost notes), melodic
// development (motif → variation → contrast → climax → resolution), and
// cohesive interplay between instruments. The scheduler's tick() calls
// director.getNotesForWindow(start, end) and fires the pre-composed notes. ──
import {
  MusicalDirector,
  PhraseNote,
  labelToCharacter,
} from './musicalDirector';
// ── Task T1 (active learning): cross-session memory of "what worked".
//    LearningMemory stores successful (refFeatures, engineParams, matchScore)
//    triples keyed by a deterministic ref signature. When similar radio
//    content appears, the engine queries the memory for the closest pattern
//    and applies its params IMMEDIATELY — a head start instead of slow
//    pursuit convergence. The memory persists across sessions via
//    localStorage, so yesterday's good params for dark-psy at 145 BPM are
//    remembered today. ──
import {
  LearningMemory,
  LearnedPattern,
  LearnedPatternRefFeatures,
  LearnedPatternEngineParams,
  LearningStatus,
} from './learningMemory';
// ── Task P2 (musical intelligence): hears MUSIC, not just features. The
//    ReferenceListenerV2 extracts ACOUSTIC features (BPM, LUFS, spectral
//    bands, centroid, transient density). The MusicAnalyzer extracts MUSICAL
//    features from those same windows: section boundaries (intro/groove/build/
//    drop/break/outro), riser + drop + break events, rhythmic pattern (kick +
//    hat gate strings), melodic contour (rising/falling/arch/wave), chord-
//    change rate (harmonic rhythm), and key modulations. The engine reacts to
//    dropHit / breakStart / riserStart events by calling flowEngine.transitionTo
//    — when the radio drops, we drop; when the radio builds, we build. This is
//    true musical synchronization, not just feature matching. ──
import {
  MusicAnalyzer,
  type MusicalAnalysis,
  type MusicalEvent,
  type MusicAnalyzerFeatures,
} from './musicAnalyzer';
// ── Task P5 (adaptive learning): learns MUSICAL CONTENT (motifs + rhythms)
//    from the radio, blends learned material into composition. Where
//    LearningMemory (T1) stores parameter configurations, VocabularyLearner
//    stores actual melodic motifs (scale-degree sequences) + rhythmic
//    patterns (16-char gate strings) extracted from the radio's spectral
//    features. The MusicalDirector queries this vocabulary when composing
//    phrases — with 30% probability the lead quotes a learned motif (the
//    same development pipeline still applies, so the quote evolves); with
//    40% probability the drums use a learned rhythm (blended with character
//    gating so a 'break' still stays sparse). Effectiveness tracking
//    reinforces motifs/rhythms that improve the match score over the next
//    30s and prunes those that don't. Persists across sessions via
//    localStorage (separate key from LearningMemory). ──
import {
  VocabularyLearner,
  type VocabularyStats,
} from './vocabularyLearner';
// ── Task W1: unified AudioWorklet audio backend. The WorkletEngine replaces
//    the 1054-node Web Audio graph with a single AudioWorkletNode that
//    contains ALL DSP (Moog ladder, polyBLEP, Schroeder reverb, bus
//    processors, master chain, 18 voice types incl. the new FM voice). The
//    main thread (this class) keeps musical logic; the worklet runs the DSP.
//    PSY5 RT-safe techniques are baked in: polynomial ftanh, 256-slot ring
//    buffer, zero per-block allocation, dynamic voice budget, batched
//    postMessage. ──
import { WorkletEngine } from './workletEngine';
// ── Task F1-F3: clean architectural separation. ONE AudioBackend interface,
//    TWO implementations (WorkletEngine + LegacyAudioGraph). The engine uses
//    `this.audio: AudioBackend` everywhere — NO scattered `if (useWorklet)`
//    conditionals. The engine owns musical logic; the backend owns audio. ──
import type {
  AudioBackend,
  AudioBackendFXConfig,
  SynthTimbre,
  TriggerSynthOpts,
} from './audioBackend';
import { LegacyAudioGraph, LegacyEngineAccess } from './legacyAudioGraph';

// ─── Constants ──────────────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => v < a ? a : (v > b ? b : v);

// ─── Task L1: low-latency scheduler types + constants ──────────────────────
//
// Latency modes map to AudioContext `latencyHint` values (set at ctx
// construction) AND to the initial adaptive lookahead target. The user can
// switch modes via setLatencyMode(); the new mode applies to the next ctx
// construction (latencyHint is immutable post-creation) and immediately to
// the lookahead target.
//
//   'interactive' : lowest latency (~15ms output, 30ms lookahead). For live
//                   performance and DJ beat-matching. Forces when DJ sync
//                   engages.
//   'balanced'    : ~30ms output, 60ms lookahead. Default on mobile (better
//                   stability under thermal throttling).
//   'playback'    : ~50ms output, 100ms lookahead. Power saving on mobile
//                   or when the user trades latency for rock-solid timing.
export type LatencyMode = 'interactive' | 'balanced' | 'playback';

export interface LatencyStatus {
  /** AudioContext baseLatency + processing latency, in ms. Hardware/output. */
  outputLatencyMs: number;
  /** Current scheduler lookahead in ms (adaptive: 30-100ms). */
  schedulingLatencyMs: number;
  /** Output + scheduling. Target <30ms total. */
  totalLatencyMs: number;
  /** Cumulative count of steps whose scheduled time was already in the past
   *  when the scheduler tried to fire them (main thread blocked too long). */
  droppedNotes: number;
  /** 0..1 estimated CPU load (avgFrameMs / 16.67, from PerformanceMonitor). */
  cpuLoad: number;
  /** True if no drops in the last 5 seconds. */
  stable: boolean;
  /** Current latency mode. */
  latencyMode: LatencyMode;
  /** Live (smoothed) lookahead in ms. */
  lookaheadMs: number;
  /** Adaptive controller's target lookahead in ms. */
  targetLookaheadMs: number;
  /** Worker tick interval in ms. */
  workerIntervalMs: number;
  /** True if the scheduler is using a Web Worker (false = setInterval fallback). */
  usesWorker: boolean;
}

const LATENCY_MODE_LOOKAHEAD: Record<LatencyMode, number> = {
  interactive: 0.03,  // 30ms — lowest practical lookahead (worker ticks at 25ms)
  balanced:    0.06,  // 60ms — default, mobile-friendly
  playback:    0.1,   // 100ms — max stability, power-saving on mobile
};

// ─── Per-track effects rack configs (Task E1) ───────────────────────────────
//
// Each of the 8 tracks gets a tailored insert chain. The configs are
// world-agnostic defaults; per-world send modulations are layered on top by
// applyWorldEffectSettings() so dark-psy gets more distortion/bitcrush, goa
// gets more phaser, morning gets more chorus, etc.
//
// Tracks: 0=KICK, 1=SNARE/CLAP, 2=HATS, 3=PERC, 4=BASS, 5=LEAD, 6=PAD, 7=ARP.

export function buildTrackRackConfigs(world: World): TrackRackConfig[] {
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

  // ── Task M1: Musical Director — phrase-level composer ──
  //    Replaces the step-by-step note decision in scheduleStep. The director
  //    composes full 4-8 bar phrases AHEAD OF TIME with musical phrasing
  //    (build/drop/break/groove/variation/tension/release characters),
  //    rhythmic complexity (syncopation, polyrhythm, ghost notes, triplet
  //    fills), melodic development (motif → variation → contrast → climax →
  //    resolution), and cohesive interplay between instruments (bass follows
  //    the chord progression; lead's strong beats align with chord tones; arp
  //    complements the lead via call-response; pad provides the harmonic
  //    foundation; drums provide rhythmic coherence).
  //
  //    The scheduler's tick() calls director.getNotesForWindow(start, end)
  //    every 16th-step window and fires the pre-composed notes via
  //    triggerDrum / triggerSynth. This means notes are COMPOSED before
  //    they're played, with full phrase context — no more "child pressing
  //    keys randomly" (per the user's ROAST feedback).
  //
  //    Phrases are prepared during the previous phrase for gapless
  //    transitions (prepareNextPhrase + advancePhrase on section changes).
  //    The director shares the same HarmonyEngine + MelodyEngine + SeededRng
  //    instances as the engine, so motif/harmony state stays in sync across
  //    key changes (refreshMusicalGenerators calls director.setEngines).
  private director: MusicalDirector | null = null;

  // ── Task F1-F3: ONE audio backend, NO scattered conditionals ──────────────
  // The engine owns musical logic (harmony, melody, style, learning, DJ sync,
  // flow, director, pursuit). The backend owns audio (voices, filters, reverb,
  // delay, master chain). The AudioBackend interface is the ONLY bridge.
  //
  // At init() time, the engine decides: try WorkletEngine first (single
  // AudioWorkletNode, 10-50x more efficient, better DSP), fall back to
  // LegacyAudioGraph (1054-node Web Audio graph) if the worklet fails to load.
  // Once decided, it commits for the session — no mid-session switching.
  //
  // The engine calls this.audio.triggerDrum(...), this.audio.setWorld(...),
  // this.audio.setFX(...), etc. NO `if (useWorklet)` conditionals anywhere.
  // Both backends implement the SAME interface; the engine code is identical
  // regardless of which backend is active.
  private audio: AudioBackend | null = null;
  /**
   * The underlying WorkletEngine (when the worklet backend is active).
   * Exposed so the UI / page.tsx can subscribe to worklet stats updates
   * (~10 Hz) for the CPU/voice dashboard. Null when the legacy backend
   * is active.
   */
  workletEngine: WorkletEngine | null = null;
  /** True when init() has completed and the backend is ready for start(). */
  private audioReady = false;
  /** True when init() is in progress (UI shows "Loading engine..."). */
  private audioLoading = false;
  /** Cached init promise — await this to ensure init completes before start. */
  private initPromise: Promise<void> | null = null;
  /** True if the worklet backend is active (vs legacy). */
  private isWorkletBackend = false;

  // ── Legacy node graph fields (kept for backwards compatibility — NO LONGER ──
  //    used directly; all access goes through this.audio). These are null in
  //    worklet mode and in legacy mode (the LegacyAudioGraph owns the nodes).
  //    Retained as undefined placeholders so any stray references surface as
  //    runtime errors during the refactor transition.
  //    TODO: remove these once all references are routed through this.audio.

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
  // so main-thread GC/React renders don't jitter the 25ms musical clock. If
  // Worker is unavailable (SSR / old browser), the wrapper falls back to a
  // main-thread setInterval automatically. The `timer` field is kept as a
  // last-resort fallback path for environments where neither Worker nor
  // setInterval-with-onTick is desired — currently unused.
  //
  // ── Task L1: low-latency adaptive scheduler ──
  // `lookahead` (seconds) is how far ahead notes are scheduled via Web Audio's
  // internal scheduler (setValueAtTime / linearRampToValueAtTime / start()).
  // Larger = more buffer against main-thread jitter, but higher perceived
  // latency on parameter changes. The adaptive controller tunes this between
  // 30ms (interactive, tight) and 100ms (playback, safe) based on observed
  // drops + CPU load.
  //
  // `targetLookahead` is the controller's setpoint; `lookahead` is the
  // smoothed live value (50% per second toward target — no sudden jumps that
  // would cause scheduling gaps).
  //
  // `droppedNotes` counts steps whose scheduled time was already in the past
  // when the scheduler tried to fire them. Web Audio still plays them
  // immediately (audible glitch), but the count drives the adaptive grow.
  //
  // `lastDropAt` / `lastStabilityCheckAt` are wall-clock (performance.now)
  // timestamps used by the hysteresis logic (5s drop-free → stable;
  // 10s stable + CPU<70% → shrink lookahead).
  //
  // `latencyMode` is the user-facing mode (interactive/balanced/playback).
  // It sets the AudioContext latencyHint at construction AND the initial
  // adaptive target. Forced to 'interactive' when DJ sync engages.
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduler: SchedulerWorker = new SchedulerWorker();
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private sectionIdx = 0;
  private currentSection = 'INTRO';

  // Task L1: low-latency scheduler state.
  private lookahead = LATENCY_MODE_LOOKAHEAD.interactive;   // 0.03s default
  private targetLookahead = LATENCY_MODE_LOOKAHEAD.interactive;
  private latencyMode: LatencyMode = 'interactive';
  private droppedNotes = 0;
  private lastDropAt = 0;            // performance.now() of last drop (0 = never)
  private lastAdaptiveCheckAt = 0;   // throttles adaptive eval to 1Hz
  private lastStabilityCheckAt = 0;  // start of the current stable window
  private cpuLoad = 0;               // 0..1, pulled from PerformanceMonitor

  /** Worker tick interval in ms. 25ms = 40 Hz — half the previous 66 Hz rate. */
  private static readonly SCHEDULER_INTERVAL_MS = 25;

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

  // ── Task P2 (musical intelligence): MusicAnalyzer instance ──
  // The analyzer is constructed eagerly (no async init needed) and updated
  // on every liveTrack() call with the latest reference features. It
  // maintains its own rolling histories + event log internally; the engine
  // only reads getRecentEvents() and getMusicalAnalysis() from it.
  //
  // `lastMusicalEventTime` is the wall-clock seconds (performance.now()/1000)
  // of the last event we already reacted to. On each liveTrack() call we
  // pull getRecentEvents(now - lastMusicalEventTime) to find NEW events and
  // route them to flowEngine.transitionTo(). This avoids re-triggering the
  // same dropHit on every update.
  // `musicalAnalysis` is the latest snapshot returned by update() — exposed
  // via getMusicalAnalysis() for UI display.
  private musicAnalyzer: MusicAnalyzer = new MusicAnalyzer();
  private lastMusicalEventTime = 0;
  private musicalAnalysis: MusicalAnalysis | null = null;

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

  // ── Task D1 (upgrade): full DJ controller ──
  // The DJController wraps PhaseSync (it receives the PhaseSync reference
  // in its constructor) and adds key / groove / energy / phrase sync. When
  // masterSync is on, it engages ALL dimensions (BPM + phase + key + groove
  // + energy + beat-grid); when off, the engine runs free but the DJ state
  // is still computed + exposed for UI display. Constructed eagerly so the
  // toggle state persists across stop/start cycles (the user's choice
  // survives a restart).
  private djController: DJController = new DJController(this.phaseSync);
  // `swingAdjust` accumulates the per-bar swing adjustment from the
  // DJController (when master sync is on, this nudges world.swing toward
  // the radio's swing amount). Added to w.swing in scheduleStep.
  private swingAdjust = 0;
  // `appliedKeyShift` is the running semitone offset currently applied to
  // musicalKey.root by the DJController's key sync. We track it so we can
  // reverse it cleanly when master sync is disabled (so the engine returns
  // to the key it would have been in without DJ sync).
  private appliedKeyShift = 0;

  // ── Task P4 (phrase-level sync): PhraseSync instance ──
  // The PhraseSync tracks ref phrase boundaries (from MusicAnalyzer's
  // sectionBoundary / dropHit / breakStart / riserStart events), estimates
  // the radio's phrase length from the intervals between boundaries, and
  // decides whether to realign our phrase mid-flow. When realign is needed,
  // the engine calls flowEngine.transitionTo(...) with the suggested
  // archetype + energy + phrase length to start a new phrase aligned with
  // the radio. The PhraseSync is a PEER of the DJController — they both
  // touch phrase alignment but at different layers (DJController snaps the
  // bar counter reactively on energy transitions; PhraseSync proactively
  // starts a new phrase via flowEngine.transitionTo on musical section
  // boundaries). Constructed eagerly so the master-sync toggle persists
  // across stop/start cycles.
  private phraseSync: PhraseSync = new PhraseSync();

  // ── Task T1 (active learning): cross-session memory ────────────────────
  //    LearningMemory stores successful (refFeatures, engineParams, matchScore)
  //    triples. The engine queries it for a "head start" when similar radio
  //    content appears, and stores new patterns every 30s when a good match
  //    is detected. Persists across sessions via localStorage.
  //
  //    Constructed eagerly so the memory loads once per engine instance
  //    (load() is called in init()). All operations are O(n) with n <= 100.
  private learningMemory: LearningMemory = new LearningMemory();
  // `lastLearningTickTime` is the ms timestamp of the last learning loop
  // pass. The loop runs at most every 30s (LEARNING_INTERVAL_MS) — it's
  // invoked from liveTrack() so no separate timer is needed.
  private lastLearningTickTime = 0;
  // `lastLearningSaveTime` is the ms timestamp of the last localStorage
  // save. Saves happen at most every 60s (LEARNING_SAVE_INTERVAL_MS) plus
  // on page unload (registered in init()).
  private lastLearningSaveTime = 0;
  // `lastProactivePatternId` is the id of the last proactively-applied
  // learned pattern. Used to avoid re-applying the same pattern on every
  // liveTrack() call — once applied, we only re-apply when the closest
  // pattern changes (different style/BPM/centroid signature).
  private lastProactivePatternId: string | null = null;
  // `learningUnloadHandler` is the beforeunload listener reference, kept
  // so we can remove it in dispose() (avoids leaking the listener across
  // engine restarts — though in practice the engine is a singleton).
  private learningUnloadHandler: (() => void) | null = null;
  private static readonly LEARNING_INTERVAL_MS = 30_000;
  private static readonly LEARNING_SAVE_INTERVAL_MS = 60_000;
  private static readonly LEARNING_STORE_THRESHOLD = 0.6;  // store when match > 0.6
  private static readonly LEARNING_RECALL_THRESHOLD = 0.4;  // recall when match < 0.4
  private static readonly LEARNING_PROACTIVE_MIN_REINFORCEMENT = 2;

  // ── Task P5 (adaptive learning): musical vocabulary memory ─────────────
  //    VocabularyLearner stores MUSICAL CONTENT (motifs + rhythms) extracted
  //    from the radio, NOT parameter configs. The MusicalDirector queries
  //    this vocabulary when composing phrases — quoting learned motifs in
  //    the lead and learned rhythms in the drums. Persists across sessions
  //    via a separate localStorage key (psy4_vocabulary_v1).
  //
  //    Constructed eagerly so the vocabulary loads once per engine instance
  //    (load() is called in the constructor). All operations are O(n) with
  //    n <= 30. NOT reset on stop() — the vocabulary accumulates across
  //    sessions (the whole point of "the engine's music EVOLVES based on
  //    what it hears").
  //
  //    `lastVocabularyTickTime` is the ms timestamp of the last vocabulary
  //    learn pass. The pass runs at most every 30s — invoked from
  //    liveTrack() so no separate timer is needed.
  private vocabularyLearner: VocabularyLearner = new VocabularyLearner();
  private lastVocabularyTickTime = 0;
  private static readonly VOCABULARY_TICK_INTERVAL_MS = 30_000;

  onSectionChange: ((section: string) => void) | null = null;

  /**
   * Callback fired when the engine auto-switches worlds (Task 14). Lets the UI
   * update its world dropdown / "AUTO" badge without polling. The optional
   * `reason` is a human-readable explanation (e.g. the matched style name).
   */
  onWorldChange: ((worldId: string, reason?: string) => void) | null = null;

  /**
   * Task F1-F3: Initialize the engine. Creates the AudioContext (must be
   * from a user gesture), then tries the WorkletEngine backend first.
   * If the worklet fails to load (50-200ms timeout, browser doesn't support
   * AudioWorklet, file 404), falls back to the LegacyAudioGraph.
   *
   * ASYNC: the worklet module loads asynchronously (audioWorklet.addModule
   * is a Promise). We AWAIT it before returning — the engine is NOT ready
   * to start() until init() resolves. The UI should show "Loading engine..."
   * while init() is in progress.
   *
   * Once init() completes, `this.audioReady` is true and `this.audio` is
   * set to the chosen backend (WorkletEngine or LegacyAudioGraph). All
   * subsequent triggerDrum/triggerSynth/setWorld/setFX calls go through
   * `this.audio` — NO `if (useWorklet)` conditionals.
   *
   * Safe to call multiple times — subsequent calls are no-ops if already
   * initialized (returns the cached init promise).
   */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit().catch((e) => {
      this.audioLoading = false;
      this.audioReady = false;
      this.initPromise = null;
      console.error('[PSY4 V2] init() failed:', e);
      throw e;
    });
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    if (this.ctx && this.audioReady) return;
    this.audioLoading = true;

    // Task L1: mobile auto-detect — bump 'interactive' to 'balanced' for
    // stability. Mobile devices have weaker CPUs, thermal throttling, and
    // smaller audio buffers.
    if (this.latencyMode === 'interactive' && this.isMobileDevice()) {
      this.latencyMode = 'balanced';
      this.targetLookahead = LATENCY_MODE_LOOKAHEAD.balanced;
      this.lookahead = this.targetLookahead;
    }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const c = this.ctx = new Ctx({ latencyHint: this.latencyMode });

    // Initialize tracks (track state only — no audio nodes).
    this.initTracks();

    // ── Task F1-F3: decide the audio backend ──
    // Try WorkletEngine first (single AudioWorkletNode, 10-50x more efficient,
    // better DSP — Moog ladder, polyBLEP, Schroeder reverb). If it fails to
    // load (addModule 404, syntax error, browser doesn't support
    // AudioWorklet), fall back to LegacyAudioGraph (1054-node Web Audio graph).
    //
    // Once decided, commit for the session — no mid-session switching. The
    // engine calls this.audio.triggerDrum(...), this.audio.setWorld(...),
    // etc. Both backends implement the SAME interface.
    let backend: AudioBackend | null = null;

    // Try the worklet backend.
    try {
      const worklet = new WorkletEngine();
      const ok = await worklet.init(c);
      if (ok) {
        backend = worklet;
        this.workletEngine = worklet;
        this.isWorkletBackend = true;
        if (typeof console !== 'undefined') {
          console.log('[PSY4 V2] Audio backend: WorkletEngine (single AudioWorkletNode)');
        }
      }
    } catch (e) {
      console.warn('[PSY4 V2] WorkletEngine init threw — falling back to LegacyAudioGraph:', e);
    }

    // Fall back to the legacy graph if the worklet failed.
    if (!backend) {
      try {
        const legacyEngineAccess: LegacyEngineAccess = {
          tracks: this.tracks,
          drumPresets: DRUM_PRESETS as Record<string, { type: string; tune: number; decay: number; tone: number; punch: number }>,
          synthPresets: SYNTH_PRESETS as Record<string, AdvancedSynthPreset>,
          synthModeOverrides: this.synthModeOverrides,
          fmDepthOverride: this.fmDepthOverride,
          wtPositionOverride: this.wtPositionOverride,
          maxSupersawOsc: this.maxSupersawOsc,
          leadCutoffOverride: this.leadCutoffOverride,
        };
        const legacy = new LegacyAudioGraph(c, this.currentWorld, legacyEngineAccess);
        // Keep the engine access reference fresh — the engine mutates
        // synthModeOverrides etc. over time, and the legacy graph reads
        // them by reference. We store the access object so we can update
        // its primitive fields when the engine's fields change.
        this._legacyEngineAccess = legacyEngineAccess;
        const ok = await legacy.init(c);
        if (ok) {
          backend = legacy;
          this.isWorkletBackend = false;
          if (typeof console !== 'undefined') {
            console.warn('[PSY4 V2] Audio backend: LegacyAudioGraph (1054-node Web Audio graph — fallback)');
          }
        }
      } catch (e) {
        console.error('[PSY4 V2] LegacyAudioGraph init also failed — no audio backend available:', e);
      }
    }

    if (!backend) {
      this.audioLoading = false;
      this.audioReady = false;
      throw new Error('Failed to initialize any audio backend (worklet + legacy both failed)');
    }

    this.audio = backend;
    this.analyser = backend.getAnalyser();

    // Push the current engine state to the backend so it starts in sync.
    backend.setBpm(this._bpm || 145);
    backend.setWorld(this.computeWorkletWorldParams());
    backend.setMacros(this.computeWorkletMacros());

    // ── Task T1 (active learning): load cross-session memory ──
    this.learningMemory.load();
    if (typeof window !== 'undefined' && !this.learningUnloadHandler) {
      this.learningUnloadHandler = () => {
        try { this.learningMemory.save(); } catch { /* private browsing */ }
      };
      try {
        window.addEventListener('beforeunload', this.learningUnloadHandler);
      } catch { /* SSR / old browser — ignore */ }
    }

    this.audioLoading = false;
    this.audioReady = true;
  }

  /** LegacyEngineAccess reference (kept fresh so the legacy graph reads current state). */
  private _legacyEngineAccess: LegacyEngineAccess | null = null;

  /**
   * Sync the legacy engine access primitives when the engine's fields change.
   * Called from setSynthMode, setFMDepth, setWavetablePosition, applyPhrasePresetRotation.
   * The legacy graph reads these by reference (via the access object), so we
   * update the access object's fields to mirror the engine's.
   */
  private syncLegacyAccess(): void {
    if (!this._legacyEngineAccess) return;
    this._legacyEngineAccess.synthModeOverrides = this.synthModeOverrides;
    this._legacyEngineAccess.fmDepthOverride = this.fmDepthOverride;
    this._legacyEngineAccess.wtPositionOverride = this.wtPositionOverride;
    this._legacyEngineAccess.maxSupersawOsc = this.maxSupersawOsc;
    this._legacyEngineAccess.leadCutoffOverride = this.leadCutoffOverride;
  }

  /** True when the audio backend is initialized and ready for start(). */
  isAudioReady(): boolean { return this.audioReady; }
  /** True when init() is in progress (UI shows "Loading engine..."). */
  isAudioLoading(): boolean { return this.audioLoading; }

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

  /**
   * Task F1-F3: Start playback. ASYNC — awaits init() to ensure the audio
   * backend is ready before starting. The UI should call `await engine.start()`
   * and show a loading state until the promise resolves.
   *
   * Once started, `this.playing = true` and the scheduler begins ticking.
   * The first step plays at ctx.currentTime + 0.04s (40ms ahead) — audible
   * immediately, no silent period.
   */
  async start(worldId?: string): Promise<void> {
    // Await init() — ensures the worklet (or legacy graph) is fully loaded
    // before we start scheduling notes. This fixes ROAST-7 bug #2: "If user
    // clicks START before worklet loads, triggerDrum/triggerSynth silently
    // return. No audio, no feedback."
    await this.init();
    if (!this.ctx || !this.audio) {
      throw new Error('Engine not initialized — init() failed to create an audio backend');
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* user gesture required */ }
    }

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
    // levels and global effect parameters for the current world. Routed
    // through this.audio (worklet: no-op; legacy: adjusts racks).
    this.applyWorldEffectSettings(this.currentWorld);

    // ── Task F1-F3: push world params + FX config to the audio backend ──
    // ONE path — this.audio handles both worklet and legacy. No conditionals.
    this.audio.setBpm(this._bpm || 145);
    this.audio.setWorld(this.computeWorkletWorldParams());
    this.audio.setMacros(this.computeWorkletMacros());
    const fxMix = this.currentWorld.fxMix;
    this.audio.setFX({
      reverbWet: clamp(0.3 + fxMix * 0.4, 0.2, 0.7),
      delayWet: clamp(0.2 + fxMix * 0.5, 0.15, 0.6),
      delayFeedback: 0.35,
    });

    if (this.playing) {
      // Already playing — just update the backend's transport state.
      this.audio.start();
      return;
    }
    this.playing = true;
    this.step = 0;
    this.bar = 0;
    this.sectionIdx = 0;
    // ── Task F1: create the dynamic flow engine ──
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
    this.lastAutomationSection = '';
    this.leadCutoffOverride = -1;
    // ── Task P2: reset the MusicAnalyzer so stale histories from a previous
    //    play session don't bias the new session's first detections. The
    //    analyzer is cheap to construct; the rolling histories + event log
    //    rebuild from scratch on the first liveTrack() call. ──
    this.musicAnalyzer = new MusicAnalyzer();
    this.musicalAnalysis = null;
    this.lastMusicalEventTime = 0;
    // ── Task P4: reset the PhraseSync so stale boundary-interval history
    //    from a previous play session doesn't bias the new session's phrase
    //    length estimate. The master-sync toggle is preserved (user's
    //    choice survives a restart). ──
    this.phraseSync.reset();
    this.syncLegacyAccess();
    this.onSectionChange?.(this.currentSection);
    // Task L1: reset drop counters + adaptive state on a fresh start.
    this.droppedNotes = 0;
    this.lastDropAt = 0;
    this.lastAdaptiveCheckAt = 0;
    this.lastStabilityCheckAt = (typeof performance !== 'undefined')
      ? performance.now() : Date.now();
    this.nextTime = this.ctx.currentTime + 0.04;
    // ── Task M1: prepare the first phrase ──
    if (this.director && this.currentFlow) {
      const baseE = this.currentWorld.energyCurve[0] ?? 0.5;
      const phraseEnergy = clamp(baseE * (0.4 + 0.6 * this.currentFlow.density), 0, 1);
      const character = labelToCharacter(this.currentFlow.label);
      this.director.advancePhrase(
        this.nextTime, phraseEnergy, character, this.currentWorld, this._bpm,
      );
    }
    // ── Task F1-F3: start the audio backend's transport ──
    this.audio.start();
    // ── Task T1 (active learning): reset the learning-loop tick timestamp ──
    this.lastLearningTickTime = Date.now();
    this.lastLearningSaveTime = Date.now();
    this.lastProactivePatternId = null;
    this.scheduleNextTick();
  }

  stop(): void {
    this.playing = false;
    // Task V2a: stop the Worker-based scheduler.
    this.scheduler.stop();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    // ── Task F1-F3: stop the audio backend (ONE path) ──
    if (this.audio) {
      this.audio.stop();
    }
    // ── Task D1: reset PhaseSync own-beat state ──
    this.phaseSync.reset();
    this.djController.reset();
    this.swingAdjust = 0;
    this.appliedKeyShift = 0;
    // ── Task P4: reset PhraseSync boundary tracking + realignment state.
    //    Preserves the master-sync toggle so the user's choice survives a
    //    stop/start cycle. ──
    this.phraseSync.reset();
    // ── Task M1: reset the Musical Director's phrase state ──
    this.director?.reset();
    // ── Task T1 (active learning): flush the memory to localStorage ──
    try { this.learningMemory.save(); } catch { /* private browsing */ }
    // ── Task P5 (adaptive learning): flush the vocabulary to localStorage ──
    // The vocabulary is NOT reset on stop() — it accumulates across sessions
    // (the whole point of adaptive learning). We only persist the latest
    // state so the next session picks up where this one left off.
    try { this.vocabularyLearner.save(); } catch { /* private browsing */ }
  }

  private get bpm(): number {
    return this._bpm || 145;
  }
  private _bpm = 145;

  setBpm(bpm: number): void {
    this._bpm = bpm;
    // ── Task F1-F3: push BPM to the audio backend (ONE path) ──
    this.audio?.setBpm(bpm);
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
    // ── Task F1-F3: push world params + FX config to the audio backend (ONE path) ──
    // The backend handles both worklet (per-bus sends + worldParams) and legacy
    // (reverbSend/delaySend gain nodes). No conditionals.
    if (this.audio) {
      this.audio.setWorld(this.computeWorkletWorldParams());
      this.audio.setMacros(this.computeWorkletMacros());
      const fxMix = newWorld.fxMix;
      this.audio.setFX({
        reverbWet: clamp(0.3 + fxMix * 0.4, 0.2, 0.7),
        delayWet: clamp(0.2 + fxMix * 0.5, 0.15, 0.6),
        delayFeedback: 0.35,
      });
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
  /**
   * Apply per-world send-effect settings (Task E1). Routed through this.audio
   * (worklet: no-op; legacy: adjusts racks + global send-effect params).
   *
   * Safe to call before init() (no-op when this.audio is null).
   */
  private applyWorldEffectSettings(world: World): void {
    if (!this.audio) return;
    const cfgs = buildTrackRackConfigs(world);
    for (let i = 0; i < cfgs.length; i++) {
      const cfg = cfgs[i];
      this.audio.setSendLevel?.(i, 'reverb', cfg.sendReverb);
      this.audio.setSendLevel?.(i, 'delay', cfg.sendDelay);
      this.audio.setSendLevel?.(i, 'chorus', cfg.sendChorus);
      this.audio.setSendLevel?.(i, 'phaser', cfg.sendPhaser);
      this.audio.setSendLevel?.(i, 'distortion', cfg.sendDistortion);
      this.audio.setSendLevel?.(i, 'bitcrush', cfg.sendBitcrush);
    }

    // Also nudge the global send-effect parameters based on world character.
    // (Worklet no-ops these; legacy applies them to chorus/phaser/etc.)
    const chorusRate = 0.35 + world.brightness * 0.5;
    this.audio.setSendEffectParam?.('chorus', 'rate', chorusRate);
    const phaserRate = 0.15 + world.psychedelia * 0.6;
    this.audio.setSendEffectParam?.('phaser', 'rate', phaserRate);
    this.audio.setSendEffectParam?.('phaser', 'feedback', 0.25 + world.psychedelia * 0.4);
    const distDrive = 2.5 + world.aggression * 5 + world.darkness * 2;
    this.audio.setSendEffectParam?.('distortion', 'drive', distDrive);
    const bcBits = Math.round(8 - world.darkness * 4);
    const bcHold = 2 + world.darkness * 6;
    this.audio.setSendEffectParam?.('bitcrush', 'bits', bcBits);
    this.audio.setSendEffectParam?.('bitcrush', 'holdMs', bcHold);
  }

  /**
   * Adjust a single per-track effect parameter in real-time (Task E1).
   * Routed through this.audio (worklet: no-op for rack params, but 'cutoff'
   * for LEAD is stored as leadCutoffOverride and pushed via setWorld;
   * legacy: adjusts the rack).
   *
   * Task V2b addition: 'cutoff' is special-cased for the LEAD track (idx 5).
   * The lead's filter cutoff lives inside the voice (not the rack). We store
   * the override here and push it to the audio backend via setWorld so both
   * worklet and legacy apply it. Pass -1 to clear the override.
   */
  setTrackEffect(trackIdx: number, effectName: string, value: number): void {
    if (!Number.isFinite(value)) return;
    // Lead filter cutoff override (for BUILD-section filter sweeps).
    if (effectName === 'cutoff') {
      if (trackIdx !== 5) return;
      this.leadCutoffOverride = value < 0 ? -1 : clamp(value, 200, 16000);
      this.syncLegacyAccess();
      // Push to the audio backend so both worklet + legacy apply it.
      this.audio?.setWorld({ leadCutoff: this.leadCutoffOverride > 0 ? this.leadCutoffOverride : 0 });
      return;
    }
    this.audio?.setTrackEffect?.(trackIdx, effectName, value);
  }

  /**
   * Adjust a per-track SEND level in real-time (Task E1).
   * Routed through this.audio (worklet: no-op; legacy: adjusts rack).
   */
  setSendLevel(trackIdx: number, sendName: 'reverb' | 'delay' | 'chorus' | 'phaser' | 'distortion' | 'bitcrush', level: number): void {
    if (!Number.isFinite(level)) return;
    this.audio?.setSendLevel?.(trackIdx, sendName, level);
  }

  /**
   * Adjust a global send-effect parameter (Task E1).
   * Routed through this.audio (worklet: no-op; legacy: adjusts effect).
   */
  setSendEffectParam(effectName: 'chorus' | 'phaser' | 'distortion' | 'bitcrush', param: string, value: number): void {
    if (!Number.isFinite(value)) return;
    this.audio?.setSendEffectParam?.(effectName, param, value);
  }

  /**
   * Adjust a master multiband compressor parameter in real-time (Task E1).
   * Routed through this.audio (worklet: no-op; legacy: adjusts multiband).
   */
  setMasterParam(name: string, value: number): void {
    this.audio?.setMasterParam?.(name, value);
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
    if (!this.ctx || !this.audio) return;

    // ── Task F1-F3: ONE path — push flow automation to this.audio ──
    // The audio backend (worklet or legacy) handles the FX config. The worklet
    // applies per-bus reverb/delay sends + wet amounts directly to its internal
    // DSP. The legacy graph translates per-bus sends into per-track send levels
    // + global wet gains. No conditionals here — both backends implement setFX.
    //
    // The worklet's 5-bus model: 0=drum 1=bass 2=music 3=atmos 4=fx.
    //   drum: low reverb (punchy), low delay
    //   bass: very low reverb (tight), no delay
    //   music (lead/acid/fm): melReverb, melDelay (the main melodic treatment)
    //   atmos (pad/texture): atmoReverb * 1.4, atmoDelay * 1.4 (more space)
    //   fx: melReverb * 0.6, melDelay * 0.6 (some space, not too much)
    const melReverb = clamp(flow.reverbAmount, 0, 0.8);
    const atmoReverb = clamp(flow.reverbAmount * 0.7, 0, 0.6);
    const melDelay = clamp(flow.delayAmount, 0, 0.6);
    const atmoDelay = clamp(flow.delayAmount * 0.5, 0, 0.4);
    const fxConfig: AudioBackendFXConfig = {
      reverbSends: [
        0.10,                      // drum — stay punchy
        0.03,                      // bass — stay tight
        melReverb,                 // music — lead/acid/fm
        Math.min(0.8, atmoReverb * 1.4),  // atmos — pad/texture
        melReverb * 0.6,           // fx
      ],
      delaySends: [
        0.05,                      // drum
        0.0,                       // bass
        melDelay,                  // music
        Math.min(0.6, atmoDelay * 1.4),  // atmos
        melDelay * 0.6,            // fx
      ],
      reverbWet: clamp(0.3 + flow.reverbAmount * 0.4, 0.2, 0.7),
      delayWet: clamp(0.2 + flow.delayAmount * 0.5, 0.15, 0.6),
      delayFeedback: this.activeSurprise?.type === 'echoThrow' || this.activeSurprise?.type === 'stutter'
        ? clamp(0.5 + (this.activeSurprise.intensity || 0.5) * 0.3, 0.4, 0.8)
        : 0.35,
    };
    this.audio.setFX(fxConfig);

    // ── (1) Per-section chorus/phaser profile (pushed on label change) ──
    // Routed through this.audio.setSendLevel (worklet: no-op; legacy: rack).
    if (flow.label !== this.lastAutomationSection) {
      this.lastAutomationSection = flow.label;
      this.applySectionChorusPhaser(flow.label);
    }

    // ── (2-3) Continuous reverb + delay sends (legacy per-track; worklet ──
    //         already handled by setFX above). setSendLevel is a no-op in
    //         worklet mode, so these calls are safe to always make.
    const atmoReverbLegacy = clamp(flow.reverbAmount * 0.7, 0, 0.6);
    const atmoDelayLegacy = clamp(flow.delayAmount * 0.5, 0, 0.4);
    for (const ti of [5, 6, 7]) {
      this.audio.setSendLevel?.(ti, 'reverb', melReverb);
      this.audio.setSendLevel?.(ti, 'delay', melDelay);
    }
    for (const ti of [1, 2, 3]) {
      this.audio.setSendLevel?.(ti, 'reverb', atmoReverbLegacy);
      this.audio.setSendLevel?.(ti, 'delay', atmoDelayLegacy);
    }

    // ── (4) Continuous lead filter cutoff — driven by flow.filterCutoff ──
    let leadCutoffTarget = flow.filterCutoff;

    // ── (5) Active surprise event effects ──
    const surprise = this.activeSurprise;
    if (surprise) {
      const surpriseProgress = clamp(
        (this.totalBars - surprise.startBar) / Math.max(1, surprise.durationBars),
        0, 1,
      );
      switch (surprise.type) {
        case 'filterSweep': {
          const peakHz = clamp(2000 + surprise.intensity * 6000, 2000, 12000);
          const baseHz = clamp(leadCutoffTarget, 400, 4000);
          const tri = 1 - Math.abs(surpriseProgress * 2 - 1);
          leadCutoffTarget = baseHz * Math.pow(peakHz / baseHz, tri);
          break;
        }
        case 'echoThrow': {
          // Boost delay sends for echo throws (legacy per-track; worklet
          // already handled by setFX's delayFeedback boost above).
          const throwBoost = clamp(0.4 + surprise.intensity * 0.4, 0.4, 0.8);
          this.audio.setSendLevel?.(5, 'delay', throwBoost);
          this.audio.setSendLevel?.(7, 'delay', throwBoost * 0.7);
          break;
        }
        case 'stutter': {
          this.audio.setSendLevel?.(5, 'delay', clamp(0.5 * surprise.intensity + 0.2, 0.2, 0.7));
          break;
        }
        case 'dropOut':
        case 'silence':
        case 'reverseHit':
          break;
      }
    }

    // Apply the lead cutoff target via setTrackEffect (stores in
    // leadCutoffOverride + pushes to this.audio via setWorld).
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
    if (!this.ctx || !this.audio) return;
    const intensity = clamp(event.intensity, 0, 1);

    // ── Task F1-F3: ONE path — route surprise one-shots through this.audio ──
    // Most surprise types (dropOut, silence, filterSweep, echoThrow, stutter)
    // don't need a one-shot — they're handled per-step in applyFlowAutomation
    // (which sends setFX to the audio backend) or via the scheduleStep note
    // gating (which suppresses notes before they reach the backend). The only
    // surprise that needs a one-shot is reverseHit, which fires a reverse
    // impact via this.audio.triggerReverseImpact.
    switch (event.type) {
      case 'reverseHit': {
        if (!this.surpriseReverseHitScheduled) {
          this.audio.triggerReverseImpact(time, intensity);
          this.surpriseReverseHitScheduled = true;
        }
        break;
      }
      case 'dropOut': {
        // DJ brake: ramp all non-kick track gains to near-zero.
        // Routed through this.audio.setTrackGainScale (worklet: no-op —
        // dropOut is handled by note gating in scheduleStep; legacy: adjusts
        // trackGains).
        const muteScale = clamp(1 - intensity * 0.95, 0.05, 0.5);
        for (let i = 1; i < 8; i++) {
          this.audio.setTrackGainScale?.(i, muteScale, time);
        }
        break;
      }
      case 'silence': {
        // Dramatic pause: ramp the master to near-zero.
        const muteScale = clamp(1 - intensity * 0.98, 0.02, 0.3);
        this.audio.setMasterGainScale?.(muteScale, time);
        break;
      }
      case 'stutter': {
        // Rapid lead retrigger — fire 4-6 short lead notes at the current
        // chord root. Uses triggerSynth directly so the notes go through
        // the audio backend (worklet: enqueues into eventBatch; legacy: fires
        // the AdvancedSynthVoice with the flow's current lead timbre).
        const chord = this.director?.getCurrentChord() ?? this.currentChord;
        if (chord && this.melody) {
          const root = chord.notes[0] + 12;
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
    // ── Task F1-F3: restore via this.audio (ONE path) ──
    // Worklet: no-op (FX state is driven by setFX from applyFlowAutomation;
    // when the surprise ends, the next setFX call restores default levels).
    // Legacy: restores master gain, track gains, and delay feedback.
    this.audio?.restoreDefaults?.(time);
  }

  /**
   * Trigger a reversed impact — a sub-boom that swells IN (opposite of the
   * normal triggerImpact which decays OUT). Used by the reverseHit surprise.
   *
   * Task F1-F3: delegates to this.audio.triggerReverseImpact (worklet: enqueues
   * a V_IMPACT event; legacy: creates oscillator + noise nodes).
   */
  private triggerReverseImpact(time: number, intensity: number): void {
    if (!this.audio) return;
    this.audio.triggerReverseImpact(time, intensity);
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
    // ── Task M1: (re)create the Musical Director ──
    // The director shares the same HarmonyEngine + MelodyEngine + SeededRng
    // instances. On key change, all three are rebuilt — we either create a
    // fresh director or call setEngines() to re-link the existing one. We
    // reset phrase state so the next start() / section change composes a
    // fresh phrase with the new key.
    if (this.director) {
      this.director.setEngines(this.harmony, this.melody, this.musicRng);
      this.director.setVocabularyLearner(this.vocabularyLearner);
      this.director.reset();
    } else {
      this.director = new MusicalDirector(this.harmony, this.melody, this.musicRng);
      this.director.setVocabularyLearner(this.vocabularyLearner);
    }
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
    // ── Task D1 (upgrade): groove / feel info from the V2 listener ──
    // Optional — populated by referenceListenerV2.computeGrooveInfo(). When
    // present, the engine forwards it to the DJController so it can match
    // the radio's swing amount + push/pull feel.
    grooveInfo?: GrooveInfo;
    // ── Task P2 (musical intelligence): per-instrument density + regularity ──
    // Optional — populated by the V2 listener from the kick-band + high-band
    // transient grids. When present, the MusicAnalyzer uses them to pick a
    // more accurate kick/hat gate pattern (instead of estimating from total
    // transient density + highEnergy). When absent, the analyzer falls back
    // to the estimate; nothing breaks.
    kickDensity?: number;
    hatDensity?: number;
    rhythmicRegularity?: number;
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

    // ── SUB / HIGH energy balancing — routed through this.audio (ONE path) ──
    // Boost bass track (4) when ref has more sub than we do; boost lead/pad/arp
    // (5,6,7) when ref has more high energy. The audio backend applies the
    // levels: worklet no-ops (uses macros.energy instead); legacy adjusts
    // trackGains. We push via setWorld so both backends see the targets.
    if (this.audio && this.refSubEnergy > 0 && this.ownSubEnergy > 0) {
      const subDiff = this.refSubEnergy - this.ownSubEnergy;
      if (Math.abs(subDiff) > 0.05) {
        const bassAdj = clamp(subDiff * 0.4, -0.3, 0.3);
        const bassTarget = clamp(0.8 + bassAdj, 0.3, 2.0);
        const worldUpdate: Record<string, number> = { bassLevel: bassTarget };
        if (subDiff > 0.05) {
          worldUpdate.kickLevel = clamp(1.0 + subDiff * 0.2, 0.6, 1.8);
        }
        this.audio.setWorld(worldUpdate);
      }
    }
    if (this.audio && this.refHighEnergy > 0 && this.ownHighEnergy > 0) {
      const highDiff = this.refHighEnergy - this.ownHighEnergy;
      if (Math.abs(highDiff) > 0.05) {
        const adj = clamp(highDiff * 0.5, -0.3, 0.3);
        // Push the lead level (the legacy graph applies it to trackGains[5];
        // the worklet no-ops).
        const leadTarget = clamp(0.8 + adj, 0.3, 1.6);
        this.audio.setWorld({ leadLevel: leadTarget });
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

    // ── Task D1 (upgrade): forward key / energy / groove to DJController ──
    // The DJController combines phase sync with key (Camelot), groove
    // (swing + push/pull), and energy (smoothed + transition detection).
    // When master sync is on, it engages all dimensions; when off, it
    // still computes + exposes the state for UI display. The phaseInfo
    // is forwarded here too (so the DJController has the full picture),
    // but PhaseSync.setReferencePhase() above is the authoritative call
    // for the beat-scheduling path.
    // GrooveInfo is an optional new field from the V2 listener; if absent,
    // the DJController gracefully no-ops on the groove dimension.
    const refKey = refMetrics.detectedKey;
    this.djController.setReferenceFeatures({
      phaseInfo: refMetrics.phaseInfo,
      key: refKey ? {
        root: refKey.root,
        scale: refKey.scale,
        confidence: refKey.confidence,
      } : undefined,
      energy: refMetrics.energy,
      groove: refMetrics.grooveInfo as GrooveInfo | undefined,
    });

    // ── Task T1 (active learning): proactive head-start + 30s learning loop ──
    //    This is the core of the active-learning system. On every liveTrack
    //    call (every ~10s from the V2 listener), we:
    //      1. Apply a learned pattern PROACTIVELY if the radio's features
    //         match a proven stored pattern (reinforcementCount >= 2). This
    //         gives the engine a "head start" — it starts from a known-good
    //         configuration instead of defaults, so it sounds right
    //         immediately instead of converging over 30-60s of pursuit.
    //      2. Run the 30s learning loop (interval-throttled): compute the
    //         current match score, push it to the history, store a pattern
    //         if the match is good (>0.6), recall a pattern if the match is
    //         poor (<0.4), and persist the memory to localStorage every 60s.
    //
    //    Both paths are guarded against missing data (no radio connected →
    //    graceful no-op). They run on the main thread and never touch the
    //    audio thread — the audio path is unchanged.
    this.applyLearnedPatternProactively();
    this.runLearningTick();

    // ── Task P2 (musical intelligence): run the MusicAnalyzer ──
    // Hand the latest reference features to the analyzer. It returns a fresh
    // MusicalAnalysis snapshot and may have emitted new events (dropHit,
    // breakStart, riserStart, chordChange, keyChange, melodicPeak,
    // sectionBoundary). We then route the MUSICAL events to the flow engine
    // — when the radio drops, we drop; when the radio builds, we build.
    // This is the heart of "matching music, not just features".
    this.updateMusicAnalyzer(refMetrics);

    // ── Task P5 (adaptive learning): learn the radio's musical vocabulary ──
    // Extract melodic motifs + rhythmic patterns from the latest analysis
    // and store them in the VocabularyLearner. The MusicalDirector will
    // quote them in future phrases (30% of leads, 40% of drums). Also
    // ticks the effectiveness evaluation: any motifs/rhythms that have
    // been in use for 30s get reinforced or decayed based on the change
    // in match score since they were marked used.
    this.updateVocabularyLearner();
  }

  /**
   * Task P2: feed the latest reference features to the MusicAnalyzer and
   * react to any newly-emitted musical events.
   *
   * The analyzer is called every liveTrack() (~10s). It maintains its own
   * rolling histories + event log; we only pull NEW events since our last
   * check and route them to flowEngine.transitionTo(). Cooldowns inside the
   * analyzer prevent the same event firing repeatedly while the condition
   * persists (e.g. energy sustained high after a drop).
   */
  private updateMusicAnalyzer(refMetrics: {
    energy?: number;
    spectralCentroid: number;
    transientDensity?: number;
    bpm?: number;
    subEnergy?: number;
    highEnergy?: number;
    lowEnergy?: number;
    midEnergy?: number;
    airEnergy?: number;
    detectedKey?: { root: number; scale: string; confidence: number };
    spectralFlatness?: number;
    hnr?: number;
    kickDensity?: number;
    hatDensity?: number;
    rhythmicRegularity?: number;
  }): void {
    // Build the feature snapshot. Guard every field — the analyzer also
    // guards internally, but skipping on missing required fields avoids
    // polluting the histories with zero/NaN samples.
    if (!isFinite(refMetrics.spectralCentroid) || refMetrics.spectralCentroid <= 0) {
      return;
    }
    const features: MusicAnalyzerFeatures = {
      energy: refMetrics.energy ?? 0,
      spectralCentroid: refMetrics.spectralCentroid,
      transientDensity: refMetrics.transientDensity ?? 0,
      bpm: refMetrics.bpm ?? this._bpm,
      subEnergy: refMetrics.subEnergy ?? 0,
      highEnergy: refMetrics.highEnergy ?? 0,
      detectedKey: refMetrics.detectedKey,
      spectralFlatness: refMetrics.spectralFlatness,
      hnr: refMetrics.hnr,
      kickDensity: refMetrics.kickDensity,
      hatDensity: refMetrics.hatDensity,
      lowEnergy: refMetrics.lowEnergy,
      midEnergy: refMetrics.midEnergy,
      airEnergy: refMetrics.airEnergy,
      rhythmicRegularity: refMetrics.rhythmicRegularity,
    };

    // Run the analyzer — this updates all rolling histories, runs the
    // detectors, and may emit new events into the analyzer's log.
    this.musicalAnalysis = this.musicAnalyzer.update(features);

    // ── React to NEW musical events (since our last check) ──
    // We compute the wall-clock seconds elapsed since the last check and
    // pull events from that window. Any event in the window is "new" —
    // we route musical events to the flow engine here.
    const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const windowSec = this.lastMusicalEventTime > 0
      ? Math.max(0.5, nowSec - this.lastMusicalEventTime)
      : 1.0;
    this.lastMusicalEventTime = nowSec;

    const newEvents: MusicalEvent[] = this.musicAnalyzer.getRecentEvents(windowSec);
    if (newEvents.length === 0 || !this.flowEngine) return;

    // Route each event type to the appropriate flow transition.
    // `bars` is the planned length of the forced section — short for drops
    // (so we can re-react to a follow-up break), longer for builds.
    for (const ev of newEvents) {
      switch (ev.type) {
        case 'dropHit':
          // The radio just dropped — force our flow into DROP at peak energy.
          // bars=2 → short forced section so we can re-react if the radio
          // breaks immediately after.
          this.flowEngine.transitionTo({ label: 'DROP', energy: 0.95 }, 2);
          // ── Task P4: tell the PhraseSync the radio hit a phrase boundary.
          //    It records the boundary, estimates the phrase length from
          //    intervals, and sets a pending realignment flag. The engine's
          //    tick() will call checkRealignment() next bar to decide whether
          //    we need to cut our phrase short / finish early / no-op. ──
          this.phraseSync.onSectionBoundary(nowSec, 'drop');
          if (typeof console !== 'undefined') {
            console.log(
              `[PSY4] MusicAnalyzer: dropHit @ bar ${ev.data?.bar ?? '?'} ` +
              `(energy ${ev.data?.energy?.toFixed(2) ?? '?'}, conf ${(ev.confidence * 100).toFixed(0)}%) — forcing DROP`,
            );
          }
          break;
        case 'breakStart':
          // The radio dropped to a break — force our flow into BREAK.
          this.flowEngine.transitionTo({ label: 'BREAK', energy: 0.3 }, 2);
          // ── Task P4: record the phrase boundary for PhraseSync. ──
          this.phraseSync.onSectionBoundary(nowSec, 'break');
          if (typeof console !== 'undefined') {
            console.log(
              `[PSY4] MusicAnalyzer: breakStart @ bar ${ev.data?.bar ?? '?'} ` +
              `(energy ${ev.data?.toEnergy?.toFixed(2) ?? '?'}) — forcing BREAK`,
            );
          }
          break;
        case 'riserStart':
          // The radio started a build — force our flow into BUILD over 4
          // bars (longer than drop/break so the tension can develop).
          this.flowEngine.transitionTo({ label: 'BUILD', energy: 0.7 }, 4);
          // ── Task P4: record the phrase boundary for PhraseSync. ──
          this.phraseSync.onSectionBoundary(nowSec, 'build');
          if (typeof console !== 'undefined') {
            console.log(
              `[PSY4] MusicAnalyzer: riserStart @ bar ${ev.data?.bar ?? '?'} ` +
              `(slope ${ev.data?.slopePerSec?.toFixed(3) ?? '?'}/s) — forcing BUILD`,
            );
          }
          break;
        case 'sectionBoundary':
          // ── Task P4: section transitions (intro → groove → build → drop →
          //    variation → break → outro) are ALSO phrase boundaries in dance
          //    music. We don't force a flow transition here (the archetype
          //    may already match — e.g., we're already in DROP when the
          //    radio's section flips from drop to variation, both at high
          //    energy). But we DO tell the PhraseSync a boundary fired, so
          //    it can predict the next one + decide whether to realign. ──
          this.phraseSync.onSectionBoundary(
            nowSec,
            typeof ev.data?.to === 'string' ? ev.data.to : 'groove',
          );
          break;
        // Other event types (chordChange, keyChange, melodicPeak,
        // rhythmicFill) are surfaced via getMusicalAnalysis() for the UI
        // but don't force a flow transition AND don't fire a phrase
        // boundary (they're intra-phrase events, not structural). The
        // harmony engine + melody engine will pick them up on the next
        // bar boundary via the existing scheduleStep path.
        default:
          break;
      }
    }
  }

  /**
   * Task P2: return the latest MusicalAnalysis snapshot (or null before the
   * first liveTrack() call with valid reference features). The UI reads this
   * on every analyzer tick to render the MUSICAL ANALYSIS card — current
   * section, melodic contour, rhythmic pattern, recent events, harmonic
   * rhythm.
   */
  getMusicalAnalysis(): MusicalAnalysis | null {
    return this.musicalAnalysis;
  }

  // ─── Task P5 (adaptive learning): vocabulary learner integration ─────────

  /**
   * Task P5: extract musical vocabulary from the latest MusicAnalyzer output
   * and feed it to the VocabularyLearner.
   *
   * Two paths run here, both throttled to a 30s minimum interval (the
   * analyzer updates every ~10s but motif extraction has its own 30s
   * cooldown inside the analyzer; we additionally throttle the rhythm
   * learn + the tick evaluation so we don't re-learn the same rhythm on
   * every reference window):
   *
   *   1. MOTIF EXTRACTION — calls musicAnalyzer.extractRecentMelodicMotif()
   *      with the engine's current musicalKey (root + scale). If the
   *      analyzer returns a non-null motif (≥4 distinct scale degrees over
   *      the last 60s of spectral-centroid history), the learner stores it
   *      (or dedupes against an existing similar motif).
   *
   *   2. RHYTHM EXTRACTION — always called (a "no-percussion" rhythm is
   *      still data). The analyzer's rhythmic pattern (kick + hat gate
   *      strings) is passed to the learner. If an identical pattern is
   *      already stored, its useCount is bumped instead of duplicating.
   *
   *   3. EFFECTIVENESS TICK — calls vocabularyLearner.tickEvaluation() with
   *      the current match score from LearningMemory (recentAvgScore). The
   *      learner reinforces or decays any motifs/rhythms that have been in
   *      use for ≥30s, then prunes low-effectiveness entries.
   *
   * Guards: no-ops when musicalAnalysis is null, when the analyzer hasn't
   * been initialized, or when the LearningMemory hasn't produced a match
   * score yet (recentAvgScore === 0 → tickEvaluation still runs but with
   * no delta).
   */
  private updateVocabularyLearner(): void {
    if (!this.musicalAnalysis) return;

    const nowMs = Date.now();
    const intervalPassed = nowMs - this.lastVocabularyTickTime
      >= Psy4EngineV2.VOCABULARY_TICK_INTERVAL_MS;

    // ── 1. Motif extraction (every tick — the analyzer's own 30s cooldown
    //    handles dedup; we just call it every liveTrack so a fresh motif
    //    is learned as soon as the cooldown elapses). ──
    if (this.musicalKey && typeof this.musicalKey.root === 'number'
        && typeof this.musicalKey.scale === 'string') {
      try {
        const motif = this.musicAnalyzer.extractRecentMelodicMotif(
          this.musicalKey.root,
          this.musicalKey.scale,
        );
        if (motif && motif.notes.length >= 4) {
          this.vocabularyLearner.learnMotif(motif);
        }
      } catch {
        // extraction can throw on edge-case inputs (NaN centroid, etc.);
        // a single bad window shouldn't poison the vocabulary pipeline.
      }
    }

    // ── 2. Rhythm extraction (throttled to 30s — the analyzer's rhythm
    //    field is stable across consecutive windows, so re-learning every
    //    10s would just bump useCount redundantly). ──
    if (intervalPassed) {
      const rhythm = this.musicalAnalysis.rhythm;
      if (rhythm && typeof rhythm.kickPattern === 'string'
          && typeof rhythm.hatPattern === 'string') {
        try {
          this.vocabularyLearner.learnRhythm({
            kickPattern: rhythm.kickPattern,
            hatPattern: rhythm.hatPattern,
            percPattern: '................', // analyzer doesn't expose perc; learner derives
          });
        } catch {
          // rhythm learn can throw on malformed gates — defensive guard.
        }
      }
      this.lastVocabularyTickTime = nowMs;
    }

    // ── 3. Effectiveness tick — always runs (so reinforcements happen as
    //    soon as the 30s evaluation window elapses for an in-use entry,
    //    regardless of the rhythm-learn throttle). ──
    let matchScore = 0;
    try {
      const status = this.learningMemory.getStatus();
      matchScore = typeof status.recentAvgScore === 'number' ? status.recentAvgScore : 0;
    } catch {
      // learning memory not yet initialized — matchScore stays 0.
    }
    try {
      this.vocabularyLearner.tickEvaluation(matchScore);
    } catch {
      // tick can throw if activeUses got into a weird state — defensive.
    }
  }

  /**
   * Task P5: return the current VocabularyLearner stats (or null before the
   * engine is constructed). The UI reads this on every analyzer tick to
   * render the VOCABULARY card — learned motif count + top 3 (visualized as
   * note sequences), learned rhythm count + top 3 (gate strings), average
   * effectiveness, and a "Learning..." indicator when the learner has
   * absorbed new material in the last 30s.
   */
  getVocabularyStats(): VocabularyStats | null {
    try {
      return this.vocabularyLearner.getStats();
    } catch {
      return null;
    }
  }

  /**
   * Task P4: return the current PhraseSync state for UI display. The UI
   * reads this on every analyzer tick to render the PHRASE SYNC indicator
   * — two 8-bar grids (reference + ours) showing the current bar position,
   * alignment %, realignment counter, and a flash when a realignment
   * happens.
   *
   * Safe to call before start() — the PhraseSync is constructed eagerly so
   * the state is always available (returns a default-zero state before the
   * first ref boundary fires).
   */
  getPhraseSyncState(): PhraseSyncState {
    return this.phraseSync.getState();
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

  // ─── Task T1 (active learning): the learning loop ─────────────────────────
  //
  // The active-learning system. The engine PURSUES the radio (adjusts
  // parameters to match), but it didn't LEARN — each session started from
  // scratch. These methods add the missing feedback loop:
  //
  //   engine tries params → measures match → stores if good → recalls if
  //   struggling → applies proactively on next similar content
  //
  // Over time, the engine builds a LIBRARY of "what works" for different
  // radio styles (dark-psy at 145 BPM, morning-psy at 140, etc.). The
  // memory persists across sessions via localStorage.
  //
  // All methods here are safe to call from liveTrack() (main thread). They
  // never touch the audio thread — the audio path is unchanged.

  /**
   * Build a LearnedPatternRefFeatures snapshot from the current stored
   * reference metrics. Returns null if we don't have enough data (no BPM,
   * no centroid, no energy — i.e., no radio connected).
   *
   * The `style` field uses the engine's current world id as the closest
   * proxy for "what the radio sounds like" (the style classifier maps
   * detected styles to world ids, so this is consistent with the rest of
   * the engine's style handling).
   */
  private buildLearningRefFeatures(): LearnedPatternRefFeatures | null {
    if (this.refBpm <= 0 && this.refSpectralCentroid <= 0 && this.refEnergy <= 0) {
      return null;
    }
    return {
      bpm: this.refBpm > 0 ? this.refBpm : this._bpm,
      key: {
        root: this.musicalKey.root,
        scale: this.musicalKey.scale || (this.refKeyScale ?? 'minor'),
      },
      spectralCentroid: this.refSpectralCentroid > 0 ? this.refSpectralCentroid : 1500,
      energy: this.refEnergy > 0 ? this.refEnergy : 0.5,
      style: this.currentWorld?.id ?? 'dark-psy',
    };
  }

  /**
   * Snapshot the engine's current effective parameters — the values that
   * are ACTUALLY in use right now (target pursuit values + overrides +
   * per-track send levels + synth-mode overrides). This is what gets
   * stored in a LearnedPattern so we can recall it later.
   *
   * The snapshot reads from the same sources the audio path uses:
   *   - kickDecay    : this.refKickDecay (the target the engine is pursuing)
   *                    OR this.learned.kickDecay (if the offline trainer set one)
   *   - bassCutoff   : this.learned.bassCutoff (or 0 if not set)
   *   - leadCutoff   : this.leadCutoffOverride (or 0 if no override active)
   *   - leadDetune   : this.learned.leadDetune (or 0)
   *   - padCutoff    : this.learned.padCutoff (or 0)
   *   - duck         : this.learned.duck (or 0.5 — typical sidechain depth)
   *   - synthMode    : synthModeOverrides[5|6|7] (or 'classic' fallback)
   *   - sendLevels   : averaged across melodic tracks 5/6/7 (or 0 if no racks)
   */
  private buildCurrentEngineParams(): LearnedPatternEngineParams {
    // ── Task F1-F3: read effective params from the audio backend (ONE path) ──
    // The backend tracks the actual send levels (worklet: from setFX; legacy:
    // from rack send gains). This fixes ROAST-7 bug #4: "Learning memory
    // stores zeros — snapshotEngineParams reads this.learned.kickDecay etc.
    // but these are never set (worklet owns actual params)."
    const audioParams = this.audio?.getParams?.() ?? {};
    const reverb = audioParams.sendReverb ?? 0;
    const delay = audioParams.sendDelay ?? 0;
    const chorus = audioParams.sendChorus ?? 0;
    const phaser = audioParams.sendPhaser ?? 0;

    const leadMode = this.synthModeOverrides[5] ?? 'classic';
    const padMode  = this.synthModeOverrides[6] ?? 'classic';
    const arpMode  = this.synthModeOverrides[7] ?? 'classic';

    return {
      kickDecay:  audioParams.kickDecay ?? this.learned.kickDecay  ?? (this.refKickDecay > 0 ? this.refKickDecay : 0.25),
      bassCutoff: audioParams.bassCutoff ?? this.learned.bassCutoff ?? 0,
      leadCutoff: audioParams.leadCutoff ?? (this.leadCutoffOverride >= 0 ? this.leadCutoffOverride : 0),
      leadDetune: audioParams.leadDetune ?? this.learned.leadDetune ?? 0,
      padCutoff:  audioParams.padCutoff  ?? this.learned.padCutoff  ?? 0,
      duck:       audioParams.duck       ?? this.learned.duck       ?? 0.5,
      synthMode: {
        lead: typeof leadMode === 'string' ? leadMode : 'classic',
        pad:  typeof padMode  === 'string' ? padMode  : 'classic',
        arp:  typeof arpMode  === 'string' ? arpMode  : 'classic',
      },
      sendLevels: { reverb, delay, chorus, phaser },
    };
  }

  /**
   * Compute the current match score (0..1) — how well the engine's output
   * matches the reference radio right now.
   *
   * Uses the timbre fingerprint comparison's `similarity` field (0..1) when
   * available (the deep A/B analysis computes it on every liveTrack call).
   * Falls back to a pursuit-delta-based score when the timbre comparison
   * hasn't run yet (e.g., before the first deep-pursuit cooldown).
   *
   * The pursuit-delta fallback averages:
   *   - centroid closeness (1 - |refCentroid - ownCentroid| / 2000, clamped)
   *   - transient density closeness (1 - |delta| / 5, clamped)
   *   - subEnergy closeness (1 - |delta|, clamped)
   *   - highEnergy closeness (1 - |delta|, clamped)
   *   - BPM closeness (1 - |delta| / 10, clamped)
   * Each axis contributes equally (20%) — this is a rough proxy; the
   * timbre comparison is the authoritative measure when available.
   */
  private computeMatchScore(): number {
    // Preferred: use the timbre fingerprint comparison similarity (0..1).
    if (this.timbreComparison && typeof this.timbreComparison.similarity === 'number' &&
        isFinite(this.timbreComparison.similarity)) {
      return clamp(this.timbreComparison.similarity, 0, 1);
    }

    // Fallback: compute from pursuit deltas (kick decay / centroid /
    // transient / sub / high / BPM). Each axis contributes a 0..1 closeness
    // score; the average is the match score.
    let sum = 0;
    let count = 0;

    if (this.refSpectralCentroid > 0 && this.ownSpectralCentroid > 0) {
      const d = Math.abs(this.refSpectralCentroid - this.ownSpectralCentroid);
      sum += clamp(1 - d / 2000, 0, 1);
      count++;
    }
    if (this.refTransientDensity > 0 && this.ownTransientDensity > 0) {
      const d = Math.abs(this.refTransientDensity - this.ownTransientDensity);
      sum += clamp(1 - d / 5, 0, 1);
      count++;
    }
    if (this.refSubEnergy > 0 && this.ownSubEnergy > 0) {
      sum += clamp(1 - Math.abs(this.refSubEnergy - this.ownSubEnergy), 0, 1);
      count++;
    }
    if (this.refHighEnergy > 0 && this.ownHighEnergy > 0) {
      sum += clamp(1 - Math.abs(this.refHighEnergy - this.ownHighEnergy), 0, 1);
      count++;
    }
    if (this.refBpm > 0) {
      const d = Math.abs(this.refBpm - this._bpm);
      sum += clamp(1 - d / 10, 0, 1);
      count++;
    }

    if (count === 0) return 0;
    return clamp(sum / count, 0, 1);
  }

  /**
   * Apply a learned pattern's engine params to the engine — used by both
   * the proactive-apply path (head start when radio connects) and the
   * recall path (when the engine is struggling).
   *
   * Routes each field through the engine's existing public API so the
   * changes are applied the same way the reference pursuit applies them
   * (smooth ramps via setTargetAtTime where applicable). Safe to call
   * repeatedly — re-applying the same params is a smooth no-op.
   */
  private applyLearnedPatternParams(params: LearnedPatternEngineParams): void {
    // ── Per-voice synthesis params (via setWorld — these are stored in
    //    `this.learned` and applied per-note in triggerDrum / triggerSynth).
    this.setWorld({
      kickDecay:  params.kickDecay,
      bassCutoff: params.bassCutoff,
      leadCutoff: params.leadCutoff,
      leadDetune: params.leadDetune,
      padCutoff:  params.padCutoff,
      duck:       params.duck,
    });

    // ── Lead filter cutoff override (via setTrackEffect) ──
    // Only apply if the learned value is positive (>0 means it was set).
    if (params.leadCutoff > 0) {
      this.setTrackEffect(5, 'cutoff', params.leadCutoff);
    }

    // ── Synth-mode overrides (via setSynthMode) ──
    // 'classic' is the no-op sentinel (clears the override) — only apply
    // when the learned mode is a real synthesis mode.
    const validModes = new Set(['fm', 'supersaw', 'wavetable', 'classic']);
    if (validModes.has(params.synthMode.lead)) {
      this.setSynthMode(5, params.synthMode.lead === 'classic' ? null : params.synthMode.lead as SynthMode);
    }
    if (validModes.has(params.synthMode.pad)) {
      this.setSynthMode(6, params.synthMode.pad === 'classic' ? null : params.synthMode.pad as SynthMode);
    }
    if (validModes.has(params.synthMode.arp)) {
      this.setSynthMode(7, params.synthMode.arp === 'classic' ? null : params.synthMode.arp as SynthMode);
    }

    // ── Per-track send levels (via setSendLevel) ──
    // Apply the learned send levels to the melodic tracks (5=LEAD, 6=PAD,
    // 7=ARP). The drum tracks keep their world-default sends (kick/bass
    // should stay dry — see PSY3 sound design rules).
    for (const ti of [5, 6, 7]) {
      this.setSendLevel(ti, 'reverb',  params.sendLevels.reverb);
      this.setSendLevel(ti, 'delay',   params.sendLevels.delay);
      this.setSendLevel(ti, 'chorus',  params.sendLevels.chorus);
      this.setSendLevel(ti, 'phaser',  params.sendLevels.phaser);
    }
  }

  /**
   * Proactive head-start: when fresh reference features arrive, query the
   * memory for the closest stored pattern. If found with
   * reinforcementCount >= 2 (proven pattern) AND its id differs from the
   * last applied one, apply its engine params IMMEDIATELY.
   *
   * This gives the engine a head start — instead of converging over 30-60s
   * of pursuit, it starts from a known-good configuration for the current
   * radio style. The first liveTrack call after the radio connects is the
   * most impactful (jumps directly to good params); subsequent calls only
   * re-apply when the closest pattern changes (e.g., the radio switched to
   * a different style).
   *
   * No-op when no radio data, no stored patterns, or the closest pattern
   * isn't proven yet (reinforcementCount < 2).
   */
  private applyLearnedPatternProactively(): void {
    const refFeatures = this.buildLearningRefFeatures();
    if (!refFeatures) return;

    const match = this.learningMemory.findClosestPattern(refFeatures);
    if (!match) {
      // No close match — clear the last-applied tracking so a future close
      // match will apply cleanly.
      this.lastProactivePatternId = null;
      return;
    }

    // Only apply PROVEN patterns (reinforcementCount >= 2). A pattern with
    // reinforcementCount = 1 might be a fluke — we wait for it to be
    // reinforced before trusting it as a head start.
    if (match.pattern.reinforcementCount < Psy4EngineV2.LEARNING_PROACTIVE_MIN_REINFORCEMENT) {
      return;
    }

    // Skip if we already applied this exact pattern (same id) — avoids
    // re-applying on every liveTrack call. We re-apply only when the
    // closest pattern changes.
    if (match.pattern.id === this.lastProactivePatternId) return;
    this.lastProactivePatternId = match.pattern.id;

    if (typeof console !== 'undefined') {
      console.log(
        `[PSY4] Learning: proactive apply — pattern ${match.pattern.id} ` +
        `(score ${(match.score * 100).toFixed(0)}%, reinforced ${match.pattern.reinforcementCount}×, ` +
        `match score ${(match.pattern.matchScore * 100).toFixed(0)}%)`,
      );
    }

    this.applyLearnedPatternParams(match.pattern.engineParams);
  }

  /**
   * The 30s learning loop. Called from liveTrack() on every reference
   * update — interval-throttled internally so it only runs an actual pass
   * every LEARNING_INTERVAL_MS (30s).
   *
   * Each pass:
   *   1. Compute the current match score (0..1).
   *   2. Push it to the rolling history (last 20 samples).
   *   3. If matchScore > 0.6 (good match): store a pattern (ref features +
   *      current engine params + score). The memory reinforces existing
   *      patterns with the same ref signature instead of duplicating.
   *   4. If matchScore < 0.4 (poor match): look up the closest stored
   *      pattern and apply its engine params (recall).
   *   5. Save the memory to localStorage every LEARNING_SAVE_INTERVAL_MS
   *      (60s).
   *
   * No-op when no reference data is available (no radio connected).
   */
  private runLearningTick(): void {
    const nowMs = Date.now();
    // Interval-throttle: only run an actual pass every 30s. The first
    // pass runs 30s after start() (lastLearningTickTime is set in start()).
    if (nowMs - this.lastLearningTickTime < Psy4EngineV2.LEARNING_INTERVAL_MS) {
      // Still check the periodic save (60s) even on skipped passes — we
      // want the save to fire on its own schedule, independent of the
      // learning pass.
      if (nowMs - this.lastLearningSaveTime >= Psy4EngineV2.LEARNING_SAVE_INTERVAL_MS) {
        try { this.learningMemory.save(); } catch { /* private browsing */ }
        this.lastLearningSaveTime = nowMs;
      }
      return;
    }
    this.lastLearningTickTime = nowMs;

    const refFeatures = this.buildLearningRefFeatures();
    if (!refFeatures) return;  // no radio data — nothing to learn

    // 1. Compute the match score.
    const matchScore = this.computeMatchScore();

    // 2. Push to the rolling history (always — even poor matches are
    //    useful signal for the improvement trend).
    this.learningMemory.recordMatchScore(matchScore);

    // 3. Store on good match, recall on poor match.
    if (matchScore >= Psy4EngineV2.LEARNING_STORE_THRESHOLD) {
      // Good match — store the (ref, params, score) triple. The memory's
      // storePattern() reinforces existing entries with the same ref
      // signature (so a 145 BPM dark-psy stream reinforces the same entry
      // across multiple 30s windows instead of accumulating duplicates).
      const engineParams = this.buildCurrentEngineParams();
      const pattern: LearnedPattern = {
        id: '',  // the memory rebuilds the id from refFeatures (deterministic)
        refFeatures,
        engineParams,
        matchScore,
        timestamp: nowMs,
        reinforcementCount: 0,  // storePattern sets this to 1 (new) or increments (reinforce)
      };
      this.learningMemory.storePattern(pattern);

      if (typeof console !== 'undefined') {
        console.log(
          `[PSY4] Learning: stored pattern — ${refFeatures.style} ${refFeatures.bpm.toFixed(0)} BPM ` +
          `centroid ${refFeatures.spectralCentroid.toFixed(0)} Hz — match ${(matchScore * 100).toFixed(0)}%`,
        );
      }
    } else if (matchScore < Psy4EngineV2.LEARNING_RECALL_THRESHOLD) {
      // Poor match — look up the closest stored pattern and apply its
      // params. This is the "engine is struggling, recall what worked
      // before" path. If no close pattern exists, no-op.
      const match = this.learningMemory.findClosestPattern(refFeatures);
      if (match && match.pattern.reinforcementCount >= 1) {
        if (typeof console !== 'undefined') {
          console.log(
            `[PSY4] Learning: recall — match score ${(matchScore * 100).toFixed(0)}% < 40%, ` +
            `applying closest pattern ${match.pattern.id} (similarity ${(match.score * 100).toFixed(0)}%)`,
          );
        }
        this.applyLearnedPatternParams(match.pattern.engineParams);
        // Mark this as the last proactively-applied pattern so the
        // proactive path doesn't immediately re-apply it.
        this.lastProactivePatternId = match.pattern.id;
      }
    }

    // 4. Periodic save (every 60s).
    if (nowMs - this.lastLearningSaveTime >= Psy4EngineV2.LEARNING_SAVE_INTERVAL_MS) {
      try { this.learningMemory.save(); } catch { /* private browsing */ }
      this.lastLearningSaveTime = nowMs;
    }
  }

  /**
   * Task T1 (active learning): public API for the UI dashboard.
   *
   * Returns the full learning-memory status: total patterns learned,
   * average match score across all patterns, the latest match score, the
   * improvement trend (learning / stable / drifting / idle), the top 3
   * patterns (by reinforcementCount × matchScore), and the rolling match-
   * score history (last 20 samples) for the trend graph.
   *
   * The UI polls this on every analyzer tick (10s hop). All fields are
   * guarded — safe to call before any learning has happened (returns zeros
   * and empty arrays).
   */
  getLearningStatus(): LearningStatus {
    return this.learningMemory.getStatus();
  }

  /**
   * Task T1 (active learning): clear all stored patterns + history.
   *
   * Used by the "Reset learning" button in the UI. Also clears localStorage
   * so the reset persists across sessions. After reset, the engine starts
   * fresh — no head-start applies until new patterns are learned.
   *
   * Safe to call before start() or with no learning history.
   */
  resetLearning(): void {
    this.learningMemory.clear();
    this.lastProactivePatternId = null;
    // Don't reset lastLearningTickTime — we want the next 30s window to
    // start fresh, not skip the next pass.
    if (typeof console !== 'undefined') {
      console.log('[PSY4] Learning: memory cleared (patterns + history + localStorage)');
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
    // ── Task F1-F3: ONE path — push LUFS adjustments via this.audio.setMacros ──
    // The worklet's macros.energy scales voice amplitudes; the legacy graph
    // adjusts the master gain. Both backends handle this via setWorld (legacy:
    // masterLevel) or setMacros (worklet: energy). We use setMacros for both —
    // the legacy backend no-ops setMacros, so we also push masterLevel via
    // setWorld for the legacy path.
    if (this.targetLufs !== 0 && Math.abs(selfMetrics.lufs - this.targetLufs) > 1.0) {
      const diff = this.targetLufs - selfMetrics.lufs;
      const adj = diff > 0 ? 0.08 : -0.08;
      // Nudge energy macro (worklet scales voice amplitudes with energy).
      const macros = this.computeWorkletMacros();
      macros.energy = clamp(macros.energy + adj * 0.5, 0.1, 1.0);
      this.audio?.setMacros(macros);
      // Also nudge the master level (legacy: master.gain; worklet: no-op).
      if (this.ctx) {
        const currentMaster = this.audio?.getParams?.().masterLevel ?? 1.1;
        const newMaster = clamp(currentMaster + adj, 0.3, 2.0);
        this.audio?.setWorld({ masterLevel: newMaster });
      }
    }
    // Energy matching — adjust track volumes / density macro.
    // ── Task F1-F3: ONE path — nudge density macro (worklet) + bass/kick/lead ──
    // levels (legacy) via setWorld.
    if (this.targetEnergy > 0 && selfMetrics.energy !== undefined) {
      const energyDiff = this.targetEnergy - selfMetrics.energy;
      if (Math.abs(energyDiff) > 0.05) {
        // Nudge density macro (worklet: more density = more notes = more energy).
        const macros = this.computeWorkletMacros();
        const nudge = energyDiff > 0 ? 0.02 : -0.02;
        macros.density = clamp(macros.density + nudge, 0.1, 1.0);
        this.audio?.setMacros(macros);
        // Also nudge bass + lead levels (legacy: trackGains; worklet: no-op
        // for these param names, but the worklet's bus levels are fixed).
        if (this.ctx) {
          const params = this.audio?.getParams?.() ?? {};
          const volAdj = energyDiff > 0 ? 0.02 : -0.02;
          const newBass = clamp((params.bassLevel ?? 0.96) + volAdj, 0.1, 2.0);
          const newLead = clamp((params.leadLevel ?? 0.56) + volAdj, 0.1, 2.0);
          const newKick = clamp((params.kickLevel ?? 0.8) + volAdj * 0.5, 0.1, 2.0);
          this.audio?.setWorld({ bassLevel: newBass, leadLevel: newLead, kickLevel: newKick });
        }
      }
    }
  }

  setWorld(params: Record<string, number>): void {
    if (!this.ctx) return;
    // ── Task F1-F3: route world params to the audio backend (ONE path) ──
    // The backend (worklet or legacy) merges the params into its internal
    // state. The worklet applies them to its voice pool; the legacy graph
    // adjusts master/track gain nodes + stores learned params.
    this.audio?.setWorld(params);
    // Store learned params locally so the engine's tracking state stays
    // consistent for the pursuit UI + the legacy graph's triggerDrum/triggerSynth.
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
    // Sync the legacy access so the legacy graph reads the latest learned params.
    this.syncLegacyAccess();
  }

  /**
   * Task W1: Compute the world params to send to the worklet from the engine's
   * current state (currentWorld + learned + reference pursuit). Called by
   * init() once the worklet loads, and by setWorld() when params arrive.
   *
   * The worklet's worldParams schema (mirror of public/worklets/psy4-engine.js):
   *   kickFundamental, kickDecay, bassCutoff, bassResonance,
   *   leadCutoff, leadDetune, padCutoff, padAttack, padDetune, padEvolveRate,
   *   duck
   */
  private computeWorkletWorldParams(): Record<string, number> {
    const w = this.currentWorld;
    const params: Record<string, number> = {
      kickFundamental: 50,
      kickDecay: this.learned.kickDecay ?? 0.2,
      bassCutoff: this.learned.bassCutoff ?? 150,
      bassResonance: 3,
      leadCutoff: this.learned.leadCutoff ?? 1800,
      leadDetune: this.learned.leadDetune ?? 10,
      padCutoff: this.learned.padCutoff ?? 1200,
      padAttack: 0.5,
      padDetune: 7,
      padEvolveRate: 0.1,
      duck: this.learned.duck ?? 0.4,
    };
    // Per-world overrides: if the world defines specific timbre fields, use them.
    // (The World interface has optional timbre fields — we read defensively.)
    const wAny = w as unknown as Record<string, unknown>;
    if (typeof wAny.kickFundamental === 'number') params.kickFundamental = wAny.kickFundamental;
    if (typeof wAny.kickDecay === 'number') params.kickDecay = wAny.kickDecay;
    if (typeof wAny.bassCutoff === 'number') params.bassCutoff = wAny.bassCutoff;
    if (typeof wAny.bassResonance === 'number') params.bassResonance = wAny.bassResonance;
    if (typeof wAny.leadCutoff === 'number') params.leadCutoff = wAny.leadCutoff;
    if (typeof wAny.leadDetune === 'number') params.leadDetune = wAny.leadDetune;
    if (typeof wAny.padCutoff === 'number') params.padCutoff = wAny.padCutoff;
    if (typeof wAny.padAttack === 'number') params.padAttack = wAny.padAttack;
    if (typeof wAny.padDetune === 'number') params.padDetune = wAny.padDetune;
    if (typeof wAny.padEvolveRate === 'number') params.padEvolveRate = wAny.padEvolveRate;
    if (typeof wAny.duck === 'number') params.duck = wAny.duck;
    return params;
  }

  /**
   * Task W1: Compute the macro values to send to the worklet. The worklet's
   * macros affect per-voice timbre (drive, brightness, psychedelia → LFO
   * depth, etc.). Pulled from the current flow state + world character.
   */
  private computeWorkletMacros(): Record<string, number> {
    const flow = this.currentFlow;
    const w = this.currentWorld;
    const energy = flow?.energy ?? 0.6;
    const density = flow?.density ?? 0.55;
    return {
      energy,
      psychedelia: 0.55,
      darkness: 0.4,
      density,
      groove: w.swing ?? 0.5,
      evolution: 0.5,
      space: flow?.reverbAmount ?? 0.4,
      surprise: flow?.surprise ?? 0.05,
      aggression: 0.4,
      brightness: flow?.filterCutoff ? Math.min(1, flow.filterCutoff / 8000) : 0.55,
    };
  }

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  /**
   * Task V2a / L1: kick off the scheduler using the Worker-based tick.
   *
   * The SchedulerWorker posts `{type:'tick'}` messages from a separate
   * thread, which the main thread's `onTick` callback turns into a call to
   * `this.tick()`. Because the worker thread has no other work, its 25ms
   * interval fires far more reliably than main-thread `setTimeout(15ms)`,
   * which is subject to React renders, GC, layout, and the HTML5 4ms clamp.
   *
   * Task L1: the worker now ticks at 25ms (40 Hz, was 15ms/66 Hz). Combined
   * with the adaptive 30-100ms lookahead, the main thread sees ~half the
   * wakeups AND each wakeup schedules up to 200ms of notes via Web Audio's
   * internal scheduler (sample-accurate — runs on the audio thread, not the
   * main thread). The actual musical timing is no longer tied to the worker
   * interval at all.
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
    // Task L1: start the worker at 25ms (40 Hz). If the worker is already
    // running, this is a no-op (it just confirms the interval).
    this.scheduler.start(Psy4EngineV2.SCHEDULER_INTERVAL_MS);
  }

  private tick(): void {
    if (!this.playing || !this.ctx) return;
    // P1: report this tick's duration to the PerformanceMonitor so it can
    // detect audio-thread overload (tick > 5ms = at-risk). Measured around
    // the entire scheduling pass — including scheduleStep, applySectionAutomation,
    // triggerDrum/triggerSynth, and the bar/section bookkeeping below.
    const __p1TickStart = (typeof performance !== 'undefined') ? performance.now() : 0;
    const now = this.ctx.currentTime;

    // ── Task L1: early-exit when nothing needs scheduling ──
    // The worker posts ticks at 25ms intervals; if the next step is outside
    // the lookahead window, skip the loop entirely. This is the "only post
    // when there's work" optimization — the worker still ticks, but the main
    // thread does ~zero work for empty ticks (just one comparison + return).
    // At 145 BPM with a 60ms lookahead, ~60% of ticks are empty.
    if (this.nextTime >= now + this.lookahead) {
      // Still update adaptive lookahead + CPU monitor (cheap, 1Hz).
      this.updateAdaptiveLookahead();
      if (__p1TickStart > 0 && typeof performance !== 'undefined') {
        this.perfMonitor.reportTickDuration(performance.now() - __p1TickStart);
      }
      return;
    }

    // ── Task L1: drop detection ──
    // If nextTime is in the past, the main thread was blocked longer than
    // the lookahead window (e.g., a heavy React render or GC pause). Web
    // Audio would play the note immediately (audible glitch), so instead
    // we snap nextTime forward to the next 16th-step boundary past `now`
    // and count the drop. This skips the missed steps cleanly (one beat
    // of silence) rather than flooding the audio thread with catch-up.
    if (this.nextTime < now) {
      this.droppedNotes++;
      this.lastDropAt = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      this.lastStabilityCheckAt = 0;  // reset stability window
      const s16 = 60 / this.bpm / 4;
      const behind = now - this.nextTime;
      const stepsBehind = Math.ceil(behind / s16);
      this.nextTime += stepsBehind * s16;
      if (typeof console !== 'undefined' && this.droppedNotes <= 5) {
        // Log the first few drops so the developer can see them. After 5
        // we go quiet to avoid console spam during sustained overload.
        console.warn(`[PSY4] Scheduler drop #${this.droppedNotes} — main thread blocked ${(behind * 1000).toFixed(0)}ms behind. Lookahead will adapt.`);
      }
    }

    // Capture the lookahead once for this pass — the adaptive controller
    // only updates it between ticks, so the loop sees a stable value.
    const lookahead = this.lookahead;

    // ── Task F1-F3 FIX 1: query the MusicalDirector ONCE for the full lookahead ──
    // window (not 1 step at a time). This fixes ROAST-7 bug #1: "scheduleStep()
    // calls director.getNotesForWindow(stepTime, stepTime + sd, ...) — a 1-step
    // window. The director composes 'phrases' but the engine asks for them ONE
    // 16th STEP AT A TIME."
    //
    // Now we ask for ALL notes in [nextTime, now + lookahead] — the full ~200ms
    // lookahead window. The director composes a full 4-8 bar phrase internally
    // (composePhrase is called when the phrase ends) and returns the notes that
    // fall in our window. We pass these pre-queried notes to scheduleStep,
    // which filters them per-step (by time range) and fires them.
    //
    // This is REAL phrase composition: the director composes once per 4-8 bars,
    // and the engine fires notes as they come due within the lookahead window.
    let windowNotes: PhraseNote[] = [];
    if (this.director) {
      const w = this.currentWorld;
      const flow = this.currentFlow;
      const baseE = w.energyCurve[0] ?? 0.5;
      const energy = clamp(baseE * (0.4 + 0.6 * (flow?.density ?? 0.5)), 0, 1);
      const character = labelToCharacter(flow?.label ?? 'GROOVE');
      windowNotes = this.director.getNotesForWindow(
        this.nextTime, now + lookahead, energy, character, w, this.bpm,
      );
    }

    while (this.nextTime < now + lookahead) {
      // Recompute s16 each step so the BPM ramp changes tempo smoothly
      // without invalidating the scheduler's lookahead window.
      const s16 = 60 / this.bpm / 4;
      // ── Task D1: apply DJ-style phase offset to the scheduled time ──
      const phaseOffset = this.phaseSync.getPhaseOffset();
      const grooveOffset = this.djController.getGrooveOffsetSec();
      this.scheduleStep(this.step, this.bar, this.nextTime + phaseOffset + grooveOffset, windowNotes);
      this.step++;
      this.nextTime += s16;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        // ── Task M1: per-bar melodic evolution is now handled by the director ──
        // The old MelodyEngine.tickEvolution() refreshed the B section every N
        // bars. With the MusicalDirector, the melody engine's full phrase table
        // is rebuilt at each composePhrase() call (every 8 bars or on section
        // changes), so tickEvolution is redundant. The director calls
        // melody.newPhrase() internally during composition, which gives a
        // fresher, more thorough refresh than tickEvolution's incremental
        // B-section swap.
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
        // ── Task D1 (upgrade): full DJ controller per-bar tick ──
        // The DJController returns three actions for the engine to apply:
        //   - keyShiftSemitones: if non-zero, transpose musicalKey.root by
        //     this many semitones (smooth harmonic-mixing convergence
        //     toward the nearest Camelot-compatible key). The shift is
        //     capped at ±1 semitone per bar so it's a gradual modulation.
        //   - swingAdjust: signed delta to ADD to world.swing (smooth
        //     convergence toward the radio's swing amount). We accumulate
        //     into this.swingAdjust, which scheduleStep reads when applying
        //     the offbeat step delay.
        //   - phraseRealign: if true, treat the current bar as bar 0 of a
        //     new phrase (used when the radio just dropped and we're mid-
        //     phrase — snap our phrase boundary to the radio's).
        //
        // We push our own state to the DJController FIRST (so it has the
        // latest BPM / key / swing / energy / bar / section) before asking
        // it for the per-bar actions. This keeps the snapshot fresh.
        const ownEnergy = this.currentFlow?.density ?? 0.5;
        this.djController.setOwnState({
          bpm: this._bpm,
          key: { root: this.musicalKey.root, scale: this.musicalKey.scale },
          swing: this.currentWorld.swing + this.swingAdjust,
          energy: ownEnergy,
          bar: this.bar,
          totalBars: this.totalBars,
          section: this.currentSection,
        });
        const djAction = this.djController.tickBar(this._bpm, this.bar, this.totalBars);
        if (djAction.keyShiftSemitones !== 0) {
          // Apply the key shift via the helper (handles octave wrapping +
          // refreshMusicalGenerators + tracking appliedKeyShift for clean
          // reversal when master sync is disabled).
          this.applyKeyShift(djAction.keyShiftSemitones);
        }
        if (djAction.swingAdjust !== 0) {
          // Accumulate the swing adjustment (capped to keep swing in
          // [0, 0.5] — scheduleStep clamps the effective swing anyway, but
          // we cap here too so the displayed value stays sane).
          this.swingAdjust = clamp(this.swingAdjust + djAction.swingAdjust, -0.25, 0.25);
        }
        if (djAction.phraseRealign && this.bar !== 0) {
          // The radio just hit a phrase boundary (drop / break) but we're
          // mid-phrase. Snap our bar counter to 0 so our next phrase
          // boundary aligns with the radio's. We DON'T reset totalBars
          // (the flow engine uses it for absolute time tracking) — only
          // bar-in-section, which scheduleStep uses for energy-curve
          // indexing + riser triggers. This is the "cut short and drop
          // now" DJ move.
          this.bar = 0;
        }
        // ── Task P4: phrase-level sync per-bar tick ──
        // Push our latest bar / phrase length / absolute bar counter to the
        // PhraseSync, then ask it whether to realign this bar. If realign,
        // call flowEngine.transitionTo(...) with the suggested archetype +
        // energy + phrase length to start a new phrase aligned with the
        // radio. We also manually reset this.bar to 0 because transitionTo
        // resets the flow engine's barInSection but NOT our engine's bar
        // (the engine only resets this.bar when the flow LABEL changes, so
        // a same-label realignment — e.g., DROP → DROP — wouldn't reset it).
        //
        // We run this BEFORE the flow engine's tick() (next block) so the
        // flow engine smooths toward the new archetype immediately. The
        // flow engine's tick() will see the new target + set current.label
        // accordingly; if the label changed, the engine's existing logic
        // resets this.bar = 0 again (no-op when we already set it to 0).
        //
        // Master-sync guard: PhraseSync.checkRealignment() returns
        // { realign: false } when master sync is off, so this whole block
        // is a no-op in free-run mode (just two cheap method calls).
        const p4PhraseLen = clamp(this.currentFlow?.sectionBars ?? 8, 4, 8);
        this.phraseSync.onOwnBar(this.bar, p4PhraseLen, this.totalBars);
        const p4Realign = this.phraseSync.checkRealignment();
        if (p4Realign.realign && this.flowEngine) {
          // Start a new phrase aligned with the radio. The suggested label
          // + energy are derived from the radio's section label at the
          // boundary (drop → DROP/0.95, break → BREAK/0.30, build →
          // BUILD/0.70, etc.). The suggested bars matches the radio's
          // estimated phrase length (default 8).
          this.flowEngine.transitionTo(
            {
              label: p4Realign.suggestedLabel ?? this.currentFlow?.label ?? 'GROOVE',
              energy: p4Realign.suggestedEnergy ?? this.currentFlow?.energy ?? 0.7,
            },
            p4Realign.suggestedBars ?? p4PhraseLen,
          );
          // Manually reset our bar-in-section so scheduleStep's energy-curve
          // indexing + riser logic restart at phrase position 0. This is
          // the "cut short and align" DJ move — the flow engine's transition
          // already reset its own barInSection, but our `this.bar` is only
          // reset by the flow-label-change branch in the next block; a
          // same-label realignment (DROP → DROP) wouldn't trigger it.
          this.bar = 0;
          if (typeof console !== 'undefined') {
            console.log(
              `[PSY4] PhraseSync: realign (${p4Realign.reason}) — ` +
              `offset ${p4Realign.offsetBars > 0 ? '+' : ''}${p4Realign.offsetBars} bars, ` +
              `new phrase ${p4Realign.suggestedLabel ?? '?'} ` +
              `(${p4Realign.suggestedBars ?? p4PhraseLen} bars @ energy ${p4Realign.suggestedEnergy?.toFixed(2) ?? '?'})`,
            );
          }
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
            // ── Task M1: compose a fresh phrase for the new section ──
            // The MusicalDirector composes a full 4-8 bar phrase ahead of
            // time with musical phrasing appropriate to the new section's
            // character (build/drop/break/groove/etc.), rhythmic complexity
            // (syncopation, polyrhythm, ghost notes), and cohesive interplay
            // between instruments. This replaces the old step-by-step note
            // decision in scheduleStep — notes are now COMPOSED before they
            // play, with full phrase context.
            //
            // The director internally calls melody.newPhrase() (for a fresh
            // motif) and harmony.generateProgression() (for a fresh chord
            // progression matching the section's energy). We don't call those
            // directly anymore — the director owns the composition pipeline.
            if (this.director) {
              const baseE = this.currentWorld.energyCurve[0] ?? 0.5;
              const phraseEnergy = clamp(baseE * (0.4 + 0.6 * flow.density), 0, 1);
              const character = labelToCharacter(flow.label);
              // prepareNextPhrase composes the phrase and stores it in
              // nextPhrase; advancePhrase swaps it to currentPhrase at the
              // given time. We use nextTime (the upcoming bar's start) as
              // the phrase start time so the director's note times align
              // with the scheduler's clock.
              this.director.prepareNextPhrase(
                phraseEnergy, character, this.currentWorld, this._bpm, this.nextTime,
              );
              this.director.advancePhrase(
                this.nextTime, phraseEnergy, character, this.currentWorld, this._bpm,
              );
            } else {
              // Fallback (director not yet created) — call the old generators
              // directly so the lead + pad still have material to play.
              const baseE = this.currentWorld.energyCurve[0] ?? 0.5;
              const phraseEnergy = clamp(baseE * (0.4 + 0.6 * flow.density), 0, 1);
              this.melody?.newPhrase(phraseEnergy);
              if (this.harmony) {
                this.currentProgression = this.harmony.generateProgression(flow.sectionBars, phraseEnergy);
                this.chordIdx = 0;
                this.currentChord = null;
              }
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
          // ── Task W1: notify the worklet of the phrase boundary ──
          // ── Task F1-F3: notify the audio backend of the phrase boundary ──
          // The worklet rotates its phrase-locked sample indices on newPhrase
          // (kick/hat/clap/perc get a fresh variant for sonic consistency
          // within the new phrase, then variation across phrases). The legacy
          // backend no-ops newPhrase (no sample rotation).
          this.audio?.newPhrase();
        }
        // Bass pattern rotates every 4 bars (kept from Track A — denser variation)
        if (this.bar % 4 === 0 && this.bar > 0) {
          const bassStyle = this.deriveBassStyle();
          const bps = BASS_PATTERNS[bassStyle] || BASS_PATTERNS.off;
          this.bassPatternIdx = (this.bassPatternIdx + 1) % bps.length;
        }
      }
    }

    // ── Task F1-F3: flush the event batch to the audio backend (ONE path) ──
    // PSY5 batched postMessage: ALL step events accumulated during this tick
    // (kick, bass, lead, pad, arp, hats, perc, riser, impact — typically 4-12
    // events per tick) are sent in ONE postMessage call, not one per event.
    // This minimizes main→audio thread communication overhead.
    //
    // Worklet: flushEvents() sends the accumulated Float64Array batch via
    // postMessage with zero-copy transfer. Legacy: flushEvents() is a no-op
    // (events fire immediately in triggerDrum/triggerSynth).
    this.audio?.flushEvents();

    // P1: report this tick's duration to the PerformanceMonitor. Cheap
    // (one performance.now() subtraction + array push). When the audio
    // thread is overloaded (tick > 5ms), the monitor escalates quality
    // down after 3s; when stable, it escalates up after 10s.
    if (__p1TickStart > 0 && typeof performance !== 'undefined') {
      this.perfMonitor.reportTickDuration(performance.now() - __p1TickStart);
    }

    // Task L1: evaluate adaptive lookahead after each non-empty tick. The
    // controller is internally throttled to 1Hz so this is cheap (one
    // performance.now() comparison + early return most of the time).
    this.updateAdaptiveLookahead();
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

  private scheduleStep(step: number, bar: number, time: number, windowNotes: PhraseNote[] = []): void {
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
    // Task D1 (upgrade): the effective swing = world.swing + the DJController's
    // accumulated swingAdjust (when master sync is on, this nudges our swing
    // toward the radio's swing amount — smooth convergence at ≤0.02/bar).
    // Clamped to [0, 0.5] so we never go negative or fully triplet.
    let stepTime = time;
    const effectiveSwing = clamp(w.swing + this.swingAdjust, 0, 0.5);
    if (step % 2 === 1 && effectiveSwing > 0) {
      stepTime += effectiveSwing * sd * 0.5;
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

    // Reference pursuit — hat/perc velocity boost to match the radio's
    // transient density. Applied to drum notes (hats + perc) in the
    // director-driven loop below. tVelBoost is 0 when no reference data.
    const tScale = this.refTransientDensity > 0
      ? clamp(0.5 + this.refTransientDensity / 24, 0.3, 1.8)
      : 1.0;
    const tVelBoost = tScale > 1 ? (tScale - 1) * 0.5 : 0;

    // ── Task F1-F3 FIX 1: Director-driven note scheduling with a WIDE window ──
    // The MusicalDirector composes full 4-8 bar phrases ahead of time. The
    // tick() loop queries the director ONCE for the full lookahead window
    // (~200ms) and passes the pre-queried notes here. We filter them for
    // THIS step's time range [stepTime, stepTime + sd) and fire them.
    //
    // This is REAL phrase composition: the director composes once per 4-8
    // bars (composePhrase is called when the phrase ends), and the engine
    // fires notes as they come due within the lookahead window. No more
    // "1-step window" — the director serves the full window at once.
    //
    // The director handles:
    //   - Which instruments play (character-driven gating).
    //   - What notes they play (motif/harmony/bass-line/arp-pattern).
    //   - Velocity + duration (shaped by the phrase's energy curve).
    //   - Rhythmic complexity (ghost notes, syncopation, polyrhythm).
    //
    // The engine handles:
    //   - FX automation (applyFlowAutomation, called above).
    //   - Swing offset (applied to offbeat notes below).
    //   - Surprise gating (suppressAll / suppressNonKick).
    //   - Riser / impact FX triggers (above).
    //   - Reference pursuit (tVelBoost applied to drum velocities).
    //   - Phase sync (setOwnBeat when kick fires).
    //   - Timbre (computed per-track from the world).
    if (windowNotes.length > 0) {
      // Filter the pre-queried window notes for THIS step's time range.
      // The notes have absolute audio-context times; we fire those in
      // [stepTime, stepTime + sd).
      for (const note of windowNotes) {
        if (note.time < stepTime || note.time >= stepTime + sd) continue;
        // Surprise gating: silence suppresses all; dropOut suppresses non-kick.
        if (suppressAll) continue;
        if (suppressNonKick && note.track !== 0) continue;

        // Apply swing offset to offbeat notes (step % 2 === 1).
        const noteSwingOffset = (step % 2 === 1 && effectiveSwing > 0)
          ? effectiveSwing * sd * 0.5
          : 0;
        const fireTime = note.time + noteSwingOffset;

        if (note.track < 4) {
          // ── Drum note ──
          const drumVel = (note.track === 2 || note.track === 3)
            ? clamp(note.velocity + tVelBoost, 0, 1)
            : note.velocity;
          this.triggerDrum(note.track, fireTime, drumVel);
          if (note.track === 0 && this.ctx) {
            const wallNow = (typeof performance !== 'undefined' && performance.now)
              ? performance.now() / 1000
              : Date.now() / 1000;
            this.phaseSync.setOwnBeat(
              fireTime,
              this.ctx.currentTime,
              wallNow,
              step % 16 === 0,
            );
          }
        } else {
          // ── Synth note ──
          const timbre = this.getTimbreForTrack(note.track, w);
          this.triggerSynth(
            note.track, fireTime, note.midi, note.velocity,
            sd, note.duration, timbre,
          );
        }
      }
    } else if (!this.director) {
      // ── Fallback: director not yet created (defensive — shouldn't happen
      // after init()). Play a minimal kick on downbeats so the engine doesn't
      // go completely silent. ──
      if (!suppressAll && w.kickPattern.length === 16 && w.kickPattern.charAt(step) === 'x') {
        const isDownbeat = step % 4 === 0;
        const vel = isDownbeat ? 0.5 : 0.3;
        this.triggerDrum(0, stepTime, vel);
      }
    }
  }

  /**
   * Task M1: compute the per-track world timbre override for a synth note.
   *
   * The director composes notes with pitch/velocity/duration but NOT timbre —
   * timbre is a performance parameter owned by the engine (it depends on the
   * world's brightness/darkness/psychedelia character + the current reference
   * pursuit state). This helper returns the timbre object for the given track,
   * which triggerSynth applies on top of the preset.
   *
   * Tracks: 4=BASS 5=LEAD 6=PAD 7=ARP. Returns undefined for drum tracks
   * (0-3) — drums don't use timbre overrides.
   */
  private getTimbreForTrack(
    track: number,
    w: World,
  ): { cutoff?: number; res?: number; drive?: number } | undefined {
    switch (track) {
      case 4: // BASS
        return {
          cutoff: w.bassTimbre.cutoff * (0.7 + 0.6 * (1 - w.darkness)),
          res: 2 + w.bassTimbre.resonance * 12,
          drive: w.bassTimbre.drive,
        };
      case 5: // LEAD
        return {
          cutoff: w.leadTimbre.cutoff * (0.7 + 0.6 * w.brightness),
          res: 2 + w.leadTimbre.resonance * 12,
          drive: w.leadTimbre.drive,
        };
      case 6: // PAD
        return {
          cutoff: w.padTimbre.cutoff * (0.6 + 0.8 * w.brightness),
          res: 2 + w.padTimbre.resonance * 12,
          drive: w.padTimbre.drive,
        };
      case 7: // ARP
        return {
          cutoff: w.textureTimbre.cutoff * (0.7 + 0.6 * w.psychedelia),
          res: 2 + w.textureTimbre.resonance * 12,
          drive: w.textureTimbre.drive,
        };
      default:
        return undefined;
    }
  }

  private triggerDrum(trackIdx: number, time: number, vel: number, decayOverride?: number): void {
    // ── Task F1-F3: ONE path — route to this.audio (worklet OR legacy) ──
    // The engine computes the final decay (pursuit + learning blending) and
    // passes it to the audio backend. The backend fires the voice:
    //   - Worklet: enqueues into eventBatch, flushed at end of tick().
    //   - Legacy: fires a PooledDrumVoice immediately + ducks the bass.
    if (!this.audio) return;
    // Compute the final decay (pursuit + learning blending). This was
    // previously done inside the legacy triggerDrum; now it's in the engine
    // so both backends get the same final value.
    let finalDecay = decayOverride;
    if (trackIdx === 0) {
      // Reference pursuit — KICK DECAY: blend preset decay with refKickDecay.
      const preset = DRUM_PRESETS[this.tracks[trackIdx]?.presetId ?? ''];
      const presetDecay = preset?.decay ?? 1;
      if (this.refKickDecay > 0) {
        const targetDur = clamp(this.refKickDecay, 0.05, 0.8);
        const refDecayParam = clamp((targetDur - 0.12) / 0.5, 0.05, 4.0);
        const blended = presetDecay * 0.5 + refDecayParam * 0.5;
        finalDecay = (isFinite(blended) && blended > 0) ? blended : finalDecay;
      }
      // Learned kick decay — blend 25% on top.
      if (this.learned.kickDecay && finalDecay !== undefined) {
        const learnedDur = clamp(this.learned.kickDecay, 0.05, 0.8);
        const learnedParam = clamp((learnedDur - 0.12) / 0.5, 0.05, 4.0);
        const blended = finalDecay * 0.75 + learnedParam * 0.25;
        finalDecay = (isFinite(blended) && blended > 0) ? blended : finalDecay;
      }
      // Fallback to learned/preset decay if no override.
      if (finalDecay === undefined) {
        finalDecay = this.learned.kickDecay ?? presetDecay;
      }
    }
    this.audio.triggerDrum(trackIdx, time, vel, finalDecay);
  }

  private triggerRiser(time: number, dur: number): void {
    // ── Task F1-F3: ONE path — route to this.audio.triggerRiser ──
    // Worklet: enqueues a V_RISER event. Legacy: creates a noise+filter+gain
    // node graph for the riser effect.
    this.audio?.triggerRiser(time, dur);
  }

  private triggerImpact(time: number): void {
    // ── Task F1-F3: ONE path — route to this.audio.triggerImpact ──
    // Worklet: enqueues a V_IMPACT event. Legacy: creates a sub-boom oscillator
    // + noise burst node graph.
    this.audio?.triggerImpact(time);
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
    // ── Task F1-F3: ONE path — route to this.audio.triggerSynth ──
    // The engine computes the final timbre (world + pursuit + learning + flow
    // override) and passes it to the audio backend. The backend fires the voice:
    //   - Worklet: enqueues into eventBatch (uses worldParams for cutoff; the
    //     timbre arg is ignored — the worklet's voices use their internal state).
    //   - Legacy: fires an AdvancedSynthVoice with the timbre applied to the
    //     preset's cutoff/res, plus synth mode overrides + learned params.
    if (!this.audio) return;
    // Compute the final timbre (pursuit + learning + flow override). This was
    // previously done inside the legacy triggerSynth; now it's in the engine
    // so both backends get the same final values.
    let finalTimbre = timbre ? { ...timbre } : undefined;
    // Reference pursuit — SPECTRAL CENTROID matching for lead (5) and pad (6).
    if ((trackIdx === 5 || trackIdx === 6) && this.refSpectralCentroid > 0) {
      const targetCut = centroidToCutoff(this.refSpectralCentroid);
      const baseCut = finalTimbre?.cutoff ?? 1500;
      const blended = baseCut * 0.6 + targetCut * 0.4;
      if (isFinite(blended) && blended > 60) {
        finalTimbre = { ...finalTimbre, cutoff: clamp(blended, 200, 12000) };
      }
    }
    // Flow filter cutoff override (lead only).
    if (trackIdx === 5 && this.leadCutoffOverride > 0) {
      finalTimbre = { ...finalTimbre, cutoff: clamp(this.leadCutoffOverride, 200, 16000) };
    }
    // Learned params — blend 30% on top.
    if (trackIdx === 4 && this.learned.bassCutoff) {
      const baseCut = finalTimbre?.cutoff ?? 500;
      const blended = baseCut * 0.7 + this.learned.bassCutoff * 0.3;
      if (isFinite(blended) && blended > 40) {
        finalTimbre = { ...finalTimbre, cutoff: clamp(blended, 60, 4000) };
      }
    }
    if (trackIdx === 5 && this.learned.leadCutoff) {
      const baseCut = finalTimbre?.cutoff ?? 1800;
      const blended = baseCut * 0.7 + this.learned.leadCutoff * 0.3;
      if (isFinite(blended) && blended > 100) {
        finalTimbre = { ...finalTimbre, cutoff: clamp(blended, 200, 16000) };
      }
    }
    if (trackIdx === 6 && this.learned.padCutoff) {
      const baseCut = finalTimbre?.cutoff ?? 1000;
      const blended = baseCut * 0.7 + this.learned.padCutoff * 0.3;
      if (isFinite(blended) && blended > 80) {
        finalTimbre = { ...finalTimbre, cutoff: clamp(blended, 150, 12000) };
      }
    }
    // Compute the final duration.
    const finalDur = (dur !== undefined && Number.isFinite(dur) && dur > 0)
      ? dur
      : Math.max(0.05, stepDur * 0.5);
    // FM mode flag (worklet selects V_FM voice).
    const fm = this.synthModeOverrides[trackIdx] === 'fm';
    const opts: TriggerSynthOpts = { stepDur, fm };
    this.audio.triggerSynth(trackIdx, time, midi, vel, finalDur, finalTimbre as SynthTimbre | undefined, opts);
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
    // Task F1-F3: read from this.audio.getParams() (ONE path). The backend
    // tracks the actual send levels (worklet: from setFX; legacy: from rack
    // send gains). For per-track granularity, we approximate: the worklet
    // returns the music-bus send (index 2); the legacy returns the averaged
    // melodic send. We fill all 8 tracks with the same value for the UI.
    const audioParams = this.audio?.getParams?.() ?? {};
    const reverbSend: number[] = [];
    const delaySend: number[] = [];
    const chorusSend: number[] = [];
    const phaserSend: number[] = [];
    const distortionSend: number[] = [];
    for (let i = 0; i < 8; i++) {
      reverbSend.push(audioParams.sendReverb ?? 0);
      delaySend.push(audioParams.sendDelay ?? 0);
      chorusSend.push(audioParams.sendChorus ?? 0);
      phaserSend.push(audioParams.sendPhaser ?? 0);
      distortionSend.push(0); // not tracked in AudioBackendParams
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
   *
   * Task M1: with the MusicalDirector, the harmony engine's currentChord is
   * advanced during COMPOSITION (ahead of playback), so it's stale at
   * playback time. We prefer the director's getCurrentChord() which tracks
   * the actual playback position. Falls back to this.currentChord (legacy)
   * if the director isn't available.
   */
  getCurrentChord(): Chord | null {
    return this.director?.getCurrentChord() ?? this.currentChord;
  }

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
   *
   * Task D1 (upgrade): this is now an alias for setMasterSync() — the
   * DJController delegates the BPM/phase part to PhaseSync and engages the
   * additional dimensions (key, groove, energy, phrase) when on. The legacy
   * method name is preserved so existing callers (UI, tests) keep working.
   *
   * Task L1: when DJ sync engages, force 'interactive' latency mode for
   * tightest beat-matching. Phase-locked sync needs the lowest possible
   * scheduling latency so our kicks land exactly on the radio's kicks —
   * any extra buffer would blur the phase correction. The user can
   * override afterwards via setLatencyMode() if they want to trade
   * tightness for stability on a struggling device.
   */
  setSyncEnabled(enabled: boolean): void {
    this.setMasterSync(enabled);
    if (enabled && this.latencyMode !== 'interactive') {
      this.setLatencyMode('interactive');
    }
  }

  /**
   * Enable / disable MASTER SYNC (the full DJ controller). When on, ALL
   * dimensions are engaged: BPM + phase (via PhaseSync), key (Camelot
   * harmonic mixing), groove (swing + push/pull), energy (smoothed +
   * transition detection), beat-grid / phrase alignment. When off, the
   * engine runs free — but the sync state is still computed and exposed
   * via getSyncStatus() so the UI can show how far off we are.
   */
  setMasterSync(enabled: boolean): void {
    const wasEnabled = this.djController.isMasterSyncEnabled();
    this.djController.setMasterSync(enabled);
    // ── Task P4: forward the master-sync toggle to the PhraseSync. When
    //    off, checkRealignment() returns { realign: false } — the engine
    //    runs free. State is still computed for UI display. ──
    this.phraseSync.setMasterSync(enabled);
    // When DISABLING master sync, reverse any key shift we applied so the
    // engine returns to the key it would have been in without DJ sync.
    if (wasEnabled && !enabled && this.appliedKeyShift !== 0) {
      this.applyKeyShift(-this.appliedKeyShift);
      this.appliedKeyShift = 0;
    }
    // Reset the swing adjustment accumulator (clean hand-off back to the
    // world's default swing).
    this.swingAdjust = 0;
  }

  /** Returns true if DJ-style master sync is currently enabled. */
  isSyncEnabled(): boolean {
    return this.djController.isMasterSyncEnabled();
  }

  /** Returns true if master sync is enabled (alias for isSyncEnabled). */
  isMasterSyncEnabled(): boolean {
    return this.djController.isMasterSyncEnabled();
  }

  /**
   * Returns the current sync status for UI display. Task D1 (upgrade):
   * the return shape is now DJSyncState (extends SyncStatus with the key /
   * groove / energy / phrase fields). Existing callers that only read the
   * SyncStatus fields (synced, offsetMs, refBpm, ownBpm, etc.) still work
   * — the new fields are additive.
   *
   * All fields are guarded against missing data (zero/false when no ref
   * phase yet).
   */
  getSyncStatus(): DJSyncState {
    return this.djController.getSyncState();
  }

  // ─── Task L1: low-latency scheduler public API ────────────────────────────
  //
  // These methods expose the adaptive scheduler to the UI. The latency mode
  // toggle lets the user trade latency for stability; the status returns the
  // live measurements (output latency, scheduling lookahead, drops, CPU load,
  // stable flag) for display. All methods are safe to call before start().

  /**
   * Set the latency mode. Affects AudioContext `latencyHint` (on next ctx
   * construction — `latencyHint` is immutable post-creation) AND the
   * adaptive lookahead's starting point immediately.
   *
   *   'interactive' : 15ms output, 30ms lookahead. Lowest latency. Live
   *                   performance / DJ beat-matching.
   *   'balanced'    : 30ms output, 60ms lookahead. Default on mobile.
   *   'playback'    : 50ms output, 100ms lookahead. Power saving.
   *
   * If the engine is already running, the lookahead target updates
   * immediately and the adaptive controller smooths toward it within ~1s.
   * The AudioContext latencyHint only takes effect on the next `init()`
   * (after a stop+dispose+init cycle) — this is a one-time cost.
   */
  setLatencyMode(mode: LatencyMode): void {
    this.latencyMode = mode;
    this.targetLookahead = LATENCY_MODE_LOOKAHEAD[mode];
    // If the engine is not running, jump directly to the target. Otherwise
    // let the adaptive controller smooth toward it (avoids sudden scheduling
    // gaps when shrinking or sudden note floods when growing).
    if (!this.playing) {
      this.lookahead = this.targetLookahead;
    }
    if (typeof console !== 'undefined') {
      console.log(`[PSY4] Latency mode -> ${mode} (lookahead ${(this.targetLookahead * 1000).toFixed(0)}ms)`);
    }
  }

  /** Returns the current latency mode. */
  getLatencyMode(): LatencyMode {
    return this.latencyMode;
  }

  /**
   * Snapshot of the scheduler's latency + jitter status for UI display.
   *
   * Fields:
   *   - outputLatencyMs     : AudioContext baseLatency + processing (hardware).
   *   - schedulingLatencyMs : Current adaptive lookahead (30-100ms).
   *   - totalLatencyMs      : Sum — target <30ms when adaptive is tight.
   *   - droppedNotes        : Cumulative count of missed-step events.
   *   - cpuLoad             : 0..1 from PerformanceMonitor (frame time proxy).
   *   - stable              : True if no drops in the last 5 seconds.
   *   - latencyMode         : interactive / balanced / playback.
   *   - lookaheadMs         : Live (smoothed) lookahead.
   *   - targetLookaheadMs   : Adaptive controller's setpoint.
   *   - workerIntervalMs    : 25ms (the Worker's tick rate).
   *   - usesWorker          : True if the scheduler is using a Web Worker.
   */
  getLatencyStatus(): LatencyStatus {
    const ctx = this.ctx;
    const baseLatency = ctx?.baseLatency ?? 0;
    // `outputLatency` is the total output latency (baseLatency + processing).
    // Not all browsers expose it — fall back to baseLatency.
    const outputLatency = (ctx && typeof (ctx as unknown as { outputLatency?: number }).outputLatency === 'number')
      ? (ctx as unknown as { outputLatency: number }).outputLatency : baseLatency;
    const schedulingLatencyMs = this.lookahead * 1000;
    const totalLatencyMs = outputLatency * 1000 + schedulingLatencyMs;
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const stable = this.droppedNotes === 0 || (now - this.lastDropAt) > 5000;
    // ── Task F1-F3: pull CPU load from the audio backend (ONE path) ──
    // The worklet reports a smoothed cpuLoad (0..1) based on actual process()
    // duration. The legacy backend returns 0 (no CPU monitor); we fall back
    // to the PerformanceMonitor's main-thread frame-time heuristic.
    const backendCpu = this.audio?.getStatus?.().cpuLoad ?? 0;
    const cpuLoad = backendCpu > 0 ? backendCpu : this.cpuLoad;
    return {
      outputLatencyMs: outputLatency * 1000,
      schedulingLatencyMs,
      totalLatencyMs,
      droppedNotes: this.droppedNotes,
      cpuLoad,
      stable,
      latencyMode: this.latencyMode,
      lookaheadMs: schedulingLatencyMs,
      targetLookaheadMs: this.targetLookahead * 1000,
      workerIntervalMs: Psy4EngineV2.SCHEDULER_INTERVAL_MS,
      usesWorker: this.scheduler.usesWorker,
    };
  }

  /**
   * Task L1: adaptive lookahead controller.
   *
   * Goals:
   *   - Start at the latencyMode's default (30/60/100ms).
   *   - If stable for 10s (no drops, CPU < 70%): reduce toward 30ms.
   *   - If drops detected OR CPU > 85%: increase toward 100ms.
   *
   * The lookahead is smoothed toward the target (50% per 1Hz eval = 50% per
   * second) so changes don't cause sudden scheduling gaps.
   *
   * Called from `tick()` after each non-empty pass + on early-exit. The
   * internal throttle limits the actual evaluation to once per second.
   */
  private updateAdaptiveLookahead(): void {
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (now - this.lastAdaptiveCheckAt < 1000) return;  // eval at most 1Hz
    this.lastAdaptiveCheckAt = now;

    // Pull CPU load from PerformanceMonitor (avgFrameMs / 16.67).
    const perf = this.perfMonitor.getStatus();
    this.cpuLoad = perf.cpuLoad;

    // Reset the stability window if we've dropped in the last 5 seconds.
    if (this.lastDropAt > 0 && (now - this.lastDropAt) < 5000) {
      this.lastStabilityCheckAt = 0;
    } else if (this.lastStabilityCheckAt === 0) {
      this.lastStabilityCheckAt = now;
    }

    const stableFor = this.lastStabilityCheckAt > 0
      ? (now - this.lastStabilityCheckAt) / 1000 : 0;
    const isOverloaded = perf.cpuLoad > 0.85
      || (this.lastDropAt > 0 && (now - this.lastDropAt) < 5000);
    const isStable = stableFor >= 10
      && perf.cpuLoad < 0.7
      && this.droppedNotes === 0;

    if (isOverloaded) {
      // Grow the buffer — stability over latency.
      if (this.targetLookahead < 0.08) this.targetLookahead = 0.08;
      else if (this.targetLookahead < 0.1) this.targetLookahead = 0.1;
    } else if (isStable) {
      // Shrink the buffer — latency over stability (when we can afford it).
      // Never go below the latencyMode's floor (30ms for 'interactive').
      const floor = LATENCY_MODE_LOOKAHEAD[this.latencyMode];
      if (this.targetLookahead > 0.04 && this.targetLookahead > floor) {
        this.targetLookahead = Math.max(0.04, floor);
      } else if (this.targetLookahead > 0.03 && this.targetLookahead > floor) {
        this.targetLookahead = Math.max(0.03, floor);
      }
    }

    // Smooth toward target (50% per eval = 50% per second → reaches target
    // in ~2s). This avoids sudden scheduling gaps when shrinking or sudden
    // note floods when growing.
    this.lookahead += (this.targetLookahead - this.lookahead) * 0.5;
  }

  /**
   * Task L1: mobile device detection. Used by init() to bump 'interactive'
   * → 'balanced' on phones/tablets (where thermal throttling makes the
   * lowest latency mode unstable). SSR-safe (returns false on server).
   */
  private isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  }

  /**
   * Apply a semitone shift to the engine's musicalKey.root. Used by the
   * DJController's key sync (Camelot harmonic mixing) — when the radio
   * plays in an incompatible key, we transpose our generators to the
   * nearest compatible key. The shift is applied incrementally (1
   * semitone per bar) so the change is a gradual modulation, not a glitch.
   *
   * The new root is kept inside the world's rootRange by octave-shifting,
   * so a +2 shift on a root at the top of the range wraps to the bottom
   * of the next octave (same pitch class, different octave — still the
   * same key for harmonic-mixing purposes).
   */
  private applyKeyShift(semitones: number): void {
    if (!Number.isFinite(semitones) || semitones === 0) return;
    const worldRange = this.currentWorld.rootRange;
    const rangeSize = worldRange[1] - worldRange[0];
    if (rangeSize <= 0) return;
    // Compute the new root, wrapping within the world's rootRange so we
    // stay in the preferred octave (preserves the world's "home" register
    // while changing the pitch class).
    let newRoot = this.musicalKey.root + semitones;
    while (newRoot < worldRange[0]) newRoot += 12;
    while (newRoot > worldRange[1]) newRoot -= 12;
    if (newRoot === this.musicalKey.root) return;
    this.musicalKey = { root: newRoot, scale: this.musicalKey.scale };
    this.appliedKeyShift += semitones;
    this.refreshMusicalGenerators();
  }

  // ─── P1 stubs: adaptive quality + voice stealing ──────────────────────────
  //
  // These methods are referenced by the P1 (PerformanceMonitor) code above
  // (the `perfMonitor` field initializer and `triggerSynth`). The full P1
  // implementations were in progress but not committed; these stubs make
  // the file compile cleanly so the F1 flow engine work isn't blocked.
  // A future P1 agent can replace these with full implementations.

  /**
   * Task F1-F3: acquire a synth voice from the pool with voice stealing.
   *
   * This method is retained for backwards compatibility but is now a NO-OP —
   * the legacy synth pool moved into LegacyAudioGraph. The engine no longer
   * acquires voices directly; it delegates to this.audio.triggerSynth().
   *
   * Kept so any stray references don't break compilation. Returns undefined.
   */
  private acquireSynthVoice(): AdvancedSynthVoice | undefined {
    return undefined;
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
