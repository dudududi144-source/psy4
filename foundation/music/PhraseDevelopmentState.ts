/**
 * PhraseDevelopmentState — F21 Phase 1: Real phrase development.
 *
 * This is NOT an observational object. It is a CAUSAL state that determines
 * how phrase N+1 is generated from phrase N. Each phrase inherits material
 * from its parent and transforms it using a development operator.
 */

export type DevelopmentOperator =
  | 'CONTINUE'    // extend previous phrase's motif (same identity, new notes)
  | 'DEVELOP'     // transform motif (fragment, extend, vary rhythm)
  | 'ANSWER'      // create response to previous phrase (call/response)
  | 'CONTRAST'    // create opposing phrase (different rhythm/contour)
  | 'BUILD'       // increase tension/density toward climax
  | 'SUSPEND'     // hold tension, delay resolution
  | 'RESOLVE'     // resolve previous phrase's tension
  | 'CADENCE';    // final resolution to tonic

export interface PhraseNote {
  step: number;
  midi: number;
  velocity: number;
}

export interface PhraseRecord {
  phraseId: string;
  parentPhraseId: string | null;
  motifId: string;
  operator: DevelopmentOperator;
  /** The actual notes of this phrase (for inheritance) */
  notes: PhraseNote[];
  /** Rhythm pattern (16 booleans — which steps have notes) */
  rhythm: boolean[];
  /** Contour (direction per note: -1, 0, +1) */
  contour: number[];
  /** Average register */
  register: number;
  /** Tension level at start */
  tensionStart: number;
  /** Tension level at end */
  tensionTarget: number;
  /** Energy at start */
  energyStart: number;
  /** Energy at end */
  energyTarget: number;
  /** Bar where phrase starts */
  startBar: number;
}

export interface PhraseDevelopmentState {
  /** Current phrase being generated */
  current: PhraseRecord | null;
  /** Previous phrase (for development) */
  previous: PhraseRecord | null;
  /** Phrase before previous (for longer-term development) */
  beforePrevious: PhraseRecord | null;
  /** Current development operator */
  operator: DevelopmentOperator;
  /** Phrase index (0-7 within a section) */
  phraseIndex: number;
  /** Motif family ID (shared across developed phrases) */
  motifFamilyId: string;
}

export function createInitialPhraseState(): PhraseDevelopmentState {
  return {
    current: null,
    previous: null,
    beforePrevious: null,
    operator: 'CONTINUE',
    phraseIndex: 0,
    motifFamilyId: 'motif-0',
  };
}

/**
 * Select the development operator for the next phrase based on position.
 * This creates an intentional development arc, not random variation.
 */
export function selectDevelopmentOperator(phraseIndex: number, section: string): DevelopmentOperator {
  const idx = phraseIndex % 8;

  // Default arc: CONTINUE → DEVELOP → ANSWER → CONTRAST → DEVELOP → BUILD → CADENCE → RESOLVE
  const defaultArc: DevelopmentOperator[] = [
    'CONTINUE', 'DEVELOP', 'ANSWER', 'CONTRAST',
    'DEVELOP', 'BUILD', 'CADENCE', 'RESOLVE',
  ];

  // Section-specific overrides
  if (section === 'INTRO') {
    if (idx <= 1) return 'CONTINUE';
    return 'DEVELOP';
  }
  if (section === 'CLIMAX') {
    if (idx <= 2) return 'BUILD';
    if (idx <= 5) return 'SUSPEND';
    return 'CADENCE';
  }
  if (section === 'RESOLUTION') {
    return 'RESOLVE';
  }

  return defaultArc[idx];
}

/**
 * Transform a phrase's notes using a development operator.
 * This produces NEW material that is recognizably related to the parent.
 */
export function transformPhrase(
  parent: PhraseRecord,
  operator: DevelopmentOperator,
  rootPc: number,
  scaleIntervals: number[],
): PhraseNote[] {
  if (parent.notes.length === 0) return [];

  const parentNotes = parent.notes;
  const transformed: PhraseNote[] = [];

  switch (operator) {
    case 'CONTINUE': {
      // Same motif, extend by adding 1-2 notes at the end
      for (const n of parentNotes) {
        if (!n || n.midi === undefined || n.midi === null) continue;
        transformed.push({ ...n });
      }
      // Add a continuation note — same direction as last interval
      if (parentNotes.length >= 2) {
        const lastInterval = parentNotes[parentNotes.length - 1].midi - parentNotes[parentNotes.length - 2].midi;
        const lastStep = parentNotes[parentNotes.length - 1].step;
        const newStep = Math.min(15, lastStep + 2);
        const newMidi = Math.max(48, Math.min(72, parentNotes[parentNotes.length - 1].midi + lastInterval));
        transformed.push({ step: newStep, midi: newMidi, velocity: 0.5 });
      }
      break;
    }
    case 'DEVELOP': {
      // Fragment: keep first 60% of notes, transpose intervals by +1 scale degree
      const keepCount = Math.max(2, Math.floor(parentNotes.length * 0.6));
      for (let i = 0; i < keepCount && i < parentNotes.length; i++) {
        const n = parentNotes[i];
        if (!n || n.midi === undefined || n.midi === null) continue;
        // Shift pitch up by 1 scale degree
        const shiftedMidi = n.midi + (scaleIntervals[1] || 2);
        transformed.push({
          step: n.step,
          midi: Math.max(48, Math.min(72, shiftedMidi)),
          velocity: n.velocity,
        });
      }
      break;
    }
    case 'ANSWER': {
      // Invert contour, same rhythm, complementary register
      for (const n of parentNotes) {
        if (!n || n.midi === undefined || n.midi === null) continue;
        if (n.midi === undefined || n.midi === null) continue;
        // Invert around the average register
        const avgRegister = parent.register;
        const invertedMidi = Math.round(2 * avgRegister - n.midi);
        transformed.push({
          step: n.step,
          midi: Math.max(48, Math.min(72, invertedMidi)),
          velocity: n.velocity * 0.8, // slightly softer — it's an answer
        });
      }
      break;
    }
    case 'CONTRAST': {
      // Different rhythm: shift all notes by +2 steps (syncopation)
      for (const n of parentNotes) {
        if (!n || n.midi === undefined || n.midi === null) continue;
        const newStep = (n.step + 2) % 16;
        transformed.push({
          step: newStep,
          midi: n.midi,
          velocity: n.velocity,
        });
      }
      break;
    }
    case 'BUILD': {
      // Increase density: add notes between existing ones, raise register
      for (let i = 0; i < parentNotes.length; i++) {
        const n = parentNotes[i];
        // Raise register
        transformed.push({
          step: n.step,
          midi: Math.min(72, n.midi + 2),
          velocity: Math.min(0.95, n.velocity + 0.1),
        });
        // Add a note between this and next
        if (i < parentNotes.length - 1) {
          const nextStep = parentNotes[i + 1].step;
          if (nextStep - n.step > 2) {
            const midStep = Math.floor((n.step + nextStep) / 2);
            const midMidi = Math.min(72, n.midi + 1);
            transformed.push({ step: midStep, midi: midMidi, velocity: 0.4 });
          }
        }
      }
      break;
    }
    case 'SUSPEND': {
      // Hold tension: same notes but sustained (reduce count, hold longer)
      // Keep every other note
      for (let i = 0; i < parentNotes.length; i += 2) {
        transformed.push({ ...parentNotes[i], velocity: parentNotes[i].velocity * 0.9 });
      }
      break;
    }
    case 'RESOLVE':
    case 'CADENCE': {
      // Resolve: target chord tones, reduce density, descend to root
      // Keep only strong-beat notes, move toward root
      for (const n of parentNotes) {
        if (!n || n.midi === undefined || n.midi === null) continue;
        if (n.step % 4 === 0) {
          // Move toward root (lower register)
          const rootMidi = 48 + (rootPc % 12); // root at octave 3
          const resolvedMidi = n.midi > rootMidi
            ? Math.max(rootMidi, n.midi - 2)
            : n.midi;
          transformed.push({
            step: n.step,
            midi: resolvedMidi,
            velocity: n.velocity * 0.85,
          });
        }
      }
      // Ensure final note is root
      if (transformed.length > 0) {
        transformed[transformed.length - 1].midi = 48 + (rootPc % 12);
      }
      break;
    }
  }

  return transformed;
}

/**
 * Create a PhraseRecord from generated notes.
 */
export function createPhraseRecord(
  notes: PhraseNote[],
  phraseId: string,
  parentPhraseId: string | null,
  motifId: string,
  operator: DevelopmentOperator,
  startBar: number,
  tensionStart: number,
  tensionTarget: number,
  energyStart: number,
  energyTarget: number,
): PhraseRecord {
  const rhythm = new Array(16).fill(false);
  for (const n of notes) rhythm[n.step] = true;

  const contour: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    contour.push(Math.sign(notes[i].midi - notes[i - 1].midi));
  }

  const register = notes.length > 0
    ? notes.reduce((s, n) => s + n.midi, 0) / notes.length
    : 60;

  return {
    phraseId, parentPhraseId, motifId, operator,
    notes, rhythm, contour, register,
    tensionStart, tensionTarget, energyStart, energyTarget,
    startBar,
  };
}

/**
 * Measure motif similarity between two phrases.
 * Returns 0-1 where 1 = identical contour.
 */
export function motifSimilarity(a: PhraseRecord, b: PhraseRecord): number {
  if (a.contour.length === 0 || b.contour.length === 0) return 0;

  // Compare contour direction sequences
  const minLen = Math.min(a.contour.length, b.contour.length);
  let matches = 0;
  for (let i = 0; i < minLen; i++) {
    if (a.contour[i] === b.contour[i]) matches++;
  }
  return matches / minLen;
}
