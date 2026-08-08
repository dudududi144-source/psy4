/**
 * HOOK GENERATOR — creates memorable musical motifs.
 *
 * A hook has: identity, repetition, variation, development, resolution.
 * Not random notes — a melodic phrase the listener can recognize and remember.
 *
 * Hook types:
 *   - bass motif (rolling/acid/offbeat pattern)
 *   - lead phrase (melodic contour with call/response)
 *   - arpeggio (scale-aware pattern with rhythmic variation)
 *   - acid phrase (resonant filter sweep pattern)
 *   - rhythmic motif (percussive identity)
 *
 * REAL IMPLEMENTATION.
 */

import { Rng } from '../rng';
import { SCALES, scaleNote } from '../dsp/wavetable';

export type HookType = 'bass' | 'lead' | 'arp' | 'acid' | 'rhythm';

export interface Hook {
  id: string;
  type: HookType;
  /** Scale degrees (relative to root). */
  degrees: number[];
  /** Rhythm: step indices (0..15) where notes fire. */
  rhythm: number[];
  /** Velocities (0..1) per note. */
  velocities: number[];
  /** Accents (which notes are emphasized). */
  accents: boolean[];
  /** Contour direction: 'up' | 'down' | 'arch' | 'wave' | 'static'. */
  contour: string;
  /** Octave offset from base. */
  octave: number;
  /** Born at bar. */
  bornAt: number;
  /** Variation count. */
  variationCount: number;
}

/** Generate a hook based on type + world characteristics. */
export function generateHook(type: HookType, rng: Rng, bornAt: number = 0): Hook {
  switch (type) {
    case 'bass': return generateBassHook(rng, bornAt);
    case 'lead': return generateLeadHook(rng, bornAt);
    case 'arp': return generateArpHook(rng, bornAt);
    case 'acid': return generateAcidHook(rng, bornAt);
    case 'rhythm': return generateRhythmHook(rng, bornAt);
  }
}

/** Bass hook: rolling 16th pattern with root-fifth-octave movement. */
function generateBassHook(rng: Rng, bornAt: number): Hook {
  const degrees: number[] = [];
  const rhythm: number[] = [];
  const velocities: number[] = [];
  const accents: boolean[] = [];
  // psytrance bass: off-beat 16ths with root-fifth pattern
  for (let s = 0; s < 16; s++) {
    if (s % 2 === 1) {
      rhythm.push(s);
      // pattern: 0 0 4 0 7 0 4 0 (root, root, fifth, root, octave, root, fifth, root)
      const pattern = [0, 0, 4, 0, 7, 0, 4, 0];
      degrees.push(pattern[(rhythm.length - 1) % pattern.length]);
      velocities.push(s % 4 === 1 ? 0.9 : 0.75); // accent on first off-beat of each beat
      accents.push(s % 4 === 1);
    }
  }
  return {
    id: `hook-bass-${rng.nextUint32().toString(36)}`,
    type: 'bass', degrees, rhythm, velocities, accents,
    contour: 'static', octave: 0, bornAt, variationCount: 0,
  };
}

/** Lead hook: melodic phrase with contour (arch/wave) + call/response structure. */
function generateLeadHook(rng: Rng, bornAt: number): Hook {
  const degrees: number[] = [];
  const rhythm: number[] = [];
  const velocities: number[] = [];
  const accents: boolean[] = [];
  // 4-note motif with arch contour: rise → peak → fall
  const numNotes = rng.int(4, 6);
  const contourType = rng.pick(['arch', 'wave', 'up']);
  let prev = 0;
  for (let i = 0; i < numNotes; i++) {
    let step: number;
    if (contourType === 'arch') {
      // rise for first half, fall for second
      step = i < numNotes / 2 ? rng.pick([1, 2, 1]) : rng.pick([-1, -2, -1]);
    } else if (contourType === 'wave') {
      step = i % 2 === 0 ? rng.pick([1, 2]) : rng.pick([-1, -2]);
    } else {
      step = rng.pick([1, 1, 2]);
    }
    prev = Math.max(-3, Math.min(7, prev + step));
    degrees.push(prev);
    // rhythm: place notes at musical positions (downbeats + offbeats)
    rhythm.push(i * 2 + (i > 0 && rng.chance(0.3) ? 1 : 0));
    velocities.push(i === 0 || i === Math.floor(numNotes / 2) ? 0.8 : 0.55); // accent first + peak
    accents.push(i === 0 || i === Math.floor(numNotes / 2));
  }
  return {
    id: `hook-lead-${rng.nextUint32().toString(36)}`,
    type: 'lead', degrees, rhythm, velocities, accents,
    contour: contourType, octave: 1, bornAt, variationCount: 0,
  };
}

/** Arp hook: ascending/descending scale pattern. */
function generateArpHook(rng: Rng, bornAt: number): Hook {
  const pattern = rng.pick([
    [0, 2, 4, 7, 4, 2],   // ascending then descending
    [0, 4, 7, 4, 0, 4],   // root-fifth-octave
    [0, 3, 5, 7, 5, 3],   // minor arp
    [7, 4, 2, 0, 2, 4],   // descending
  ]);
  const rhythm: number[] = [];
  const velocities: number[] = [];
  const accents: boolean[] = [];
  for (let i = 0; i < pattern.length; i++) {
    rhythm.push(i * 2 + 1); // off-beat 16ths
    velocities.push(i === 0 ? 0.7 : 0.5);
    accents.push(i === 0);
  }
  return {
    id: `hook-arp-${rng.nextUint32().toString(36)}`,
    type: 'arp', degrees: pattern, rhythm, velocities, accents,
    contour: 'wave', octave: 1, bornAt, variationCount: 0,
  };
}

/** Acid hook: chromatic-ish phrase with filter sweep implied. */
function generateAcidHook(rng: Rng, bornAt: number): Hook {
  const degrees: number[] = [];
  const rhythm: number[] = [];
  const velocities: number[] = [];
  const accents: boolean[] = [];
  // acid: tight 16th pattern with semitone movement
  const numNotes = rng.int(6, 8);
  let prev = 0;
  for (let i = 0; i < numNotes; i++) {
    const step = rng.pick([-1, 0, 0, 1, 2, 0, -1]);
    prev = Math.max(-2, Math.min(5, prev + step));
    degrees.push(prev);
    rhythm.push(i * 2);
    velocities.push(i % 2 === 0 ? 0.75 : 0.5);
    accents.push(i % 4 === 0);
  }
  return {
    id: `hook-acid-${rng.nextUint32().toString(36)}`,
    type: 'acid', degrees, rhythm, velocities, accents,
    contour: 'wave', octave: 0, bornAt, variationCount: 0,
  };
}

/** Rhythm hook: percussive identity pattern. */
function generateRhythmHook(rng: Rng, bornAt: number): Hook {
  const rhythm: number[] = [];
  const velocities: number[] = [];
  const accents: boolean[] = [];
  const degrees: number[] = [];
  // 4-on-floor kick + syncopated percussion
  for (let s = 0; s < 16; s++) {
    if (s % 4 === 0) { rhythm.push(s); degrees.push(0); velocities.push(0.95); accents.push(true); }
    else if (s % 4 === 2 && rng.chance(0.6)) { rhythm.push(s); degrees.push(1); velocities.push(0.6); accents.push(false); }
    else if (s % 2 === 1 && rng.chance(0.4)) { rhythm.push(s); degrees.push(2); velocities.push(0.35); accents.push(false); }
  }
  return {
    id: `hook-rhythm-${rng.nextUint32().toString(36)}`,
    type: 'rhythm', degrees, rhythm, velocities, accents,
    contour: 'static', octave: 0, bornAt, variationCount: 0,
  };
}

/** Transform a hook (variation while preserving identity). */
export function transformHook(hook: Hook, rng: Rng, transformType: 'transpose' | 'rhythmic' | 'density' | 'register' = 'rhythmic'): Hook {
  const newDegrees = [...hook.degrees];
  const newRhythm = [...hook.rhythm];
  const newVelocities = [...hook.velocities];
  switch (transformType) {
    case 'transpose':
      // shift all notes by a small interval
      const shift = rng.pick([2, 3, 5, -2, -3]);
      for (let i = 0; i < newDegrees.length; i++) newDegrees[i] += shift;
      break;
    case 'rhythmic':
      // shift one note's position by ±1 step
      if (newRhythm.length > 0) {
        const idx = rng.int(0, newRhythm.length - 1);
        newRhythm[idx] = Math.max(0, Math.min(15, newRhythm[idx] + rng.pick([-1, 1])));
      }
      break;
    case 'density':
      // add or remove one note
      if (rng.chance(0.5) && newRhythm.length > 2) {
        // remove
        const idx = rng.int(0, newRhythm.length - 1);
        newDegrees.splice(idx, 1); newRhythm.splice(idx, 1); newVelocities.splice(idx, 1);
      } else {
        // add
        const pos = rng.int(0, 15);
        if (!newRhythm.includes(pos)) {
          newRhythm.push(pos); newDegrees.push(rng.pick([0, 2, 4])); newVelocities.push(0.5);
        }
      }
      break;
    case 'register':
      // shift octave
      return { ...hook, octave: hook.octave + rng.pick([-1, 1]), variationCount: hook.variationCount + 1 };
  }
  return {
    ...hook,
    degrees: newDegrees, rhythm: newRhythm, velocities: newVelocities,
    id: `${hook.id}-v${hook.variationCount + 1}`,
    variationCount: hook.variationCount + 1,
  };
}

/** Resolve hook notes to absolute MIDI notes. */
export function resolveHook(hook: Hook, root: number, scaleName: string): { note: number; step: number; velocity: number; accent: boolean }[] {
  const scale = SCALES[scaleName] || SCALES.minor;
  return hook.rhythm.map((step, i) => ({
    note: scaleNote(root + hook.octave * 12, scale, hook.degrees[i] || 0),
    step,
    velocity: hook.velocities[i] || 0.6,
    accent: hook.accents[i] || false,
  }));
}
