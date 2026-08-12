/**
 * Rhythm patterns (16th-note grids) and transforms: swing, humanize, combine,
 * invert, density. Optional per-step velocities, probabilities, and micro-timing
 * offsets (in steps, fractional).
 */

import { Rng } from './rng'

export interface RhythmPattern {
  hits: boolean[]
  velocities?: number[]
  probabilities?: number[]
  micros?: number[]
}

export interface RhythmOptions {
  velocities?: number[]
  probabilities?: number[]
  micros?: number[]
}

/** Build a pattern from a hits array plus optional per-step data. */
export function rhythm(hits: boolean[], opts: RhythmOptions = {}): RhythmPattern {
  return {
    hits: hits.slice(),
    velocities: opts.velocities?.slice(),
    probabilities: opts.probabilities?.slice(),
    micros: opts.micros?.slice(),
  }
}

/** Four-on-the-floor: kick on every beat (steps 0, 4, 8, 12, ...). */
export function fourOnFloor(steps = 16): RhythmPattern {
  const hits = new Array<boolean>(steps).fill(false)
  for (let i = 0; i < steps; i += 4) hits[i] = true
  return { hits }
}

/** Offbeat hats: hits on the "and" of each beat (steps 2, 6, 10, 14, ...). */
export function offbeatHats(steps = 16): RhythmPattern {
  const hits = new Array<boolean>(steps).fill(false)
  for (let i = 2; i < steps; i += 4) hits[i] = true
  return { hits }
}

/** Psytrance kick: four kicks per bar on beats 1-4 (16-step grid). */
export function psyKick(): RhythmPattern {
  const hits = new Array<boolean>(16).fill(false)
  hits[0] = true
  hits[4] = true
  hits[8] = true
  hits[12] = true
  return { hits }
}

/** Backbeat: snare on beats 2 and 4 (steps 4 and 12). */
export function backbeat(steps = 16): RhythmPattern {
  const hits = new Array<boolean>(steps).fill(false)
  if (steps > 4) hits[4] = true
  if (steps > 12) hits[12] = true
  return { hits }
}

/** Driving hats: every step hit, downbeats accented (velocity 1.0 vs 0.5). */
export function drivingHats(steps = 16): RhythmPattern {
  const hits = new Array<boolean>(steps).fill(true)
  const velocities = new Array<number>(steps).fill(0.5)
  for (let i = 0; i < steps; i += 4) velocities[i] = 1.0
  return { hits, velocities }
}

/**
 * Swing: delay odd-indexed hits by `amount` (fraction of a step) via the
 * `micros` array. Hits and velocities are preserved.
 */
export function swing(pattern: RhythmPattern, amount: number): RhythmPattern {
  const n = pattern.hits.length
  const micros = pattern.micros ? pattern.micros.slice() : new Array<number>(n).fill(0)
  for (let i = 1; i < n; i += 2) {
    if (pattern.hits[i]) {
      micros[i] = (micros[i] as number) + amount
    }
  }
  return { ...pattern, micros }
}

/**
 * Humanize: add per-hit random timing offsets in [-amountSec, +amountSec].
 * Deterministic for a given seed.
 */
export function humanize(pattern: RhythmPattern, amountSec: number, seed: number): RhythmPattern {
  const rng = new Rng(seed)
  const n = pattern.hits.length
  const micros = pattern.micros ? pattern.micros.slice() : new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    if (pattern.hits[i]) {
      micros[i] = (micros[i] as number) + rng.range(-amountSec, amountSec)
    }
  }
  return { ...pattern, micros }
}

/** Combine two patterns: OR hits, max velocities. */
export function combine(a: RhythmPattern, b: RhythmPattern): RhythmPattern {
  const n = Math.max(a.hits.length, b.hits.length)
  const hits = new Array<boolean>(n).fill(false)
  const hasVel = a.velocities !== undefined || b.velocities !== undefined
  const velocities = hasVel ? new Array<number>(n).fill(0) : undefined
  for (let i = 0; i < n; i++) {
    const ha = i < a.hits.length && a.hits[i]
    const hb = i < b.hits.length && b.hits[i]
    hits[i] = ha || hb
    if (velocities) {
      const va = a.velocities && i < a.velocities.length ? (a.velocities[i] as number) : 0
      const vb = b.velocities && i < b.velocities.length ? (b.velocities[i] as number) : 0
      velocities[i] = Math.max(va, vb)
    }
  }
  return { hits, velocities }
}

/** Invert a pattern: every hit becomes a rest and vice versa. */
export function invertRhythm(pattern: RhythmPattern): RhythmPattern {
  return { ...pattern, hits: pattern.hits.map((h) => !h) }
}

/** Fraction of steps that are hits (0..1). */
export function density(pattern: RhythmPattern): number {
  const n = pattern.hits.length
  if (n === 0) return 0
  let count = 0
  for (const h of pattern.hits) if (h) count++
  return count / n
}
