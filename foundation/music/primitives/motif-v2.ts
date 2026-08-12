/**
 * Structural Motif representation (v2).
 *
 * A Motif here is NOT a bare list of MIDI notes — it carries computed
 * structural features (contour, intervals, pitch classes, register,
 * rhythmic density, accent pattern) that survive transposition and other
 * identity-preserving transformations. The {@link motifIdentity} fingerprint
 * is based on contour direction + interval classes + accent pattern, so two
 * motifs that share the same shape but live in different registers or
 * transpositions still match.
 */

export interface MotifNote {
  /** Step index within the motif (0-based). */
  step: number
  /** MIDI note number. */
  midi: number
  /** Velocity 0..1. */
  velocity: number
  /** Duration in steps. */
  durationSteps: number
  /** Is this an accented note? */
  accent: boolean
}

export interface Motif {
  id: string
  /** Root pitch class (0-11). */
  rootPc: number
  /** Scale used for generation. */
  scaleName: string
  notes: MotifNote[]
  /** Total steps in the motif. */
  steps: number
  /** Role label: 'lead' | 'bass' | 'hat' | ... */
  role: string
  /** Direction of each interval (+1 up, -1 down, 0 same). */
  contour: number[]
  /** Semitone intervals between consecutive notes. */
  intervals: number[]
  /** Unique pitch classes used (0-11). */
  pitchClasses: number[]
  /** MIDI range used. */
  register: { min: number; max: number }
  /** Fraction of steps that have a note onset. */
  rhythmicDensity: number
  /** Which steps are accented (length = steps). */
  accentPattern: boolean[]
  /** If derived, the source motif id. */
  sourceMotifId?: string
  /** Stack of transform names applied to derive this motif. */
  transformHistory: string[]
}

export interface CreateMotifOptions {
  id: string
  rootPc: number
  scaleName: string
  steps: number
  role?: string
  sourceMotifId?: string
  transformHistory?: string[]
}

let idCounter = 0
function defaultId(): string {
  idCounter += 1
  return `motif-${idCounter.toString(36)}`
}

/** Direction of an interval: +1 up, -1 down, 0 same. */
function intervalDirection(interval: number): number {
  if (interval > 0) return 1
  if (interval < 0) return -1
  return 0
}

/** Build a Motif from raw notes, computing all structural features. */
export function createMotif(notes: MotifNote[], opts: CreateMotifOptions): Motif {
  const sorted = notes.slice().sort((a, b) => a.step - b.step)
  const intervals: number[] = []
  const contour: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as MotifNote
    const cur = sorted[i] as MotifNote
    const iv = cur.midi - prev.midi
    intervals.push(iv)
    contour.push(intervalDirection(iv))
  }
  const pcSet = new Set<number>()
  let minMidi = Number.POSITIVE_INFINITY
  let maxMidi = Number.NEGATIVE_INFINITY
  for (const n of sorted) {
    pcSet.add(((n.midi % 12) + 12) % 12)
    if (n.midi < minMidi) minMidi = n.midi
    if (n.midi > maxMidi) maxMidi = n.midi
  }
  const pitchClasses = Array.from(pcSet).sort((a, b) => a - b)
  const register = {
    min: sorted.length === 0 ? 0 : minMidi,
    max: sorted.length === 0 ? 0 : maxMidi,
  }
  const accentPattern = new Array<boolean>(Math.max(1, opts.steps)).fill(false)
  for (const n of sorted) {
    if (n.step >= 0 && n.step < accentPattern.length) accentPattern[n.step] = n.accent
  }
  const rhythmicDensity = opts.steps > 0 ? Math.min(1, sorted.length / opts.steps) : 0
  return {
    id: opts.id || defaultId(),
    rootPc: opts.rootPc,
    scaleName: opts.scaleName,
    notes: sorted,
    steps: opts.steps,
    role: opts.role ?? 'lead',
    contour,
    intervals,
    pitchClasses,
    register,
    rhythmicDensity,
    accentPattern,
    sourceMotifId: opts.sourceMotifId,
    transformHistory: opts.transformHistory ? opts.transformHistory.slice() : [],
  }
}

/**
 * Structural fingerprint that survives transposition.
 *
 * Encodes contour direction sequence, interval-class sequence (intervals mod
 * 12, unsigned so direction matters but absolute register does not), and the
 * accent pattern. Returns a string suitable for Map keys and equality tests.
 */
export function motifIdentity(motif: Motif): string {
  const contourPart = motif.contour.join(',')
  const intervalClassPart = motif.intervals
    .map((iv) => {
      const cls = ((iv % 12) + 12) % 12
      const sign = iv < 0 ? 'n' : 'p'
      return `${sign}${cls}`
    })
    .join(',')
  const accentPart = motif.accentPattern.map((b) => (b ? '1' : '0')).join('')
  return `c:${contourPart}|i:${intervalClassPart}|a:${accentPart}`
}

/**
 * Structural similarity in [0, 1].
 *
 * Combines three signals:
 *  - contour agreement (fraction of matching directions)
 *  - accent-pattern agreement (fraction of matching accents)
 *  - interval-class agreement (fraction of matching unsigned interval classes)
 *
 * Returns 1 for identical motifs (including transpositions of the same shape),
 * lower for divergent shapes. Empty motifs are similar only to empty motifs.
 */
export function motifSimilarity(a: Motif, b: Motif): number {
  if (a.notes.length === 0 && b.notes.length === 0) return 1
  if (a.notes.length === 0 || b.notes.length === 0) return 0

  // Contour alignment via longest-common-subsequence-style count.
  const contourMatch = alignSequences(a.contour, b.contour)
  const contourLen = Math.max(a.contour.length, b.contour.length, 1)
  const contourScore = contourMatch / contourLen

  // Accent pattern alignment on the overlapping range.
  const accentLen = Math.min(a.accentPattern.length, b.accentPattern.length)
  let accentHits = 0
  for (let i = 0; i < accentLen; i++) {
    if (a.accentPattern[i] === b.accentPattern[i]) accentHits++
  }
  const accentScore = accentLen > 0 ? accentHits / accentLen : 0.5

  // Interval-class alignment (signed mod 12).
  const intervalClassA = a.intervals.map((iv) => {
    const cls = ((iv % 12) + 12) % 12
    return iv < 0 ? -cls : cls
  })
  const intervalClassB = b.intervals.map((iv) => {
    const cls = ((iv % 12) + 12) % 12
    return iv < 0 ? -cls : cls
  })
  const intervalMatch = alignSequences(intervalClassA, intervalClassB)
  const intervalLen = Math.max(intervalClassA.length, intervalClassB.length, 1)
  const intervalScore = intervalMatch / intervalLen

  // Weighted blend: contour and intervals dominate (shape); accents refine.
  return 0.45 * contourScore + 0.35 * intervalScore + 0.2 * accentScore
}

/**
 * Count matching positions across two sequences using a simple sliding
 * alignment that takes the best match over a small offset range. This is not
 * a true LCS but a cheap O(n*k) approximation that is good enough for
 * similarity scoring of short motifs.
 */
function alignSequences(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const maxOffset = Math.min(3, Math.abs(a.length - b.length) + 2)
  let best = 0
  for (let offset = -maxOffset; offset <= maxOffset; offset++) {
    let hits = 0
    let compared = 0
    for (let i = 0; i < a.length; i++) {
      const j = i + offset
      if (j < 0 || j >= b.length) continue
      compared++
      if (a[i] === b[j]) hits++
    }
    if (compared > 0 && hits > best) best = hits
  }
  return best
}
