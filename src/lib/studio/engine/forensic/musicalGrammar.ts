/**
 * Forensic Musical Grammar — scales, progressions, bass patterns, arrangement.
 *
 * Imports the deterministic grammar classes from the existing musicalGrammar.ts
 * (SeededRng, LeadMotif, AcidPattern, BASS_PATTERNS, scaleNote, etc.).
 *
 * Adds: chord progressions (for pad), the 11-section arrangement, and the
 * step() event generator that produces the musical timeline.
 *
 * DETERMINISM: All randomness flows from SeededRng, seeded by (seed, sectionIdx).
 * Same seed => same events => same audio. Always.
 */

import {
  SeededRng, LeadMotif, AcidPattern, BASS_PATTERNS,
  scaleNote, SCALES,
  type TensionShape, type BassPattern,
} from '../musicalGrammar';

// ─── Chord Progressions (for pad — arrays of scale degrees) ────────────────

export const CHORD_PROGRESSIONS: Record<string, number[][]> = {
  minor: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [4, 7, 11]],
  dorian: [[0, 3, 7], [3, 7, 10], [4, 7, 11], [6, 9, 12]],
  phrygian: [[0, 3, 7], [1, 4, 7], [3, 7, 10], [2, 5, 8]],
  phrygianDominant: [[0, 3, 7], [1, 4, 7], [3, 7, 10], [6, 9, 12]],
  harmonicMinor: [[0, 3, 7], [4, 7, 11], [5, 8, 12], [3, 7, 10]],
};

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// ─── Arrangement (11 sections) ─────────────────────────────────────────────

export interface ArrangementSection {
  type: string;
  bars: number;
  density: number;
  energy: number;
  bassOn: boolean;
  leadOn: boolean;
  acidOn: boolean;
  hatDensity: number;
  percDensity: number;
  fxDensity: number;
  variation: number;
  label: string;
}

// COMPACT arrangement for forensic analysis — 2-bar sections so that a
// 12-second render covers INTRO+GROOVE+BUILD+DROP, exercising ALL voices.
// Without this, bass/lead/acid params appear DEAD because they only play
// in drops, which start at bar 40+ in the full arrangement (30+ seconds).
export const ARRANGEMENT: ArrangementSection[] = [
  { type: 'intro',      bars: 2,  density: 0.2, energy: 0.3, bassOn: false, leadOn: false, acidOn: false, hatDensity: 0.2, percDensity: 0.1, fxDensity: 0.1, variation: 0, label: 'INTRO' },
  { type: 'groove',     bars: 2,  density: 0.5, energy: 0.5, bassOn: true,  leadOn: false, acidOn: false, hatDensity: 0.5, percDensity: 0.3, fxDensity: 0.15, variation: 0.3, label: 'GROOVE' },
  { type: 'build',      bars: 2,  density: 0.6, energy: 0.7, bassOn: true,  leadOn: false, acidOn: false, hatDensity: 0.6, percDensity: 0.4, fxDensity: 0.4, variation: 0.5, label: 'BUILD' },
  { type: 'dropA',      bars: 4,  density: 0.9, energy: 0.95, bassOn: true, leadOn: true,  acidOn: true,  hatDensity: 0.8, percDensity: 0.5, fxDensity: 0.2, variation: 0, label: 'DROP A' },
  { type: 'variation',  bars: 2,  density: 0.85, energy: 0.9, bassOn: true, leadOn: true,  acidOn: true,  hatDensity: 0.7, percDensity: 0.6, fxDensity: 0.25, variation: 0.6, label: 'VARIATION' },
  { type: 'break',      bars: 2,  density: 0.25, energy: 0.3, bassOn: false, leadOn: false, acidOn: false, hatDensity: 0.2, percDensity: 0.15, fxDensity: 0.3, variation: 0.7, label: 'BREAK' },
  { type: 'build2',     bars: 2,  density: 0.65, energy: 0.75, bassOn: true, leadOn: false, acidOn: false, hatDensity: 0.65, percDensity: 0.45, fxDensity: 0.45, variation: 0.4, label: 'BUILD 2' },
  { type: 'dropB',      bars: 4,  density: 0.95, energy: 1.0, bassOn: true, leadOn: true,  acidOn: true,  hatDensity: 0.85, percDensity: 0.55, fxDensity: 0.25, variation: 0.5, label: 'DROP B' },
  { type: 'breakdown',  bars: 2,  density: 0.3, energy: 0.4, bassOn: false, leadOn: true,  acidOn: false, hatDensity: 0.3, percDensity: 0.2, fxDensity: 0.35, variation: 0.6, label: 'BREAKDOWN' },
  { type: 'finalDrop',  bars: 4,  density: 1.0, energy: 1.0, bassOn: true, leadOn: true,  acidOn: true,  hatDensity: 0.9, percDensity: 0.6, fxDensity: 0.3, variation: 0.4, label: 'FINAL DROP' },
  { type: 'outro',      bars: 2,  density: 0.3, energy: 0.4, bassOn: true,  leadOn: false, acidOn: false, hatDensity: 0.3, percDensity: 0.2, fxDensity: 0.2, variation: 0.3, label: 'OUTRO' },
];

// ─── Section state (mutable, rebuilt per section) ──────────────────────────

export interface SectionState {
  type: string;
  bars: number;
  density: number;
  rng: SeededRng;
  energy: number;
  leadMotif: LeadMotif | null;
  acidPattern: AcidPattern | null;
  bassPatternIdx: number;
  tensionShape: TensionShape;
  bassOn: boolean;
  leadOn: boolean;
  acidOn: boolean;
  hatDensity: number;
  percDensity: number;
  fxDensity: number;
  variation: number;
  label: string;
}

export function buildSectionState(
  arrSection: ArrangementSection,
  seed: number,
  sectionIdx: number,
  worldRoot: number,
  worldScale: string,
  worldAcid: boolean,
  worldBassMode: 'roll' | 'off' | 'acid',
): SectionState {
  const grammarRng = new SeededRng(seed * 1000 + sectionIdx + 999);
  const leadMotif = arrSection.leadOn
    ? new LeadMotif(worldRoot, worldScale, grammarRng)
    : null;
  const acidPattern = (arrSection.acidOn && worldAcid)
    ? new AcidPattern(worldRoot, worldScale, grammarRng)
    : null;
  const bassPatterns = BASS_PATTERNS[worldBassMode] || BASS_PATTERNS.off;
  const bassPatternIdx = grammarRng.int(0, bassPatterns.length - 1);
  const typ = arrSection.type;
  const tensionShape: TensionShape =
    typ === 'build' || typ === 'build2' ? 'rise' :
    typ === 'break' || typ === 'breakdown' ? 'fall' : 'arc';

  return {
    type: typ,
    bars: arrSection.bars,
    density: arrSection.density,
    rng: grammarRng,
    energy: arrSection.energy,
    leadMotif,
    acidPattern,
    bassPatternIdx,
    tensionShape,
    bassOn: arrSection.bassOn,
    leadOn: arrSection.leadOn,
    acidOn: arrSection.acidOn,
    hatDensity: arrSection.hatDensity,
    percDensity: arrSection.percDensity,
    fxDensity: arrSection.fxDensity,
    variation: arrSection.variation,
    label: arrSection.label,
  };
}

// ─── Event (musical event scheduled at a specific time) ────────────────────

export interface MusicEvent {
  time: number;       // seconds from start
  voice: number;      // voice ID (V_KICK, V_BASS, etc.)
  note: number;       // MIDI note (for pitched voices) or 0
  velocity: number;   // 0..1
  duration: number;   // seconds
  param: number;      // extra param (e.g., FX type)
}

// ─── Macros (fixed for forensic rendering — no live control) ───────────────

export interface ForensicMacros {
  energy: number;
  psychedelia: number;
  darkness: number;
  density: number;
  groove: number;
  evolution: number;
  space: number;
  surprise: number;
  aggression: number;
  brightness: number;
}

export const DEFAULT_FORENSIC_MACROS: ForensicMacros = {
  energy: 0.6, psychedelia: 0.55, darkness: 0.4, density: 0.55,
  groove: 0.5, evolution: 0.5, space: 0.4, surprise: 0.3,
  aggression: 0.4, brightness: 0.55,
};

export { SCALES, BASS_PATTERNS, scaleNote, type BassPattern };
