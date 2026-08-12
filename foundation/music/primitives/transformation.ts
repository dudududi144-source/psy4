/**
 * Identity-preserving motif transformations.
 *
 * Each transformation takes a {@link Motif} and returns a new derived Motif.
 * The transform name is appended to the new motif's `transformHistory`, and
 * `sourceMotifId` points back at the input. The structural fingerprint
 * ({@link motifIdentity}) is preserved for shape-conserving transforms
 * (transpose, shiftRegister, rhythmicStretch, rhythmicDisplacement) and
 * remains recognisable (high similarity) for the disruptive ones
 * (invert, retrograde, contourMutation, intervalSubstitution, callResponse).
 */

import { type Motif, type MotifNote, createMotif } from './motif-v2'
import { Rng } from './rng'
import {
  type Scale,
  degreeToMidi,
  getScale,
  isInScale,
  nearestDegree,
  scalePcs,
  stableDegrees,
} from './scales'

/** Snap a MIDI note to the nearest in-scale note (within +/- 6 semitones). */
function snapToScale(midi: number, rootPc: number, scale: Scale): number {
  if (isInScale(rootPc, scale, midi)) return midi
  for (let offset = 1; offset <= 6; offset++) {
    if (isInScale(rootPc, scale, midi + offset)) return midi + offset
    if (isInScale(rootPc, scale, midi - offset)) return midi - offset
  }
  return midi
}

function deriveId(source: Motif, suffix: string): string {
  return `${source.id}:${suffix}`
}

function withTransform(source: Motif, notes: MotifNote[], steps: number, name: string): Motif {
  const derived = createMotif(notes, {
    id: deriveId(source, name),
    rootPc: source.rootPc,
    scaleName: source.scaleName,
    steps,
    role: source.role,
    sourceMotifId: source.id,
    transformHistory: [...source.transformHistory, name],
  })
  return derived
}

/** Shift all notes by N semitones, snapping each to the nearest scale tone. */
export function transpose(motif: Motif, semitones: number, rootPc: number, scale: Scale): Motif {
  const notes = motif.notes.map((n) => ({
    ...n,
    midi: snapToScale(n.midi + semitones, rootPc, scale),
  }))
  return withTransform(motif, notes, motif.steps, `transpose(${semitones})`)
}

/** Shift all notes by N octaves (preserves intervals and contour exactly). */
export function shiftRegister(motif: Motif, octaves: number): Motif {
  const delta = octaves * 12
  const notes = motif.notes.map((n) => ({ ...n, midi: n.midi + delta }))
  return withTransform(motif, notes, motif.steps, `shiftRegister(${octaves})`)
}

/**
 * Mirror intervals around the first note. The first note is unchanged; each
 * subsequent note's offset from the first is negated, then snapped to scale.
 */
export function invert(motif: Motif, rootPc: number, scale: Scale): Motif {
  if (motif.notes.length === 0) return withTransform(motif, [], motif.steps, 'invert')
  const first = motif.notes[0] as MotifNote
  const notes = motif.notes.map((n) => {
    if (n === first) return { ...n }
    const offset = n.midi - first.midi
    return { ...n, midi: snapToScale(first.midi - offset, rootPc, scale) }
  })
  return withTransform(motif, notes, motif.steps, 'invert')
}

/**
 * Reverse note order while keeping step positions. The sequence of MIDI
 * values is reversed and reassigned to the original step slots.
 */
export function retrograde(motif: Motif): Motif {
  const positions = motif.notes.map((n) => ({ step: n.step, durationSteps: n.durationSteps }))
  const reversedContent = motif.notes.slice().reverse()
  const notes = reversedContent.map((n, i) => ({
    ...n,
    step: positions[i]?.step ?? n.step,
    durationSteps: positions[i]?.durationSteps ?? n.durationSteps,
  }))
  return withTransform(motif, notes, motif.steps, 'retrograde')
}

/**
 * Rhythmic augmentation/diminution: multiply each note's step and duration
 * by `factor` (rounded). Total motif length is scaled accordingly.
 */
export function rhythmicStretch(motif: Motif, factor: number): Motif {
  if (factor <= 0) return withTransform(motif, [], motif.steps, `rhythmicStretch(${factor})`)
  const notes = motif.notes.map((n) => ({
    ...n,
    step: Math.round(n.step * factor),
    durationSteps: Math.max(1, Math.round(n.durationSteps * factor)),
  }))
  const steps = Math.max(1, Math.round(motif.steps * factor))
  return withTransform(motif, notes, steps, `rhythmicStretch(${factor})`)
}

/**
 * Shift all note onsets by `offsetSteps`, wrapping modulo motif.steps so the
 * motif length is preserved. Accent pattern shifts along with the notes.
 */
export function rhythmicDisplacement(motif: Motif, offsetSteps: number): Motif {
  if (motif.steps <= 0)
    return withTransform(motif, [], motif.steps, `rhythmicDisplacement(${offsetSteps})`)
  const notes = motif.notes.map((n) => ({
    ...n,
    step: (((n.step + offsetSteps) % motif.steps) + motif.steps) % motif.steps,
  }))
  return withTransform(motif, notes, motif.steps, `rhythmicDisplacement(${offsetSteps})`)
}

/**
 * Mutate some interval magnitudes while preserving contour direction. For
 * each interval, with probability `rate`, replace its magnitude with a
 * different value of the same sign drawn from scale-compatible intervals.
 * The original contour direction is computed from the ORIGINAL motif notes
 * (not the mutated ones) so the direction is preserved even when earlier
 * notes have already been mutated.
 */
export function contourMutation(motif: Motif, seed: number, rate: number): Motif {
  const scale = getScale(motif.scaleName)
  if (motif.notes.length < 2 || !scale) {
    return withTransform(motif, motif.notes.slice(), motif.steps, 'contourMutation')
  }
  const rng = new Rng(seed)
  const pcs = scalePcs(motif.rootPc, scale)
  // Build a palette of signed scale-compatible interval magnitudes.
  const palette: number[] = []
  for (const pc of pcs) {
    palette.push(pc, -pc)
  }
  if (palette.length === 0) palette.push(1, -1, 2, -2)

  const originalMidis = motif.notes.map((n) => n.midi)
  const newMidis: number[] = [originalMidis[0] ?? 0]
  for (let i = 1; i < originalMidis.length; i++) {
    const prevOrig = originalMidis[i - 1] as number
    const curOrig = originalMidis[i] as number
    const origInterval = curOrig - prevOrig
    const sign = origInterval > 0 ? 1 : origInterval < 0 ? -1 : 0
    const prevNew = newMidis[i - 1] as number

    if (sign === 0 || rng.next() >= rate) {
      // Preserve the original interval magnitude.
      newMidis.push(snapToScale(prevNew + origInterval, motif.rootPc, scale))
      continue
    }
    // Pick a different magnitude with the same sign, retrying to avoid the
    // original value. Snap may perturb the sign for very small magnitudes,
    // so we verify and fall back to the original interval if needed.
    let newInterval = origInterval
    let tries = 0
    while (tries < 8 && newInterval === origInterval) {
      const candidate = rng.pick(palette)
      if (Math.sign(candidate) === sign) newInterval = candidate
      tries++
    }
    const candidateMidi = snapToScale(prevNew + newInterval, motif.rootPc, scale)
    const actualInterval = candidateMidi - prevNew
    if (Math.sign(actualInterval) === sign) {
      newMidis.push(candidateMidi)
    } else {
      // Snap flipped the sign; fall back to original interval magnitude.
      newMidis.push(snapToScale(prevNew + origInterval, motif.rootPc, scale))
    }
  }
  const notes = motif.notes.map((n, i) => ({ ...n, midi: newMidis[i] as number }))
  return withTransform(motif, notes, motif.steps, `contourMutation(${rate})`)
}

/**
 * Substitute some intervals with scale-compatible alternatives (sign may
 * flip). Walks from the first note, recomputing each subsequent midi.
 */
export function intervalSubstitution(motif: Motif, seed: number, rate: number): Motif {
  const scale = getScale(motif.scaleName)
  if (motif.notes.length < 2 || !scale) {
    return withTransform(motif, motif.notes.slice(), motif.steps, 'intervalSubstitution')
  }
  const rng = new Rng(seed)
  const pcs = scalePcs(motif.rootPc, scale)
  const palette: number[] = pcs.length > 0 ? pcs.slice() : [0, 2, 4, 5, 7]
  const midis: number[] = motif.notes.map((n) => n.midi)
  for (let i = 1; i < midis.length; i++) {
    if (rng.next() >= rate) continue
    const prev = midis[i - 1] as number
    const pc = rng.pick(palette)
    const sign = rng.next() < 0.5 ? 1 : -1
    midis[i] = snapToScale(prev + sign * pc, motif.rootPc, scale)
  }
  const notes = motif.notes.map((n, i) => ({ ...n, midi: midis[i] as number }))
  return withTransform(motif, notes, motif.steps, `intervalSubstitution(${rate})`)
}

/**
 * Generate a call-and-response: shift the motif to a related scale degree
 * (fifth or fourth), then resolve the final note to the root. The response
 * is recognisably derived from the call but lands on the tonic.
 */
export function callResponse(motif: Motif, rootPc: number, scale: Scale, seed: number): Motif {
  const rng = new Rng(seed)
  const stable = stableDegrees(scale)
  // Prefer a fifth shift; fall back to a fourth or a stable degree.
  const candidates = stable.length >= 2 ? [stable[1] as number, stable[0] as number] : [4, 0]
  const shift = rng.pick(candidates)
  const first = motif.notes[0]
  const shiftMidi = first ? degreeToMidi(rootPc, scale, shift, 4) - first.midi : 0
  const notes = motif.notes.map((n, i) => {
    const isLast = i === motif.notes.length - 1
    if (isLast) {
      return { ...n, midi: degreeToMidi(rootPc, scale, 0, 4), accent: true }
    }
    return { ...n, midi: snapToScale(n.midi + shiftMidi, rootPc, scale) }
  })
  return withTransform(motif, notes, motif.steps, `callResponse(${shift})`)
}

/** Lookup the Scale object for a Motif's scaleName (or null if unknown). */
export function motifScale(motif: Motif): Scale | null {
  return getScale(motif.scaleName)
}

/** Re-derive a Motif's structural features from its notes (rarely needed externally). */
export function refreshMotif(motif: Motif): Motif {
  return createMotif(motif.notes, {
    id: motif.id,
    rootPc: motif.rootPc,
    scaleName: motif.scaleName,
    steps: motif.steps,
    role: motif.role,
    sourceMotifId: motif.sourceMotifId,
    transformHistory: motif.transformHistory,
  })
}

/** Test helper: is `midi` the nearest scale degree to itself? */
export function isScaleSnapped(midi: number, rootPc: number, scale: Scale): boolean {
  return isInScale(rootPc, scale, midi) && nearestDegree(rootPc, scale, midi) >= 0
}
