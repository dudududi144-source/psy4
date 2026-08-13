/**
 * Call-and-response motif generator + variation operators.
 *
 * The first half of the step grid is the "call" (stable tones on strong beats,
 * step motion off-beat) and the second half is the "response" (degrees shifted
 * by `responseShift`, resolving to the root on the final step). Glide is only
 * applied to 1-3 semitone intervals between consecutive notes.
 */

import { Rng } from './rng'
import { type Scale, degreeToMidi, isInScale, nearestDegree, stableDegrees } from './scales'

export interface MotifNote {
  step: number
  midi: number
  velocity: number
  durationSteps: number
  glide: boolean
}

export interface MotifOptions {
  seed?: number
  steps?: number
  density?: number
  glideProb?: number
  responseShift?: number
  strongBeats?: number[]
}

export interface MotifTransform {
  transform: 'transpose' | 'invert' | 'fragment' | 'retrograde' | 'none'
  amount?: number
}

const DEFAULT_OPTS: Required<MotifOptions> = {
  seed: 1,
  steps: 32,
  density: 0.6,
  glideProb: 0.4,
  responseShift: 1,
  strongBeats: [0, 8, 16, 24],
}

/**
 * Generate a call-and-response motif over `opts.steps` 16th-note steps.
 * Deterministic for a given seed.
 */
export function generateMotif(rootPc: number, scale: Scale, opts: MotifOptions = {}): MotifNote[] {
  const o: Required<MotifOptions> = { ...DEFAULT_OPTS, ...opts }
  const rng = new Rng(o.seed)
  const notes: MotifNote[] = []
  const half = Math.floor(o.steps / 2)
  const stable = stableDegrees(scale)

  let prevMidi: number | null = null
  let lastDegree = 0

  const placeNote = (step: number, degree: number, velocity: number): void => {
    const midi = degreeToMidi(rootPc, scale, degree, 4)
    const delta = prevMidi === null ? 0 : Math.abs(midi - prevMidi)
    const glide = prevMidi !== null && delta >= 1 && delta <= 3 && rng.next() < o.glideProb
    notes.push({ step, midi, velocity, durationSteps: 2, glide })
    prevMidi = midi
    lastDegree = degree
  }

  // Call: stable tones on strong beats, step motion elsewhere.
  for (let step = 0; step < half; step++) {
    if (rng.next() > o.density) continue
    let degree: number
    if (o.strongBeats.includes(step)) {
      degree = stable[rng.int(0, stable.length - 1)] as number
    } else if (prevMidi === null) {
      degree = stable[rng.int(0, stable.length - 1)] as number
    } else {
      degree = lastDegree + rng.pick([-1, 1])
    }
    placeNote(step, degree, 0.7)
  }

  // Response: shifted stable tones, resolves to root on the final step.
  for (let step = half; step < o.steps; step++) {
    if (step === o.steps - 1) {
      const midi = degreeToMidi(rootPc, scale, 0, 4)
      notes.push({ step, midi, velocity: 0.85, durationSteps: 2, glide: false })
      prevMidi = midi
      lastDegree = 0
      continue
    }
    if (rng.next() > o.density) continue
    let degree: number
    if (o.strongBeats.includes(step)) {
      degree = (stable[rng.int(0, stable.length - 1)] as number) + o.responseShift
    } else {
      degree = lastDegree + rng.pick([-1, 1])
    }
    placeNote(step, degree, 0.7)
  }

  return notes
}

/**
 * Transpose every note by `degrees` scale steps. Each note is moved
 * individually to its new scale degree (preserving register), so the result
 * stays entirely within `scale`.
 */
export function transpose(
  notes: MotifNote[],
  rootPc: number,
  scale: Scale,
  degrees: number
): MotifNote[] {
  const len = scale.intervals.length
  if (len === 0) return notes.slice()
  return notes.map((n) => {
    const oldDegree = nearestDegree(rootPc, scale, n.midi)
    // Encode the note's absolute position (degree + octave bumps) and shift it.
    const rootAtOctave4 = 12 * 5 + rootPc
    const oldInterval = scale.intervals[oldDegree] as number
    const octaveOffset = Math.round((n.midi - rootAtOctave4 - oldInterval) / 12)
    const newAbsoluteDegree = oldDegree + degrees + len * octaveOffset
    return { ...n, midi: degreeToMidi(rootPc, scale, newAbsoluteDegree, 4) }
  })
}

/** Mirror the degree contour around the first note (first note unchanged). */
export function invert(notes: MotifNote[], rootPc: number, scale: Scale): MotifNote[] {
  if (notes.length === 0) return []
  const firstDeg = nearestDegree(rootPc, scale, notes[0].midi)
  return notes.map((n, i) => {
    if (i === 0) return { ...n }
    const deg = nearestDegree(rootPc, scale, n.midi)
    const delta = deg - firstDeg
    const newDeg = firstDeg - delta
    return { ...n, midi: degreeToMidi(rootPc, scale, newDeg, 4) }
  })
}

/** Keep only the first `count` notes. */
export function fragment(notes: MotifNote[], count: number): MotifNote[] {
  return notes.slice(0, Math.max(0, count))
}

/** Reverse note order (steps preserved). */
export function retrograde(notes: MotifNote[]): MotifNote[] {
  return notes.slice().reverse()
}

/** Apply a named transform. `amount` is used by transpose (scale steps) and fragment (note count). */
export function vary(
  notes: MotifNote[],
  rootPc: number,
  scale: Scale,
  transform: MotifTransform['transform'],
  amount = 1
): MotifNote[] {
  switch (transform) {
    case 'transpose':
      return transpose(notes, rootPc, scale, amount)
    case 'invert':
      return invert(notes, rootPc, scale)
    case 'fragment':
      return fragment(notes, amount)
    case 'retrograde':
      return retrograde(notes)
    case 'none':
      return notes.slice()
    default:
      return notes.slice()
  }
}

/** Whether every note in `notes` belongs to `scale` rooted at `rootPc`. */
export function allInScale(notes: MotifNote[], rootPc: number, scale: Scale): boolean {
  return notes.every((n) => isInScale(rootPc, scale, n.midi))
}
