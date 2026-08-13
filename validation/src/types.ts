/**
 * PSY4 Vertical Validation — Temporary Validation Types
 *
 * STATUS: EXPERIMENTAL SCHEMA. NOT ARCHITECTURE. NOT FINAL API.
 *
 * These types exist ONLY for the A/B/C/D/E vertical validation experiment.
 * They will be RATIFIED, MODIFIED, or ABANDONED based on experiment results.
 *
 * See: audit-reports/PSY4-PRE-RENDER-SNAPSHOT.md (FROZEN protocol)
 *
 * CompositionEvent is the temporary validation representation of a Foundation
 * note. Every field maps to a real Foundation type (MotifNote, BassNote,
 * RhythmPattern, MusicalContext). No invented fields. See PRE-RENDER SNAPSHOT
 * §4 for the GAP table (fields NOT in Foundation that PSY4 derives).
 */

// ─── CompositionEvent (validation contract — temporary) ─────────────────────
// Maps directly from Foundation's MotifNote/BassNote + MusicalContext.
// 6 fields. All derivable from Foundation's actual output.

export type SourceMaterial =
  | 'motif'        // from MotifPayload
  | 'bass-pattern' // from BassPatternPayload
  | 'drum-pattern' // from DrumPatternPayload (track name disambiguates)
  | 'fill'
  | 'fx-gesture'
  | 'texture';

export interface BarContext {
  tonic: number;             // MusicalContext.tonic (pitch class 0-11)
  scaleName: string;         // MusicalContext.scaleName
  bpm: number;               // MusicalContext.bpm
  barPosition: number;       // MusicalContext.barPosition
  phrasePosition: number;    // MusicalContext.phrasePosition
  harmonicContext: number[]; // MusicalContext.harmonicContext (chord pcs)
  tension: number;           // MusicalContext.tension (0-1)
}

export interface CompositionEvent {
  // ── FROM FOUNDATION NOTE TYPES ──
  step: number;              // 16th-note step index (Foundation's time unit)
  midi: number;              // absolute MIDI pitch (Foundation already realized)
  durationSteps: number;     // duration in 16th-note steps
  velocity: number;          // 0-1 (Foundation's performance intent)

  // ── FROM FOUNDATION MusicalContext ──
  barContext: BarContext;

  // ── FROM FOUNDATION MATERIAL KIND ──
  sourceMaterial: SourceMaterial;
  trackName?: string;        // for drum-pattern: which track (kick/hat/perc/...)
}

// ─── VoiceSpecification (validation DTO — temporary) ────────────────────────
// Built by PSY4 from CompositionEvent + context. Consumed by the renderer.
// NOT architecture. Will be ratified/modified/abandoned based on results.

export type VoiceSourceKind = 'sample' | 'synth' | 'hybrid';

export interface SynthGraph {
  oscillators: Array<{
    type: OscillatorType | 'periodic';  // 'periodic' = use PeriodicWave from recipe
    recipeIdx?: number;                 // index into HARMONIC_RECIPES (for 'periodic')
    frequency?: number;                 // Hz (for carrier). If undefined, uses note frequency
    ratio?: number;                     // for FM modulator: carrier * ratio
    detune: number;                     // cents
    role: 'carrier' | 'modulator' | 'unison';
    gain: number;                       // 0-1
  }>;
  filter: {
    type: BiquadFilterType;
    cutoff: number;        // Hz
    Q: number;
    envAmount: number;     // 0-1 (how much filter moves per note)
    envDecay: number;      // seconds (filter close time)
  };
  amplifier: {
    attack: number;  // seconds
    decay: number;   // seconds
    sustain: number; // 0-1
    release: number; // seconds
  };
  fmDepth?: number;        // FM modulation depth (Hz) — if FM mode
  lfo?: {
    rate: number;          // Hz
    depth: number;         // 0-1
    target: 'pitch' | 'filterCutoff' | 'amplitude';
  };
  saturation: { amount: number; character: number };  // 0-1, 0=soft 1=hard
  stereo: { width: number; motion: number };          // 0-1
}

export interface VoicePerformance {
  frequency: number;       // Hz (realized from midi)
  velocity: number;        // 0-1 (realized)
  durationSec: number;     // seconds (realized from durationSteps × BPM)
  microTimingSec: number;  // seconds offset (realized)
  articulation: 'legato' | 'staccato' | 'accent' | 'normal';
}

export interface AcousticTargets {
  fundamentalHz: number;
  register: 'sub' | 'bass' | 'low-mid' | 'mid' | 'high-mid' | 'high' | 'air';
  envelope: {
    attack: number;   // seconds
    decay: number;    // seconds
    sustain: number;  // 0-1
    release: number;  // seconds
  };
  groupConstraints?: {
    vsPartnerRole: string;
    frequencySeparation: number;  // Hz
    phaseOffset: number;          // degrees
    maskingBudget: number;        // 0-1
    sidechainRecovery: number;    // seconds
  };
  stereoPolicy: 'mono' | 'narrow' | 'wide' | 'moving';
}

export interface MixPlacement {
  channel: string;         // 'kick' | 'bass' | 'lead' | 'hat' | 'perc' | 'fx'
  gain: number;            // 0-1
  pan: number;             // -1 to 1
  sends: { reverb: number; delay: number };
  sidechain?: { source: string; amount: number; recovery: number };
  eq?: { low: number; mid: number; high: number };  // dB
}

export interface VoiceSpecification {
  // ── SOURCE ──
  source: { type: VoiceSourceKind; samplePath?: string; synthGraph?: SynthGraph; blend?: number };

  // ── PERFORMANCE (realized by PSY4) ──
  performance: VoicePerformance;

  // ── ACOUSTIC TARGETS (computed by pure function) ──
  acousticTargets: AcousticTargets;

  // ── MIX PLACEMENT ──
  mix: MixPlacement;
}

// ─── Experimental Unit (composition × seed) ─────────────────────────────────

export interface ExperimentalUnit {
  compositionId: 'comp-1' | 'comp-2' | 'comp-3';
  seed: 1 | 2 | 3;
  bpm: number;
  bars: number;
  events: CompositionEvent[];   // the Foundation output (frozen, same for A/B/C/D/E)
}

// ─── Variant identifier ─────────────────────────────────────────────────────

export type Variant = 'A' | 'B' | 'C' | 'D' | 'E';

export interface RenderId {
  compositionId: ExperimentalUnit['compositionId'];
  seed: ExperimentalUnit['seed'];
  variant: Variant;
}

export const ALL_VARIANTS: Variant[] = ['A', 'B', 'C', 'D', 'E'];
