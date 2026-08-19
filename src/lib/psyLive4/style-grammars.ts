// src/lib/psyLive4/style-grammars.ts
// Ported from public/worklets/composition-worker-v2.js (lines 38-89).
// Each style defines: scale, motif shape, bass pattern, percussion density,
// hat decay, and lead cutoff. These drive the composer's note selection.
//
// HONEST NOTE: leadCutoff and hatDecay are now actually WIRED (unlike the old
// composition-worker where they were dead data). leadCutoff → CC74 to psysynth
// via the host's setStyle(); hatDecay → the `param` field on hat NoteEvents,
// read by HatVoice.trigger as a decayOverride.

export interface StyleGrammar {
  scaleName: 'phrygianDominant' | 'phrygian' | 'minor' | 'dorian';
  motifIntervals: number[];     // semitone offsets from root
  motifSteps: number[];         // 16th-note positions (0..15)
  bassSteps: number[];          // 16th-note positions (0..15)
  acidBass: boolean;            // use TB-303 acid voice instead of regular bass
  percussionDensity: number;    // 0..1 probability per bar
  hatDecay: number;             // seconds (sent to worklet as param)
  leadCutoff: number;            // Hz (sent to psysynth as CC74)
}

export const STYLE_GRAMMARS: Record<string, StyleGrammar> = {
  FULL_ON: {
    scaleName: 'phrygianDominant',
    motifIntervals: [0, 4, 7, 4],
    motifSteps: [0, 4, 8, 12],
    bassSteps: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15],
    acidBass: false,
    percussionDensity: 0.8,
    hatDecay: 0.04,
    leadCutoff: 3000,
  },
  DARK: {
    scaleName: 'phrygian',
    motifIntervals: [0, 1, 3, 1],
    motifSteps: [0, 6, 8, 14],
    bassSteps: [0, 3, 6, 8, 11, 14],
    acidBass: false,
    percussionDensity: 0.4,
    hatDecay: 0.06,
    leadCutoff: 1200,
  },
  PROGRESSIVE: {
    scaleName: 'dorian',
    motifIntervals: [0, 3, 5, 7],
    motifSteps: [0, 4, 8, 12],
    bassSteps: [1, 3, 5, 7, 9, 11, 13, 15],
    acidBass: false,
    percussionDensity: 0.6,
    hatDecay: 0.05,
    leadCutoff: 2000,
  },
  ACID: {
    scaleName: 'phrygianDominant',
    motifIntervals: [0, 1, 7, 1],
    motifSteps: [0, 4, 8, 12],
    bassSteps: [0, 3, 6, 9, 12, 15],
    acidBass: true,
    percussionDensity: 0.7,
    hatDecay: 0.04,
    leadCutoff: 2500,
  },
  GOA: {
    scaleName: 'phrygianDominant',
    motifIntervals: [0, 4, 7, 12],
    motifSteps: [0, 4, 8, 12],
    bassSteps: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15],
    acidBass: true,
    percussionDensity: 0.75,
    hatDecay: 0.04,
    leadCutoff: 2800,
  },
  HI_TECH: {
    scaleName: 'minor',
    motifIntervals: [0, 3, 7, 10, 12],
    motifSteps: [0, 3, 6, 9, 12, 15],
    bassSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    acidBass: false,
    percussionDensity: 0.9,
    hatDecay: 0.03,
    leadCutoff: 3500,
  },
  FOREST: {
    scaleName: 'phrygian',
    motifIntervals: [0, 1, 3, 7],
    motifSteps: [0, 6, 8, 14],
    bassSteps: [0, 3, 6, 8, 11, 14],
    acidBass: false,
    percussionDensity: 0.5,
    hatDecay: 0.05,
    leadCutoff: 1500,
  },
};

export const SCALES: Record<string, number[]> = {
  phrygianDominant: [0, 1, 4, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// Map UI style names to grammar keys (handles aliasing)
const STYLE_ALIASES: Record<string, string> = {
  fullOn: 'FULL_ON',
  dark: 'DARK',
  progressive: 'PROGRESSIVE',
  acid: 'ACID',
  // subgenres map to closest main style
  forest: 'FOREST',
  hiTech: 'HI_TECH',
  goa: 'GOA',
};

export function resolveGrammar(style: string): StyleGrammar {
  const key = STYLE_ALIASES[style] ?? style.toUpperCase();
  return STYLE_GRAMMARS[key] ?? STYLE_GRAMMARS.FULL_ON;
}
