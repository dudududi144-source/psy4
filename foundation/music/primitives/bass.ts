/**
 * Bass-line generators (kb3, four-on-floor, offbeat, syncopated) and tension
 * curves for shaping dynamics, density, and register over a track's duration.
 */

import { Rng } from './rng'
import { type Scale, degreeToMidi } from './scales'

export interface BassNote {
  step: number
  midi: number
  velocity: number
  durationSteps: number
}

export type BassStyle = 'kb3' | 'four-on-floor' | 'offbeat' | 'syncopated'

export interface BassPatternOptions {
  style?: BassStyle
  rootDegree?: number
  passingProb?: number
  octave?: number
  seed?: number
}

const DEFAULT_OPTS: Required<BassPatternOptions> = {
  style: 'kb3',
  rootDegree: 0,
  passingProb: 0.2,
  octave: 2,
  seed: 1,
}

const STEP_TABLE: Record<BassStyle, number[]> = {
  // Kick on beat 1 + bass on offbeats (1.5, 2.5, 3.5, 4.5) -> 5 notes.
  kb3: [0, 2, 6, 10, 14],
  'four-on-floor': [0, 4, 8, 12],
  offbeat: [2, 6, 10, 14],
  syncopated: [0, 3, 6, 10, 14],
}

/**
 * Generate a one-bar bass pattern. Kick-bearing steps get velocity 1.0, offbeat
 * bass notes get 0.7. With probability `passingProb`, a non-kick note becomes a
 * neighbour (passing) degree.
 */
export function generateBassPattern(
  rootPc: number,
  scale: Scale,
  opts: BassPatternOptions = {}
): BassNote[] {
  const o: Required<BassPatternOptions> = { ...DEFAULT_OPTS, ...opts }
  const rng = new Rng(o.seed)
  const steps = STEP_TABLE[o.style]
  const notes: BassNote[] = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as number
    const isKick = i === 0
    let degree = o.rootDegree
    if (!isKick && rng.next() < o.passingProb) {
      degree = o.rootDegree + rng.pick([-1, 1])
    }
    const midi = degreeToMidi(rootPc, scale, degree, o.octave)
    notes.push({
      step,
      midi,
      velocity: isKick ? 1.0 : 0.7,
      durationSteps: 2,
    })
  }

  return notes
}

export type TensionCurve = 'flat' | 'build' | 'release' | 'peak' | 'valley'

/**
 * Sample a tension curve at normalised position `t` in [0, 1].
 * - flat:    constant 0.5
 * - build:   linear rise 0 -> 1
 * - release: linear fall 1 -> 0
 * - peak:    triangle, max at t=0.5
 * - valley:  inverted triangle, min at t=0.5
 */
export function sampleTension(curve: TensionCurve, t: number): number {
  const tc = Math.max(0, Math.min(1, t))
  switch (curve) {
    case 'flat':
      return 0.5
    case 'build':
      return tc
    case 'release':
      return 1 - tc
    case 'peak':
      return 1 - Math.abs(2 * tc - 1)
    case 'valley':
      return Math.abs(2 * tc - 1)
    default:
      return 0.5
  }
}

/** Map tension [0,1] -> note density [0,1] (linear, monotonic). */
export function tensionToDensity(tension: number): number {
  return Math.max(0, Math.min(1, tension))
}

/** Map tension [0,1] -> octave. `base` is the octave at tension=0; +2 octaves at tension=1. */
export function tensionToOctave(tension: number, base = 3): number {
  return base + Math.round(Math.max(0, Math.min(1, tension)) * 2)
}
