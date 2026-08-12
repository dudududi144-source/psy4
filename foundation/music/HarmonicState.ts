/**
 * HarmonicState — F21 Phase 1: Real harmonic context.
 *
 * Replaces the static rootPc + scaleName with a chord progression model.
 * The bass targets chord roots, the lead targets chord tones, and
 * harmonic function (tonic/predominant/dominant) drives tension.
 */

import { type Scale, getScale, scalePcs, stableDegrees, degreeToMidi } from './primitives/scales';

export type HarmonicFunction = 'tonic' | 'predominant' | 'dominant' | 'passing' | 'suspension' | 'cadence';

export interface ChordVoicing {
  rootPc: number;       // 0-11
  bassDegree: number;   // scale degree for bass (usually 0 = root)
  chordTones: number[]; // scale degrees that are chord tones [root, third, fifth, etc.]
  tensionTones: number[]; // scale degrees that create tension [7th, 9th, etc.]
  function: HarmonicFunction;
  duration: number;     // in beats
}

export interface HarmonicState {
  rootPc: number;
  scaleName: string;
  scale: Scale;
  /** Chord per beat (4 per bar, 32 per 8-bar phrase) */
  progression: ChordVoicing[];
  /** Current chord index in the progression */
  currentChordIdx: number;
  /** Current harmonic function */
  currentFunction: HarmonicFunction;
  /** Next function (for anticipation) */
  nextFunction: HarmonicFunction;
  /** Harmonic tension (0-1, derived from function + non-chord tones) */
  harmonicTension: number;
  /** Cadence intent (are we heading toward a cadence?) */
  cadenceIntent: boolean;
  /** Confidence (0-1) */
  confidence: number;
}

/**
 * Generate a harmonic progression for a phrase.
 * The progression follows functional harmony: tonic → predominant → dominant → tonic
 */
export function generateHarmonicState(context: {
  rootPc: number;
  scaleName: string;
  section: string;
  phraseIndex: number;
  tension: number;
}): HarmonicState {
  const scale = getScale(context.scaleName) ?? getScale('phrygian-dominant')!;
  const rootPc = context.rootPc;
  const section = context.section;
  const phraseIdx = context.phraseIndex % 8;

  // Chord vocabulary for phrygian-dominant (the psytrance scale)
  // Degrees: 0=root, 1=minor 2nd, 2=minor 3rd, 3=4th, 4=5th, 5=minor 6th, 6=minor 7th
  const tonicChord: ChordVoicing = {
    rootPc, bassDegree: 0, chordTones: [0, 2, 4], tensionTones: [6, 1],
    function: 'tonic', duration: 4,
  };
  const predominantChord: ChordVoicing = {
    rootPc, bassDegree: 3, chordTones: [3, 5, 0], tensionTones: [2, 6],
    function: 'predominant', duration: 4,
  };
  const dominantChord: ChordVoicing = {
    rootPc, bassDegree: 4, chordTones: [4, 6, 1], tensionTones: [0, 2],
    function: 'dominant', duration: 4,
  };
  const passingChord: ChordVoicing = {
    rootPc, bassDegree: 1, chordTones: [1, 3, 5], tensionTones: [0, 4],
    function: 'passing', duration: 2,
  };
  const suspensionChord: ChordVoicing = {
    rootPc, bassDegree: 4, chordTones: [4, 0, 2], tensionTones: [6, 1],
    function: 'suspension', duration: 2,
  };
  const cadenceChord: ChordVoicing = {
    rootPc, bassDegree: 0, chordTones: [0, 2, 4], tensionTones: [],
    function: 'cadence', duration: 4,
  };

  // Build progression based on section + phrase position
  // 8 bars × 4 beats = 32 chord slots (but we use 1 chord per bar for simplicity,
  // or 2 per bar for more movement)
  const progression: ChordVoicing[] = [];
  const bars = 8;
  const chordsPerBar = section === 'CLIMAX' || section === 'DEVELOPMENT' ? 2 : 1;
  const totalChords = bars * chordsPerBar;

  for (let i = 0; i < totalChords; i++) {
    const barPos = Math.floor(i / chordsPerBar);
    const beatPos = (i % chordsPerBar) / chordsPerBar;
    const phraseProgress = (barPos + beatPos) / bars;

    if (section === 'INTRO') {
      // Static tonic — establishing key
      progression.push({ ...tonicChord, duration: 4 / chordsPerBar });
    } else if (section === 'STATEMENT') {
      // Tonic → predominant → back to tonic
      if (phraseProgress < 0.5) {
        progression.push({ ...tonicChord, duration: 4 / chordsPerBar });
      } else {
        progression.push({ ...predominantChord, duration: 4 / chordsPerBar });
      }
    } else if (section === 'DEVELOPMENT' || section === 'DEVELOPMENT2') {
      // More movement: tonic → predominant → dominant → tonic
      if (phraseProgress < 0.25) progression.push({ ...tonicChord, duration: 4 / chordsPerBar });
      else if (phraseProgress < 0.5) progression.push({ ...predominantChord, duration: 4 / chordsPerBar });
      else if (phraseProgress < 0.75) progression.push({ ...dominantChord, duration: 4 / chordsPerBar });
      else progression.push({ ...tonicChord, duration: 4 / chordsPerBar });
    } else if (section === 'CONTRAST') {
      // Passing chords + suspension
      if (phraseProgress < 0.3) progression.push({ ...passingChord, duration: 4 / chordsPerBar });
      else if (phraseProgress < 0.6) progression.push({ ...suspensionChord, duration: 4 / chordsPerBar });
      else progression.push({ ...dominantChord, duration: 4 / chordsPerBar });
    } else if (section === 'CLIMAX') {
      // Dominant tension → cadence at end
      if (phraseProgress < 0.7) progression.push({ ...dominantChord, duration: 4 / chordsPerBar });
      else progression.push({ ...cadenceChord, duration: 4 / chordsPerBar });
    } else {
      // RESOLUTION — back to tonic
      progression.push({ ...tonicChord, duration: 4 / chordsPerBar });
    }
  }

  // Determine current function and tension
  const currentChord = progression[0];
  const nextChord = progression[1] || progression[0];
  const harmonicTension = context.tension;

  return {
    rootPc,
    scaleName: context.scaleName,
    scale,
    progression,
    currentChordIdx: 0,
    currentFunction: currentChord.function,
    nextFunction: nextChord.function,
    harmonicTension,
    cadenceIntent: phraseIdx === 7 || section === 'CLIMAX',
    confidence: 0.5,
  };
}

/**
 * Get the chord active at a specific step (0-15) within a bar.
 */
export function getChordAtStep(harmonic: HarmonicState, step: number, barInPhrase: number): ChordVoicing {
  const chordsPerBar = harmonic.progression.length / 8;
  const chordIdx = Math.floor(barInPhrase * chordsPerBar + (step / 16) * chordsPerBar);
  return harmonic.progression[Math.min(chordIdx, harmonic.progression.length - 1)] || harmonic.progression[0];
}

/**
 * Check if a MIDI note is a chord tone at a given step.
 */
export function isChordTone(harmonic: HarmonicState, midi: number, step: number, barInPhrase: number): boolean {
  const chord = getChordAtStep(harmonic, step, barInPhrase);
  const pc = ((midi % 12) - harmonic.rootPc + 12) % 12;
  const scaleIntervals = harmonic.scale.intervals;
  // Find which scale degree this pitch class maps to
  for (let i = 0; i < scaleIntervals.length; i++) {
    if (scaleIntervals[i] === pc) {
      return chord.chordTones.includes(i);
    }
  }
  return false;
}

/**
 * Get the nearest chord tone to a given MIDI note.
 */
export function nearestChordTone(harmonic: HarmonicState, midi: number, step: number, barInPhrase: number): number {
  const chord = getChordAtStep(harmonic, step, barInPhrase);
  // Get chord tone MIDIs in the lead register (octave 3-4)
  const chordMidis: number[] = [];
  for (const degree of chord.chordTones) {
    chordMidis.push(degreeToMidi(harmonic.rootPc, harmonic.scale, degree, 3));
    chordMidis.push(degreeToMidi(harmonic.rootPc, harmonic.scale, degree, 4));
  }
  // Find nearest
  let nearest = chordMidis[0];
  let minDist = Math.abs(midi - nearest);
  for (const cm of chordMidis) {
    const dist = Math.abs(midi - cm);
    if (dist < minDist) { minDist = dist; nearest = cm; }
  }
  return nearest;
}
